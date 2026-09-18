import assert from 'node:assert/strict';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, action, order, proof, remaining } = h;
  const buyerError = /Enter a valid buyer contact number/;
  const recipientError = /Enter a valid delivery recipient contact number/;
  const counts = async () => (await db.query(`select
    (select count(*)::int from tlb.orders) as orders,
    (select count(*)::int from tlb.allocations) as allocations,
    (select count(*)::int from tlb.outbox) as emails`)).rows[0];

  await check('phone validation accepts local and international formatting without rewriting contact data', async () => {
    for (const phone of ['09171234567', '+63 917 123 4567', '(02) 8123-4567', '812-3456', '+1 (212) 555-0123', '+123456789012345', ' 0917 123 4567 ']) {
      assert.equal(await h.scalar('select tlb.valid_contact_phone($1)', [phone]), true, phone);
    }
    const { product, date } = await fixture(3);
    const payload = checkout(product, date);
    payload.buyer.phone = '+63 917 123 4567';
    const saved = await api('create_order', payload);
    assert.equal(saved.buyer.phone, payload.buyer.phone);
    assert.equal(saved.payment_status, 'awaiting_payment');
    assert.equal(await remaining(product, date), 2);
  })();

  await check('invalid buyer phones cannot create an order, reserve stock or queue an email', async () => {
    const { product, date } = await fixture(3);
    const before = await counts();
    for (const phone of [null, '', '     ', 'Brent Chua', '0917ABC4567', '09171234567 ext 1', '09171234567x2', '123456', '1234567890123456', '++639171234567', '63+9171234567', '0917.123.4567', '0917/1234567', '0917\n1234567', '09171234567\n', '09171234567\r', '\t09171234567', '0917\u200b1234567', '０９１７１２３４５６７', '()+ - ()', `09171234567${'-'.repeat(30)}`]) {
      const payload = checkout(product, date);
      payload.buyer.phone = phone;
      await assert.rejects(api('create_order', payload), buyerError, String(phone));
    }
    assert.deepEqual(await counts(), before);
    assert.equal(await remaining(product, date), 3);
  })();

  await check('delivery recipient phones follow the same contract while pickup needs no recipient', async () => {
    const { product, date } = await fixture(3);
    const delivery = () => checkout(product, date, {
      method: 'delivery', address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' },
    });
    const before = await counts();
    for (const phone of ['Call my mother', '0917ABC4567', '', '123456', '1234567890123456']) {
      const payload = delivery();
      payload.recipient.phone = phone;
      await assert.rejects(api('create_order', payload), recipientError);
    }
    assert.deepEqual(await counts(), before);
    assert.equal(await remaining(product, date), 3);
    const payload = delivery();
    payload.recipient.phone = '(02) 8123-4567';
    assert.equal((await api('create_order', payload)).recipient.phone, '(02) 8123-4567');
    const pickup = await api('create_order', checkout(product, date, { recipient: {} }));
    assert.equal(pickup.method, 'pickup');
    assert.equal(await remaining(product, date), 1);
  })();

  await check('contact validation retains buyer name, email, social platform and delivery address requirements', async () => {
    const base = { method: 'pickup', buyer: { name: 'QA Customer', phone: '09171234567', email: 'customer@example.test' } };
    const validate = payload => db.query('select tlb.validate_contact($1::jsonb)', [JSON.stringify(payload)]);
    await assert.rejects(validate({ ...base, buyer: { ...base.buyer, name: '' } }), /buyer name/);
    await assert.rejects(validate({ ...base, buyer: { ...base.buyer, email: 'invalid' } }), /buyer email/);
    await assert.rejects(validate({ ...base, buyer: { ...base.buyer, social_username: 'qa', social_platform: '' } }), /Choose Facebook, Instagram, or N\/A/);
    await assert.rejects(validate({ ...base, method: 'delivery', recipient: { name: '', phone: '09171234567' }, address: { line1: '123 QA Street' } }), /recipient name/);
    await assert.rejects(validate({ ...base, method: 'delivery', recipient: { name: 'QA Recipient', phone: '09171234567' }, address: { line1: '' } }), /complete delivery address/);
  })();

  await check('paid order edits reject invalid contacts atomically and retain paid status for valid corrections', async () => {
    const { product, date } = await fixture(3);
    const submitted = await api('create_order', checkout(product, date));
    const paid = await action('approve_payment', await proof(submitted));
    const before = await order(paid.id);
    const beforeCounts = await counts();
    const beforeAllocations = await h.allocations(paid.id);
    await assert.rejects(action('edit_order', paid, {
      reason: 'Invalid contact correction', changes: { buyer: { ...paid.buyer, phone: 'Call Brent' } },
    }), buyerError);
    assert.deepEqual(await order(paid.id), before);
    assert.deepEqual(await h.allocations(paid.id), beforeAllocations);
    assert.deepEqual(await counts(), beforeCounts);
    const corrected = await action('edit_order', paid, {
      reason: 'Contact correction', changes: { buyer: { ...paid.buyer, phone: '+63 917 111 2222' } },
    });
    assert.equal(corrected.buyer.phone, '+63 917 111 2222');
    assert.equal(corrected.payment_status, 'paid');
    assert.equal(corrected.paid_amount_cents, paid.paid_amount_cents);
    assert.equal(corrected.total_cents, paid.total_cents);
  })();

  await check('legacy contacts remain readable and existing orders can still be cancelled', async () => {
    const { product, date } = await fixture(2);
    const submitted = await api('create_order', checkout(product, date));
    await db.query(`update tlb.orders set data=jsonb_set(data, '{buyer,phone}', '"Previously accepted text"') where id=$1`, [submitted.id]);
    const legacy = await order(submitted.id);
    assert.equal(legacy.buyer.phone, 'Previously accepted text');
    const cancelled = await action('cancel_order', legacy, { reason: 'Cancel existing order', restore_stock: true });
    assert.equal(cancelled.fulfillment_status, 'cancelled');
    assert.equal(await remaining(product, date), 2);
  })();

  await check('phone validators remain private invoker functions with fixed search paths', async () => {
    const functions = (await db.query(`select p.proname, p.prosecdef,
      p.proconfig @> array['search_path=""'] as empty_search_path,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='tlb' and p.proname in ('valid_contact_phone','validate_contact')
      order by p.proname`)).rows;
    assert.equal(functions.length, 2);
    for (const fn of functions) {
      assert.equal(fn.prosecdef, false, fn.proname);
      assert.equal(fn.empty_search_path, true, fn.proname);
      assert.equal(fn.anon_execute, false, fn.proname);
      assert.equal(fn.authenticated_execute, false, fn.proname);
    }
  })();
}
