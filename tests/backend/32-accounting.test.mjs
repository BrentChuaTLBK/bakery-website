import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export default async function({db,check,state}) {
  const h=state.harness,{api,ids,scalar}=h;
  const today=await h.day(0), range={start:today,end:today};
  const call=(action,payload={},user=ids.owner)=>api('accounting_'+action,payload,user);
  const report=()=>call('report',range);
  const balance=async id=>(await db.query('select c.system_key,sum(l.amount_cents)::int as amount from tlb.accounting_ledger l join tlb.accounting_categories c on c.id=l.category_id where l.order_id=$1 group by c.system_key',[id])).rows;
  const counts=async id=>scalar('select count(*)::int from tlb.accounting_ledger where order_id=$1',[id]);
  const newOrder=async()=>{const {product,date}=await h.fixture();const o=await api('create_order',h.checkout(product,date),ids.customer);return {o:await h.proof(o),product,date};};

  await check('accounting is owner-only through every action and direct private tables/functions are blocked',async()=>{
    for(const user of [null,ids.staff,ids.customer,ids.unverified])for(const action of ['report','save_entry','save_category','save_delivery','get_delivery','history','delete_entry'])
      await assert.rejects(call(action,{...range,id:randomUUID(),role:'owner',user_id:ids.owner},user),/authorized|owner|staff|access/i);
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal(await scalar("select has_function_privilege($1,'tlb.accounting_api(uuid,text,jsonb)','execute')",[role]),false);
      for(const table of ['accounting_categories','accounting_entries','accounting_delivery_costs','accounting_ledger','accounting_order_state','accounting_audit'])
        assert.equal(await scalar('select has_table_privilege($1,$2,\'select,insert,update,delete\')',[role,'tlb.'+table]),false);
    }
    await assert.rejects(call('report',{start:'2026-09-30',end:'2026-09-01'}),/start|end|date/i);
  })();

  await check('manual entries support categories, exact cents, retry safety, revisions, soft removal and audit history',async()=>{
    const category={id:randomUUID(),revision:0,name:'Accounting QA '+randomUUID(),kind:'sale'};
    const cat=await call('save_category',category);assert.equal((await call('save_category',category)).revision,1);
    const payload={id:randomUUID(),revision:0,entry_date:today,category_id:cat.id,amount_cents:12345,note:'Custom cake'};
    const e=await call('save_entry',payload);assert.equal(e.amount_cents,12345);
    assert.equal((await call('save_entry',payload)).revision,1);
    assert.equal((await call('history',{id:e.id})).length,1);
    await assert.rejects(call('save_entry',{...payload,amount_cents:222}),/changed/i);
    const updated=await call('save_entry',{...payload,revision:1,amount_cents:23456});assert.equal(updated.revision,2);
    let r=await report();assert.equal(r.summary.find(c=>c.id===cat.id).amount_cents,23456);
    const removed=await call('delete_entry',{id:e.id,revision:2});assert.ok(removed.deleted_at);
    await call('delete_entry',{id:e.id,revision:2});assert.equal((await call('history',{id:e.id})).length,3);
    assert.equal((await report()).entries.some(row=>row.id===e.id),false);
    await assert.rejects(call('save_entry',{...payload,revision:3}),/removed/i);
    await assert.rejects(call('save_category',{...cat,kind:'expense'}),/cannot change/i);
    const system=(await report()).categories.find(c=>c.system_key==='website');
    await assert.rejects(call('save_category',{...system,name:'Override'}),/Automatic/i);
    await assert.rejects(call('save_entry',{...payload,id:randomUUID(),category_id:system.id}),/manual category/i);
    for(const amount of [0,-1,1000000000,1.5])await assert.rejects(call('save_entry',{...payload,id:randomUUID(),amount_cents:amount}));
    const archived=await call('save_category',{...cat,archived:true});assert.equal(archived.archived,true);
    await assert.rejects(call('save_entry',{...payload,id:randomUUID()}),/active manual/i);
  })();

  await check('payment approval posts gross sales and separate discount/fee entries exactly once',async()=>{
    const {o}=await newOrder();assert.equal(await counts(o.id),0);
    // Controlled fixture amounts avoid depending on an unrelated promo configuration.
    await db.query("update tlb.orders set data=data||'{\"subtotal_cents\":100000,\"discount_cents\":5000,\"delivery_cents\":15000,\"total_cents\":110000}'::jsonb where id=$1",[o.id]);
    const current=await h.order(o.id),payload={order_id:o.id,revision:current.revision,idempotency_key:randomUUID()};
    const paid=await api('approve_payment',payload,ids.owner);await api('approve_payment',payload,ids.owner);
    assert.deepEqual(Object.fromEntries((await balance(o.id)).map(x=>[x.system_key,x.amount])),{website:100000,discount:5000,delivery_fee:15000});
    assert.equal(await counts(o.id),3);
    const paymentDate=await scalar("select (approved_at at time zone 'Asia/Manila')::date::text from tlb.payments where order_id=$1",[o.id]);
    assert.equal(await scalar('select min(entry_date)::text from tlb.accounting_ledger where order_id=$1',[o.id]),paymentDate);
    await h.action('set_fulfillment',paid,{status:'preparing'});assert.equal(await counts(o.id),3);
    await db.query("update tlb.orders set data=data||'{\"subtotal_cents\":120000,\"discount_cents\":6000,\"delivery_cents\":18000,\"total_cents\":132000}'::jsonb where id=$1",[o.id]);
    assert.equal(await counts(o.id),6);
    assert.deepEqual(Object.fromEntries((await balance(o.id)).map(x=>[x.system_key,x.amount])),{website:120000,discount:6000,delivery_fee:18000});
    const refunded=await h.action('set_refund_label',await h.order(o.id),{enabled:true});
    assert.equal((await balance(o.id)).every(x=>x.amount===0),true);
    await h.action('set_refund_label',refunded,{enabled:false});assert.equal((await balance(o.id)).find(x=>x.system_key==='website').amount,120000);
    const cancelled=await h.action('cancel_order',await h.order(o.id),{reason:'Accounting fixture',restore_stock:true});
    assert.equal((await balance(o.id)).every(x=>x.amount===0),true);
    const count=await counts(o.id);await h.action('set_refund_label',cancelled,{enabled:true});assert.equal(await counts(o.id),count,'Cancel plus refund cannot reverse twice');
  })();

  await check('delivery costs preserve blank versus zero and saved records while refunded orders leave accounting',async()=>{
    const {o}=await newOrder();const paid=await h.action('approve_payment',o);
    const before=await h.order(o.id);let cost=await call('get_delivery',{order_id:o.id});assert.equal(cost.cost,null);
    const payload={order_id:o.id,order_revision:before.revision,revision:0,cost_date:today,amount_cents:22550,note:'Courier fixture'};
    const saved=await call('save_delivery',payload);assert.equal(saved.amount_cents,22550);
    await call('save_delivery',payload);assert.equal((await call('history',{id:o.id})).length,1);
    const after=await h.order(o.id);assert.deepEqual(after,before,'Private cost does not mutate the customer order');
    const customer=await api('get_order',{order_id:o.id},ids.customer);assert.equal(customer.actual_delivery_cost,undefined);
    let r=await report();assert.equal(r.entries.find(e=>e.id===o.id&&e.source==='Delivery cost').amount_cents,22550);
    let delivery=r.deliveries.find(d=>d.order_id===o.id);assert.equal(delivery.cost_cents,22550);assert.equal(delivery.fee_cents,0);
    await assert.rejects(call('save_delivery',{...payload,amount_cents:50}),/changed/i);
    const zero=await call('save_delivery',{...payload,revision:1,amount_cents:0});assert.equal(zero.amount_cents,0);
    const blank=await call('save_delivery',{...payload,revision:2,amount_cents:null});assert.equal(blank.amount_cents,null);
    assert.equal((await report()).entries.some(e=>e.id===o.id&&e.source==='Delivery cost'),false);
    await call('save_delivery',{...payload,revision:3});
    await h.action('set_refund_label',paid,{enabled:true});
    assert.equal((await report()).entries.some(e=>e.id===o.id&&e.source==='Delivery cost'),false,'Refunded delivery expenses are excluded');
    assert.equal((await call('get_delivery',{order_id:o.id})).cost.amount_cents,22550,'Saved cost remains available in the private order record');
    await assert.rejects(call('save_delivery',{...payload,revision:4,amount_cents:10}),/order changed/i);
  })();

  await check('accounting arbitrary ranges are inclusive and report includes more than 1000 entries',async()=>{
    const cat=await call('save_category',{id:randomUUID(),revision:0,name:'Bulk '+randomUUID(),kind:'expense'});
    await db.query("insert into tlb.accounting_entries(id,entry_date,category_id,amount_cents,note) select gen_random_uuid(),'2024-02-29'::date,$1,101,'Bulk fixture' from generate_series(1,1005)",[cat.id]);
    let r=await call('report',{start:'2024-02-29',end:'2024-02-29'});
    assert.equal(r.entries.filter(e=>e.category_id===cat.id).length,1005);
    assert.equal(r.summary.find(c=>c.id===cat.id).amount_cents,101505);
    r=await call('report',{start:'2024-03-01',end:'2024-03-01'});assert.equal(r.entries.some(e=>e.category_id===cat.id),false);
  })();

  await check('migration backfills approval snapshots and later history dates, then replays without duplicates',async()=>{
    const {o}=await newOrder();const paid=await h.action('approve_payment',o);
    await h.action('set_refund_label',paid,{enabled:true});
    await db.query("update tlb.payments set approved_at='2024-02-29T16:30:00Z' where order_id=$1",[o.id]);
    await db.query("update tlb.history set at=case when action='approve_payment' then '2024-02-29T16:30:00Z'::timestamptz else '2024-03-03T01:00:00Z'::timestamptz end where order_id=$1 and after_data->>'payment_status'='paid'",[o.id]);
    await db.query('delete from tlb.accounting_ledger where order_id=$1',[o.id]);await db.query('delete from tlb.accounting_order_state where order_id=$1',[o.id]);
    const migration=await readFile(new URL('../../supabase/migrations/20260924180843_owner_accounting.sql',import.meta.url),'utf8');
    const eligibility=await readFile(new URL('../../supabase/migrations/20260924184817_accounting_eligible_orders.sql',import.meta.url),'utf8');
    await db.exec(migration);await db.exec(eligibility);
    const dates=(await db.query('select entry_date::text,amount_cents::int from tlb.accounting_ledger where order_id=$1 order by entry_date',[o.id])).rows;
    assert.deepEqual(dates,[{entry_date:'2024-03-01',amount_cents:10000},{entry_date:'2024-03-03',amount_cents:-10000}]);
    const count=await counts(o.id);await db.exec(migration);await db.exec(eligibility);assert.equal(await counts(o.id),count);
    assert.equal((await call('report',{start:'2024-03-01',end:'2024-03-01'})).entries.some(e=>e.order_id===o.id),false);
    assert.equal((await call('report',{start:'2024-03-03',end:'2024-03-03'})).entries.some(e=>e.order_id===o.id),false);
  })();
}
