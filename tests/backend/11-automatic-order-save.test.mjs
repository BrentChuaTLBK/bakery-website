import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prepareOrderSave } from '../../assets/ordering/order-edit-save.js';

export default async function ({ check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, item, inventory, remaining, action, proof, order } = h;
  const prepare = (original, changes, confirmTotalChange, user = ids.owner) => prepareOrderSave({
    order: original, changes, reason: 'Local automatic-save check', idempotencyKey: randomUUID(),
    preview: payload => api('preview_edit_order', payload, user), confirmTotalChange,
  });
  const snapshot = async id => ({
    order: await order(id), allocations: await h.allocations(id),
    emails: await h.scalar('select count(*)::int from tlb.outbox where order_id=$1', [id]),
    actions: await h.scalar('select count(*)::int from tlb.action_keys where order_id=$1', [id]),
  });

  await check('automatic save checks and saves same-total contact and date changes without confirmation', async () => {
    const { product, date } = await fixture(3);
    const submitted = await api('create_order', checkout(product, date));
    const mustNotConfirm = () => assert.fail('An unchanged total must not require confirmation.');
    const contactPayload = await prepare(submitted, { buyer: { name: 'QA Corrected Name' } }, mustNotConfirm, ids.staff);
    assert.equal(contactPayload.expected_quote.total_cents, submitted.total_cents);
    const corrected = await api('edit_order', contactPayload, ids.staff);
    assert.equal(corrected.buyer.name, 'QA Corrected Name');
    assert.equal(corrected.total_cents, submitted.total_cents);
    const nextDate = await h.day(31);
    await inventory(product, nextDate, 2);
    const datePayload = await prepare(corrected, { fulfillment_date: nextDate }, mustNotConfirm);
    const moved = await api('edit_order', datePayload, ids.owner);
    assert.equal(moved.fulfillment_date, nextDate);
    assert.equal(moved.total_cents, submitted.total_cents);
    assert.equal(moved.revision, submitted.revision + 2);
    assert.equal(await remaining(product, date), 3);
    assert.equal(await remaining(product, nextDate), 1);
  })();

  await check('accepted total-change confirmation saves the amendment while preserving paid amount and fulfillment progress', async () => {
    const { product, date } = await fixture(5);
    const submitted = await api('create_order', checkout(product, date, { items: [item(product, 2)] }));
    const paid = await action('approve_payment', await proof(submitted));
    const preparing = await action('set_fulfillment', paid, { status: 'preparing' });
    const confirmations = [];
    const payload = await prepare(preparing, { items: [item(product, 3)] }, totals => {
      confirmations.push(totals);
      return true;
    }, ids.staff);
    assert.deepEqual(confirmations, [{ oldTotal: 20000, newTotal: 30000, paymentStatus: 'paid' }]);
    const edited = await api('edit_order', payload, ids.staff);
    assert.equal(edited.total_cents, 30000);
    assert.equal(edited.payment_status, 'paid');
    assert.equal(edited.paid_amount_cents, 20000);
    assert.equal(edited.fulfillment_status, 'preparing');
    assert.equal(await h.scalar('select amount_cents from tlb.payments where order_id=$1', [edited.id]), 20000);
    assert.equal(await remaining(product, date), 2);
    assert.deepEqual((await h.allocations(edited.id)).map(row => row.state), ['committed']);
  })();

  await check('declining a changed total leaves the saved order, stock, audit and email queue untouched', async () => {
    const { product, date } = await fixture(3);
    const submitted = await api('create_order', checkout(product, date));
    const before = await snapshot(submitted.id);
    let confirmations = 0;
    const payload = await prepare(submitted, { items: [item(product, 2)] }, () => {
      confirmations += 1;
      return false;
    });
    assert.equal(confirmations, 1);
    assert.equal(payload, null);
    assert.deepEqual(await snapshot(submitted.id), before);
    assert.equal(await remaining(product, date), 2);
  })();

  await check('a new item price changing after automatic preview rejects the stale expected quote atomically', async () => {
    const { product, date } = await fixture(3);
    const additional = await h.product({ price_cents: 6000 });
    await inventory(additional, date, 3);
    const submitted = await api('create_order', checkout(product, date));
    const payload = await prepare(submitted, { items: [item(product), item(additional)] }, () => true);
    assert.equal(payload.expected_quote.total_cents, 16000);
    await api('save_product', { product: { ...additional, price_cents: 6500 } }, ids.owner);
    const before = await snapshot(submitted.id);
    await assert.rejects(api('edit_order', payload, ids.owner), /Prices changed since the amendment preview/);
    assert.deepEqual(await snapshot(submitted.id), before);
    assert.equal(await remaining(product, date), 2);
    assert.equal(await remaining(additional, date), 3);
  })();

  await check('stock and order revision races after automatic preview reject without partial order changes', async () => {
    const { product, date } = await fixture(3);
    const submitted = await api('create_order', checkout(product, date));
    const quantityPayload = await prepare(submitted, { items: [item(product, 2)] }, () => true);
    await inventory(product, date, 1);
    const stockBefore = await snapshot(submitted.id);
    await assert.rejects(api('edit_order', quantityPayload, ids.owner), /stock|capacity|available|remain/i);
    assert.deepEqual(await snapshot(submitted.id), stockBefore);
    assert.equal(await remaining(product, date), 0);

    const contactPayload = await prepare(submitted, { buyer: { name: 'QA Stale Name' } }, () => assert.fail('Contact change does not alter total.'));
    const updated = await action('add_staff_note', submitted, { note: 'Another staff action happened during save.' });
    const revisionBefore = await snapshot(submitted.id);
    await assert.rejects(api('edit_order', contactPayload, ids.owner), /This order changed/);
    assert.deepEqual(await snapshot(submitted.id), revisionBefore);
    assert.equal((await order(submitted.id)).revision, updated.revision);
    assert.equal(await remaining(product, date), 0);
  })();
}
