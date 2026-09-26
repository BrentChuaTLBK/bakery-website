import assert from 'node:assert/strict';
export default async function({db,check,state}){
 const {api,ids,fixture,checkout,proof}=state.harness;
 await check('branded email payload snapshots product photos and preserves review privacy',async()=>{
  const photo='https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/sample/sample.webp';
  const {product,date}=await fixture(5,{name:'Email photo test',price_cents:30000,photos:[photo]});
  const order=await api('create_order',checkout(product,date));
  let row=(await db.query("select payload from tlb.outbox where order_id=$1 and event_type='order_submitted'",[order.id])).rows[0];
  assert.equal(row.payload.email_design_version,2);assert.deepEqual(row.payload.product_photos,[photo]);
  await api('save_product',{product:{...product,photos:[]}},ids.owner);
  row=(await db.query("select payload from tlb.outbox where order_id=$1 and event_type='order_submitted'",[order.id])).rows[0];assert.deepEqual(row.payload.product_photos,[photo]);
  await proof(order);
  row=(await db.query("select payload from tlb.outbox where order_id=$1 and event_type='order_review_required' limit 1",[order.id])).rows[0];
  assert.equal(row.payload.email_design_version,2);assert.deepEqual(row.payload.product_photos,['']);assert.doesNotMatch(JSON.stringify(row.payload),/access_token|proof_path/);
 })();
 await check('branded attempted retries retain frozen media and payload even when reminder preparation runs again',async()=>{
  const {product,date}=await fixture(3);const order=await api('create_order',checkout(product,date));
  const row=(await db.query("select id,payload,to_email from tlb.outbox where order_id=$1 and event_type='order_submitted'",[order.id])).rows[0];
  await db.query('update tlb.outbox set attempts=2 where id=$1',[row.id]);
  await db.query("update tlb.outbox set payload=$2::jsonb,to_email='changed@example.test' where id=$1",[row.id,JSON.stringify({event_type:'order_submitted'})]);
  const after=(await db.query('select payload,to_email from tlb.outbox where id=$1',[row.id])).rows[0];assert.deepEqual(after,{payload:row.payload,to_email:row.to_email});
 })();
}
