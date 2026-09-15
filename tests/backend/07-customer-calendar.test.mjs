import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, inventory, order, action, proof, remaining } = h;
  const migration = await readFile(new URL('../../supabase/migrations/20260915153120_customer_booking_calendar_window.sql', import.meta.url), 'utf8');
  const signature = 'tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)';
  const definition = () => h.scalar('select pg_get_functiondef($1::regprocedure)', [signature]);
  const oldDefinition = value => {
    const previous = value.replace(/  -- TLB_CUSTOMER_BOOKING_CALENDAR_V1\r?\n  perform tlb\.require\([^\r\n]+\);\r?\n/, '');
    assert.notEqual(previous, value, 'The installed horizon guard must be present in the local upgrade fixture.');
    // Reconstruct this historical migration's no-same-day anchor, even when a
    // later migration has introduced explicit product opt-in for same-day sales.
    return previous.replace(
      "ful>=(p_submitted at time zone 'Asia/Manila')::date,'Past fulfillment dates are not available. Choose today or a future date.'",
      "ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.'",
    );
  };
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(o) order by o.id) from tlb.orders o) as orders,
    (select jsonb_agg(to_jsonb(a) order by a.order_id,a.product_id,a.date) from tlb.allocations a) as allocations,
    (select jsonb_agg(to_jsonb(e) order by e.id) from tlb.outbox e) as emails,
    (select jsonb_agg(to_jsonb(p) order by p.id) from tlb.payments p) as payments,
    (select data from tlb.settings where id) as settings`)).rows[0];
  const quoteAt = async (product, date, submitted, extras = {}) => (
    await db.query('select tlb.calculate_quote($1::jsonb,null,null,false,$2::timestamptz) as result', [
      JSON.stringify(checkout(product, date, extras)), submitted,
    ])
  ).rows[0].result;
  const actualWindow = () => db.query(`select
    ((clock_timestamp() at time zone 'Asia/Manila')::date)::text as today,
    ((clock_timestamp() at time zone 'Asia/Manila')::date-1)::text as yesterday,
    (date_trunc('month',clock_timestamp() at time zone 'Asia/Manila')+interval '3 months - 1 day')::date::text as last,
    (date_trunc('month',clock_timestamp() at time zone 'Asia/Manila')+interval '3 months')::date::text as outside`).then(r => r.rows[0]);
  const oldSettings = (await api('admin_bootstrap', {}, ids.owner)).settings;
  await api('save_settings', { settings: {
    production_weekdays: [0, 1, 2, 3, 4, 5, 6], fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6],
    cutoff_time: null, nonproduction_dates: [], blocked_dates: [], pickup_blocked_dates: [], delivery_blocked_dates: [],
  } }, ids.owner);

  try {
    await check('customer horizon includes the last day of the second following month across year and leap boundaries', async () => {
      const { product } = await fixture(3, { lead_days: 0 });
      for (const [submitted, last, outside] of [
        ['2026-09-15T08:00:00+08:00', '2026-11-30', '2026-12-01'],
        ['2026-11-30T08:00:00+08:00', '2027-01-31', '2027-02-01'],
        ['2026-12-31T08:00:00+08:00', '2027-02-28', '2027-03-01'],
        ['2027-12-31T08:00:00+08:00', '2028-02-29', '2028-03-01'],
        ['2028-01-31T08:00:00+08:00', '2028-03-31', '2028-04-01'],
      ]) {
        await inventory(product, last, 3);
        await inventory(product, outside, 3);
        for (const method of ['pickup', 'delivery']) {
          const extras = { method, address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' } };
          const accepted = await quoteAt(product, last, submitted, extras);
          assert.equal(accepted.items[0].product_id, product.id);
          await assert.rejects(quoteAt(product, outside, submitted, extras), /current month or the next two months/);
        }
      }
    })();

    await check('the booking window advances at Manila midnight even when the UTC month is unchanged', async () => {
      const { product } = await fixture(3, { lead_days: 0 });
      for (const date of ['2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01']) await inventory(product, date, 3);
      assert.equal((await quoteAt(product, '2026-11-30', '2026-09-30T15:59:59Z')).total_cents, 10000);
      await assert.rejects(quoteAt(product, '2026-12-01', '2026-09-30T15:59:59Z'), /current month or the next two months/);
      assert.equal((await quoteAt(product, '2026-12-31', '2026-09-30T16:00:00Z')).total_cents, 10000);
      await assert.rejects(quoteAt(product, '2027-01-01', '2026-09-30T16:00:00Z'), /current month or the next two months/);
    })();

    await check('past and same-day dates stay unavailable without product opt-in and tomorrow remains eligible subject to existing rules', async () => {
      const { product } = await fixture(3, { lead_days: 0 });
      for (const date of ['2026-08-31', '2026-09-14', '2026-09-15', '2026-09-16', '2026-10-01']) await inventory(product, date, 3);
      for (const date of ['2026-08-31', '2026-09-14', '2026-09-15']) {
        await assert.rejects(quoteAt(product, date, '2026-09-15T08:00:00+08:00'), /Past fulfillment dates|not available for same-day/);
      }
      assert.equal((await quoteAt(product, '2026-09-16', '2026-09-15T08:00:00+08:00')).total_cents, 10000);
      assert.equal((await quoteAt(product, '2026-10-01', '2026-09-30T15:59:59Z')).total_cents, 10000);
      await assert.rejects(quoteAt(product, '2026-10-01', '2026-10-01T16:00:00Z'), /Past fulfillment dates/);
    })();

    await check('public quote and submission ignore forged clocks, admin flags and limits without orders, allocations or emails', async () => {
      const { product } = await fixture(3, { lead_days: 0 });
      const window = await actualWindow();
      for (const date of [window.yesterday, window.today, window.outside]) await inventory(product, date, 3);
      const before = await snapshot();
      for (const user of [null, ids.customer, ids.owner]) {
        for (const date of [window.yesterday, window.today, window.outside]) {
          const payload = checkout(product, date, {
            p_admin: true, admin: true, p_submitted: `${window.outside}T00:00:00+08:00`,
            submitted_at: `${window.outside}T00:00:00+08:00`, server_time: `${window.outside}T00:00:00+08:00`,
            max_date: '2999-12-31', max_months: 1000,
          });
          const expected = date === window.outside ? /current month or the next two months/ : /Past fulfillment dates|not available for same-day/;
          await assert.rejects(api('quote', payload, user), expected);
          await assert.rejects(api('create_order', payload, user), expected);
        }
      }
      assert.deepEqual(await snapshot(), before);
      for (const date of [window.yesterday, window.today, window.outside]) assert.equal(await remaining(product, date), 3);
      await inventory(product, window.last, 3);
      const accepted = await api('create_order', checkout(product, window.last));
      assert.equal(accepted.fulfillment_date, window.last);
      assert.equal((Date.parse(accepted.payment_deadline) - Date.parse(accepted.created_at)) / 1000, 900);
    })();

    await check('staff can preview and amend paid bookings beyond the customer horizon while preserving payment and stock', async () => {
      const { product, date } = await fixture(5);
      const { outside } = await actualWindow();
      await inventory(product, outside, 5);
      const paid = await action('approve_payment', await proof(await api('create_order', checkout(product, date))));
      const changes = { fulfillment_date: outside };
      const preview = await action('preview_edit_order', paid, { changes });
      assert.equal(preview.fulfillment_date, outside);
      assert.equal((await order(paid.id)).fulfillment_date, date);
      const moved = await action('edit_order', paid, { changes, reason: 'Staff-arranged future booking' });
      assert.equal(moved.fulfillment_date, outside);
      assert.equal(moved.payment_status, 'paid');
      assert.equal(moved.paid_amount_cents, paid.paid_amount_cents);
      assert.equal(moved.total_cents, paid.total_cents);
      assert.equal(await remaining(product, date), 5);
      assert.equal(await remaining(product, outside), 4);
    })();

    await check('upgrading preserves previously accepted bookings beyond the horizon and their read and cancellation flows', async () => {
      const installed = await definition();
      const { product } = await fixture(3);
      const { outside } = await actualWindow();
      await inventory(product, outside, 3);
      let legacy;
      try {
        await db.exec(oldDefinition(installed));
        legacy = await api('create_order', checkout(product, outside));
        const before = await snapshot();
        await db.exec(migration);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await db.exec(installed);
      }
      const guest = await api('get_order', { order_id: legacy.id }, null, legacy.access_token);
      assert.equal(guest.fulfillment_date, outside);
      assert.equal(guest.fulfillment_status, 'pending_confirmation');
      assert.equal(await remaining(product, outside), 2);
      const cancelled = await action('cancel_order', await order(legacy.id), { reason: 'Customer requested cancellation' });
      assert.equal(cancelled.fulfillment_status, 'cancelled');
      assert.equal(await remaining(product, outside), 3);
    })();

    await check('migration accepts CRLF source, replays harmlessly and retains private function grants and delivery protections', async () => {
      const installed = await definition();
      const before = await snapshot();
      try {
        await db.exec(oldDefinition(installed).replace(/\r?\n/g, '\r\n'));
        await db.exec(migration);
        const updated = await definition();
        assert.ok(updated.includes('TLB_CUSTOMER_BOOKING_CALENDAR_V1'));
        assert.ok(updated.includes('TLB_DELIVERY_OPTIONS_V1'));
        assert.ok(updated.includes("p->>'pickup_only'"));
        assert.ok(updated.includes('delivery_zone_description'));
        assert.ok(updated.includes('\r\n'));
        await db.exec(migration);
        assert.equal(await definition(), updated);
        assert.deepEqual(await snapshot(), before);
        for (const role of ['anon', 'authenticated']) {
          assert.equal(await h.scalar('select has_function_privilege($1,$2,\'execute\')', [role, signature]), false);
          assert.equal(await h.scalar('select has_function_privilege($1,\'public.shop_api(text,jsonb,text)\',\'execute\')', [role]), true);
        }
      } finally {
        await db.exec(installed);
      }
    })();

    await check('migration fails without changing records when the existing function anchor has drifted', async () => {
      const installed = await definition();
      const before = await snapshot();
      try {
        await db.exec(oldDefinition(installed).replace('Same-day fulfillment is not available. Choose a future date.', 'Changed quote anchor in local fixture.'));
        const drifted = await definition();
        await assert.rejects(db.exec(migration), /Unexpected quote definition/);
        assert.equal(await definition(), drifted);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await db.exec(installed);
      }
    })();
  } finally {
    await api('save_settings', { settings: oldSettings }, ids.owner);
  }
}
