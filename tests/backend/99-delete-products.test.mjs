import assert from 'node:assert/strict';

export default async function({db,check,state}){
  const h=state.harness;
  const remove=(p,user=h.ids.owner)=>h.api('delete_product',{id:p.id,expected_product:p},user);
  await check('product deletion: only a verified owner can remove a product',async()=>{
    const p=await h.product();
    for(const user of [null,h.ids.staff,h.ids.customer,h.ids.unverified])await assert.rejects(remove(p,user),/owner|authorized|verified/i);
    assert.equal(await h.scalar('select count(*) from tlb.products where id=$1',[p.id]),1);
    for(const role of ['anon','authenticated']){
      assert.equal(await h.scalar("select has_function_privilege($1,'tlb.delete_product(jsonb)','EXECUTE')",[role]),false);
      assert.equal(await h.scalar("select has_table_privilege($1,'tlb.deleted_products','SELECT')",[role]),false);
    }
  })();
  await check('product deletion: stale or missing confirmation cannot delete changed data',async()=>{
    const p=await h.product(),changed=await h.api('save_product',{product:{...p,price_cents:p.price_cents+500}},h.ids.owner);
    await assert.rejects(remove(p),/changed in another window/i);
    for(const expected_product of [undefined,null,{},[]])await assert.rejects(h.api('delete_product',{id:p.id,expected_product},h.ids.owner),/changed in another window/i);
    assert.deepEqual(await h.scalar('select data from tlb.products where id=$1',[p.id]),changed);
  })();
  await check('product deletion: unused products and quantities disappear; retries are safe',async()=>{
    const {product:p}=await h.fixture(),other=await h.product();
    const beforeOrders=await h.scalar('select coalesce(jsonb_agg(to_jsonb(o) order by id),\'[]\') from tlb.orders o');
    assert.deepEqual(await remove(p),{id:p.id,deleted:true});
    assert.deepEqual(await remove(p),{id:p.id,deleted:true});
    assert.equal(await h.scalar('select count(*) from tlb.products where id=$1',[p.id]),0);
    assert.equal(await h.scalar('select count(*) from tlb.inventory where product_id=$1',[p.id]),0);
    assert.equal(await h.scalar('select count(*) from tlb.products where id=$1',[other.id]),1);
    assert.equal((await h.api('catalog')).products.some(x=>x.id===p.id),false);
    assert.equal((await h.api('admin_bootstrap',{},h.ids.owner)).products.some(x=>x.id===p.id),false);
    assert.deepEqual(await h.scalar('select coalesce(jsonb_agg(to_jsonb(o) order by id),\'[]\') from tlb.orders o'),beforeOrders);
    await assert.rejects(h.api('save_product',{product:{...p,name:'Stale editor resurrection'}},h.ids.owner),/was deleted/i);
    await h.product({name:p.name}); // A fresh product with the same name is allowed.
  })();
  await check('product deletion: all order history stays intact, including released allocations',async()=>{
    const {product:p,date}=await h.fixture();
    const o=await h.api('create_order',h.checkout(p,date));
    const before=await h.order(o.id);
    await assert.rejects(remove(p),/order history.*hide/i);
    assert.deepEqual(await h.order(o.id),before);
    await db.query('delete from tlb.allocations where order_id=$1',[o.id]);
    await assert.rejects(remove(p),/order history.*hide/i);
    assert.deepEqual(await h.order(o.id),before);
    const hidden=await h.api('save_product',{product:{...p,active:false}},h.ids.owner);
    assert.equal(hidden.active,false);
    assert.equal((await h.api('catalog')).products.some(x=>x.id===p.id),false);
  })();
}
