import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {makeHarness} from './helpers.mjs';

export default async function({db,check,state}) {
 const h=state.harness||await makeHarness(db),{api,ids}=h,today=await h.day(0);
 const prefix='PRODUCTION-'+randomUUID().slice(0,8),created=[],eventId=randomUUID();
 const range={from:'2080-05-01',to:'2080-05-03'};
 const selected=report=>report.orders.filter(order=>order.reference.startsWith(prefix));
 const payload={buyer:{name:'Production fixture customer',email:'private@example.test',phone:'09171234567'},instructions:'Prepare the saved flavors.',
  access_token:'DO-NOT-EXPOSE-TOKEN',proof_path:'private/proof.png',payment_reference:'DO-NOT-EXPOSE-PAYMENT',staff_notes:['private'],
  total_cents:0,items:[{product_id:randomUUID(),name:'Saved Butter Cookies',quantity:1,selections:{flavor:{earl:1}},
   selection_labels:[{group:'Flavor',label:'Earl Grey',quantity:1}],flavor_contents:[],custom:false,description:'Original saved name',
   unit_price_cents:20000,line_total_cents:20000,private_note:'DO-NOT-EXPOSE-ITEM-EXTRA'}]};
 const insert=async(label,date,{source='website',payment='paid',status='confirmed',refund=false,method='pickup',data={},deadline=null}={})=>{
  const id=randomUUID();
  await db.query(`insert into tlb.orders(id,reference,access_digest,access_encrypted,created_at,fulfillment_date,method,payment_status,fulfillment_status,refund_label,source,pos_event_id,payment_deadline,data,idempotency_key,request_hash)
   select $1::uuid,$2,extensions.digest(($1::uuid)::text,'sha256'),extensions.pgp_sym_encrypt('fixture-only-token',s.token_key),'2001-01-01'::timestamptz,$3::date,$4,$5,$6,$7,$8,$9::uuid,
    case when $8='direct_message' then null else coalesce($10::timestamptz,clock_timestamp()+interval '1 day') end,$11::jsonb,$12,'production-fixture'
   from tlb.secrets s where s.id`,[id,prefix+'-'+label,date,method,payment,status,refund,source,source==='popup'?eventId:null,deadline,JSON.stringify({...payload,...data,source}),randomUUID()]);
  created.push(id);return id;
 };
 await db.query('insert into tlb.pos_events(id,name,starts_on,ends_on,created_by) values($1,$2,$3::date,$3::date,$4)',[eventId,'Production fixture counter',today,ids.owner]);
 try {
  await check('Production: only verified owner/staff can read through the existing gateway',async()=>{
   for(const user of [null,ids.customer,ids.stranger,ids.unverified])await assert.rejects(api('admin_production',range,user),/staff access|required|verify/i);
   await db.query("insert into tlb.staff(user_id,role) values($1,'staff')",[ids.unverified]);
   try {await assert.rejects(api('admin_production',range,ids.unverified),/verify your staff email/i);}
   finally {await db.query('delete from tlb.staff where user_id=$1',[ids.unverified]);}
   for(const user of [ids.owner,ids.staff]){
    const result=await api('admin_production',range,user);assert.equal(result.today,today);assert.ok(Array.isArray(result.orders));
   }
   for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.admin_production(jsonb)','EXECUTE')",[role]),false);
   const definition=await h.scalar("select pg_get_functiondef('tlb.admin_production(jsonb)'::regprocedure)");assert.doesNotMatch(definition,/SECURITY DEFINER/);
  })();
  await check('Production: strict inclusive date ranges reject missing, malformed and oversized requests',async()=>{
   for(const request of [null,[],{}, {from:range.from}, {to:range.to},{from:'today',to:range.to},{from:'2080-02-30',to:range.to},
    {from:'2080-2-01',to:range.to},{from:'0000-01-01',to:range.to},{from:range.to,to:range.from},{from:'2080-01-01',to:'2081-01-01'}])
    await assert.rejects(api('admin_production',request,ids.staff),/Invalid request|valid production dates|production range/i);
   assert.ok(Array.isArray((await api('admin_production',{from:'2080-01-01',to:'2080-12-31'},ids.staff)).orders),'366 inclusive days are allowed');
  })();
  const first=await insert('first',range.from),middle=await insert('middle','2080-05-02',{source:'direct_message',method:'delivery'}),last=await insert('last',range.to,{status:'completed'});
  const before=await insert('before','2080-04-30'),after=await insert('after','2080-05-04');
  const unpaid=await insert('unpaid',range.from,{payment:'awaiting_payment',status:'pending_confirmation'}),review=await insert('review',range.from,{payment:'under_review',status:'pending_confirmation'});
  await check('Production: fulfillment dates include both endpoints and retain unpaid orders for the exclusion note',async()=>{
   const rows=selected(await api('admin_production',range,ids.owner));assert.deepEqual(rows.map(order=>order.id).sort(),[first,middle,last,unpaid,review].sort());
   assert.ok(rows.some(order=>order.id===middle&&order.source==='direct_message'&&order.method==='delivery'));
   assert.ok(rows.some(order=>order.id===last&&order.fulfillment_status==='completed'));
   assert.ok(!rows.some(order=>[before,after].includes(order.id)),'Future pending orders before the requested range are not overdue');
   const single=selected(await api('admin_production',{from:range.to,to:range.to},ids.staff));assert.deepEqual(single.map(order=>order.id),[last]);
  })();
  await check('Production: snapshots preserve saved quantities and choices while omitting private order fields',async()=>{
   const entry=selected(await api('admin_production',range,ids.staff)).find(order=>order.id===first);
   assert.deepEqual(entry.buyer,{name:payload.buyer.name});assert.equal(entry.instructions,payload.instructions);
   const allowed=['product_id','name','quantity','selections','selection_labels','flavor_contents','custom','description'];
   assert.deepEqual(entry.items[0],Object.fromEntries(allowed.map(key=>[key,payload.items[0][key]])));
   assert.equal(entry.items[0].quantity,1,'A saved one-unit POS/website line is not raised to catalog minimums');
   for(const key of ['access_token','access_digest','access_encrypted','proof_path','payment_reference','staff_notes','history','request_hash','idempotency_key','user_id'])assert.equal(entry[key],undefined);
   assert.doesNotMatch(JSON.stringify(entry),/DO-NOT-EXPOSE|private@example|09171234567|private\/proof/);
  })();
  const overdue=await insert('overdue',await h.day(-3),{source:'direct_message',status:'preparing'});
  const oldCompleted=await insert('old-completed',await h.day(-3),{status:'completed'});
  const oldUnpaid=await insert('old-unpaid',await h.day(-3),{payment:'awaiting_payment',status:'pending_confirmation'});
  const yesterday=await insert('yesterday',await h.day(-1),{status:'ready_for_pickup'});
  const nonProduction=await insert('unconfirmed-paid',await h.day(-2),{status:'pending_confirmation'});
  const popup=await insert('popup',range.from,{source:'popup',status:'completed'}),refunded=await insert('refunded',range.from,{refund:true});
  const cancelled=await insert('cancelled',range.from,{status:'cancelled'}),expired=await insert('expired',range.from,{payment:'awaiting_payment',status:'expired'});
  await check('Production: earlier paid pending work is returned once; completed, unpaid, pop-up and closed work is excluded appropriately',async()=>{
   const rows=selected(await api('admin_production',range,ids.staff)),rowIds=rows.map(order=>order.id);
   for(const id of [overdue,yesterday])assert.ok(rowIds.includes(id));
   for(const id of [oldCompleted,oldUnpaid,nonProduction,popup,refunded,cancelled,expired])assert.ok(!rowIds.includes(id));
   const overlap=selected(await api('admin_production',{from:await h.day(-3),to:today},ids.staff));
   assert.equal(overlap.filter(order=>order.id===overdue).length,1,'An overdue order already in range is not duplicated');
   assert.ok(overlap.some(order=>order.id===oldCompleted),'Completed work remains visible within its selected historical day');
   const historical=selected(await api('admin_production',{from:await h.day(-3),to:await h.day(-3)},ids.staff));
   assert.ok(!historical.some(order=>order.id===yesterday),'More recent overdue work outside a historical range is excluded');
  })();
  await check('Production: more than a thousand matching orders are counted without a dashboard pagination cap',async()=>{
   const rows=(await db.query(`with fixtures as (select gen_random_uuid() id,n from generate_series(1,1205) n)
    insert into tlb.orders(id,reference,access_digest,access_encrypted,created_at,fulfillment_date,method,payment_status,fulfillment_status,data,idempotency_key,request_hash)
    select f.id,$1||'-bulk-'||lpad(f.n::text,4,'0'),extensions.digest(f.id::text,'sha256'),seed.access_encrypted,'2001-01-01'::timestamptz,'2080-05-02','pickup','paid','confirmed',seed.data,gen_random_uuid(),'production-bulk'
    from fixtures f cross join tlb.orders seed where seed.id=$2 returning id`,[prefix,first])).rows;created.push(...rows.map(row=>row.id));
   const result=selected(await api('admin_production',range,ids.staff)),bulk=result.filter(order=>order.reference.includes('-bulk-'));
   assert.equal(bulk.length,1205);assert.equal(bulk.reduce((sum,order)=>sum+order.items.reduce((subtotal,item)=>subtotal+item.quantity,0),0),1205);
   assert.deepEqual(result.map(order=>[order.fulfillment_date,order.reference]),[...result].sort((a,b)=>a.fulfillment_date.localeCompare(b.fulfillment_date)||a.reference.localeCompare(b.reference)).map(order=>[order.fulfillment_date,order.reference]));
  })();
  await check('Production: report reads run inside a read-only transaction and never expire unpaid orders or change queues',async()=>{
   const due=await insert('expired-deadline',today,{payment:'awaiting_payment',status:'pending_confirmation',deadline:'2001-01-01T00:00:00Z'});
   const facts=async()=>{
    const result={};for(const table of ['orders','allocations','payments','history','outbox','calendar_events','order_backup_connection'])
     result[table]=await h.scalar(`select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),'')) from tlb.${table} t`);
    return result;
   };
   const before=await facts();await db.exec('begin read only');
   try {const report=await api('admin_production',{from:today,to:today},ids.staff);assert.ok(report.orders.some(order=>order.id===due&&order.fulfillment_status==='pending_confirmation'));}
   finally {await db.exec('rollback');}
   assert.deepEqual(await facts(),before);
  })();
  await check('Production: migration replay preserves gateway dispatch and private function privileges',async()=>{
   const before=await h.scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
   await db.exec(await readFile(new URL('../../supabase/migrations/20261015090255_admin_production_summary.sql',import.meta.url),'utf8'));
   assert.equal(await h.scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)"),before);
   assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.admin_production(jsonb)','EXECUTE')"),false);
   assert.equal(selected(await api('admin_production',range,ids.owner)).filter(order=>order.reference.includes('-bulk-')).length,1205);
  })();
 } finally {
  const dependencies=(await db.query("select c.conrelid::regclass::text as name,quote_ident(a.attname) as column_name from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.contype='f' and c.confrelid='tlb.orders'::regclass")).rows;
  for(const {name,column_name} of dependencies)await db.query(`delete from ${name} where ${column_name}=any($1::uuid[])`,[created]);
  await db.query('delete from tlb.orders where id=any($1::uuid[])',[created]);
  await db.query('delete from tlb.calendar_events where order_id=any($1::uuid[])',[created]);
  await db.query('delete from tlb.pos_events where id=$1',[eventId]);
 }
}
