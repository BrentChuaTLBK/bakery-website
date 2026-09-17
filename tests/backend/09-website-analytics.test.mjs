import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { ids } = h;
  await check('visitor reports require current staff membership through the service-only gateway', async () => {
    for (const user of [ids.owner, ids.staff]) assert.deepEqual(await h.service('authorize_analytics', { user_id: user }), { allowed: true });
    for (const user of [null, ids.customer, ids.stranger, ids.unverified]) {
      await assert.rejects(h.service('authorize_analytics', { user_id: user, role: 'owner', is_admin: true }), /Authorized staff access required/);
    }
    for (const user of [null, ids.owner, ids.staff, ids.customer]) {
      await assert.rejects(h.as(user, () => db.query('select public.shop_service($1, $2::jsonb)', ['authorize_analytics', JSON.stringify({ user_id: ids.owner })])), /permission denied/);
    }
    await db.query('delete from tlb.staff where user_id=$1', [ids.staff]);
    await assert.rejects(h.service('authorize_analytics', { user_id: ids.staff }), /Authorized staff access required/);
    await db.query("insert into tlb.staff(user_id,role) values ($1,'staff')", [ids.staff]);
  })();

  await check('visitor authorization is read-only and does not run order expiry or queue emails', async () => {
    const { product, date } = await h.fixture();
    const order = await h.api('create_order', h.checkout(product, date), ids.customer);
    await db.query("update tlb.orders set payment_deadline=clock_timestamp()-interval '1 minute' where id=$1", [order.id]);
    const snapshot = async () => ({
      order: (await db.query('select payment_status,fulfillment_status,revision from tlb.orders where id=$1', [order.id])).rows,
      allocations: await h.allocations(order.id),
      emails: await h.scalar('select count(*) from tlb.outbox'),
    });
    const before = await snapshot();
    await h.service('authorize_analytics', { user_id: ids.owner });
    assert.deepEqual(await snapshot(), before);
  })();

  await check('analytics authorization migration is repeatable and preserves private helper permissions', async () => {
    const { readdir } = await import('node:fs/promises');
    const directory = new URL('../../supabase/migrations/', import.meta.url);
    const names = await readdir(directory);
    const name = names.find(name => name.endsWith('_website_analytics_access.sql'));
    assert.ok(name);
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
    assert.deepEqual(await h.service('authorize_analytics', { user_id: ids.owner }), { allowed: true });
    assert.equal(await h.scalar("select has_function_privilege('anon','public.shop_service(text,jsonb)','execute')"), false);
    assert.equal(await h.scalar("select has_function_privilege('authenticated','public.shop_service(text,jsonb)','execute')"), false);
    assert.equal(await h.scalar("select has_function_privilege('service_role','public.shop_service(text,jsonb)','execute')"), true);
    assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.assert_staff(uuid,boolean)','execute')"), false);
  })();
}
