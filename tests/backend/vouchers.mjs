import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.harness,{api,ids,scalar}=h;
 const terms={trigger:'first_completed',kind:'fixed',value:2500,min_subtotal_cents:10000,customer_limit:1,expiry_mode:'days',expiry_days:30};
 const user=async(subscribed=false)=>{const id=randomUUID(),email=`voucher-${id}@example.test`;await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);if(subscribed)await db.query("insert into tlb.newsletter_subscribers(email,status,source,consent_version,unsubscribe_token_hash,request_id) values($1,'subscribed','homepage','test',$2,gen_random_uuid())",[email,createHash('sha256').update(randomBytes(32)).digest('hex')]);return{id,email}};
 const create=async(u,extra={})=>{const {product,date}=await h.fixture(20,{price_cents:20000});return api('create_order',h.checkout(product,date,{buyer:{name:'Voucher customer',email:u.email,phone:'09171234567',social_platform:'instagram',social_username:'qa'},...extra}),u.id)};
 const complete=async(o)=>h.action('set_fulfillment',await h.action('approve_payment',await h.proof(o)),{status:'completed'});
 const save=campaign=>api('voucher_save_campaign',{campaign},ids.owner);
 const wallet=(u,status='available',offset=0)=>api('my_vouchers',{status,offset},u.id);
 const total=()=>scalar('select count(*)::int from tlb.vouchers');
 let campaign,eligible,source,reward;
 await check('Vouchers: empty rollout and owner-only draft-first campaign administration',async()=>{
  assert.equal(await total(),0);assert.deepEqual((await api('voucher_campaigns',{},ids.owner)).campaigns,[]);
  for(const actor of [null,ids.customer,ids.staff])await assert.rejects(api('voucher_save_campaign',{campaign:{name:'Thanks',terms}},actor),/owner|authorized/i);
  await assert.rejects(save({name:'Thanks',status:'active',terms}),/draft/i);
  campaign=await save({name:'Thanks from TLB',terms});assert.equal(campaign.status,'draft');
  const preview=await api('voucher_email_preview',{id:campaign.id},ids.owner);assert.equal(preview.payload.offer.code,'A7K2M9');assert.equal(await total(),0);
  const existing=await user();await complete(await create(existing));assert.equal(await total(),0);
  campaign=await save({...campaign,status:'active'});
  await complete(await create(existing));assert.equal(await total(),0,'Previously completed customers do not become first-time buyers at activation');
 })();
 await check('Vouchers: only paid completed website orders issue one personal code and one email',async()=>{
  eligible=await user(true);source=await create(eligible);assert.equal(await total(),0);
  source=await h.action('approve_payment',await h.proof(source));assert.equal(await total(),0);
  source=await h.action('set_fulfillment',source,{status:'completed'});
  reward=(await wallet(eligible)).vouchers[0];assert.match(reward.code,/^(?=.*[A-Z])(?=.*[2-9])[A-HJ-NP-Z2-9]{6}$/);assert.equal(reward.value,2500);assert.equal(reward.status,'available');
  assert.equal(await scalar('select count(*)::int from tlb.outbox where voucher_id=$1',[reward.id]),1);
  await db.query("update tlb.orders set fulfillment_status='preparing' where id=$1",[source.id]);await db.query("update tlb.orders set fulfillment_status='completed' where id=$1",[source.id]);
  assert.equal(await total(),1,'Status toggles are idempotent');
  await complete(await create(eligible));assert.equal(await total(),1,'First-order campaign cannot issue twice');
 })();
 await check('Vouchers: short mixed codes retry collisions with existing offers',async()=>{
  const samples=(await db.query('select tlb.short_offer_code() code from generate_series(1,500)')).rows;
  for(const {code} of samples)assert.match(code,/^(?=.*[A-Z])(?=.*[2-9])[A-HJ-NP-Z2-9]{6}$/);
  await db.exec('begin');
  try{
   // Force the first candidate to collide; the issuer must retry without
   // overwriting the earlier voucher or sending its code to another customer.
   await db.exec('create temporary sequence offer_collision');
   await db.query(`create or replace function tlb.short_offer_code() returns text language plpgsql volatile security invoker set search_path='' as $$ begin if nextval('pg_temp.offer_collision')=1 then return '${reward.code}'; end if; return 'Z8Y7X6'; end $$`);
   const u=await user(true);await complete(await create(u));const v=(await wallet(u)).vouchers[0];
   assert.equal(v.code,'Z8Y7X6');assert.equal((await wallet(eligible)).vouchers[0].code,reward.code);
   assert.equal((await scalar('select payload from tlb.outbox where voucher_id=$1',[v.id])).offer.code,v.code);
  }finally{await db.exec('rollback');}
 })();
 await check('Vouchers: previously issued long codes still display and redeem unchanged',async()=>{
  await db.exec('begin');
  try{
   const oldCode='TLB-AB12CD34EF';
   await db.query("update tlb.promos set code=$2,data=jsonb_set(data,'{code}',to_jsonb($2::text)) where id=$1",[reward.id,oldCode]);
   assert.equal((await wallet(eligible)).vouchers[0].code,oldCode);
   const {product,date}=await h.fixture(20,{price_cents:20000});
   assert.equal((await api('quote',h.checkout(product,date,{promo_code:oldCode}),eligible.id)).discount_cents,2500);
  }finally{await db.exec('rollback');}
 })();
 await check('Vouchers: POS and Direct Message orders never earn thank-you codes or completion history',async()=>{
  const before=await total(),u=await user(),date=await h.day(20),today=await h.day(0);
  const direct={source:'direct_message',method:'pickup',fulfillment_date:date,buyer:{email:u.email},items:[{name:'Custom DM cake',quantity:1,unit_price_cents:10000}],email_notifications:false,payment:{method:'gcash',amount_cents:10000,received_cents:10000}};
  const q=await api('pos_quote',direct,ids.owner);let dm=await api('pos_create_order',{...direct,expected_quote:q,idempotency_key:randomUUID()},ids.owner);dm=await h.action('set_fulfillment',dm,{status:'completed'});
  const customId=randomUUID(),event=await api('pos_save_event',{name:'Voucher exclusion fixture',starts_on:today,ends_on:today,stock:[],custom_stock:[{id:customId,name:'Test pastry',capacity:5,price_cents:10000}]},ids.owner);
  const popup={source:'popup',event_id:event.id,method:'pickup',fulfillment_date:today,buyer:{email:u.email},items:[{custom_event_item_id:customId,quantity:1}],email_notifications:false,payment:{method:'gcash',amount_cents:10000,received_cents:10000}};
  const pq=await api('pos_quote',popup,ids.owner);const sale=await api('pos_create_order',{...popup,expected_quote:pq,idempotency_key:randomUUID()},ids.owner);
  assert.equal(sale.fulfillment_status,'completed');assert.equal(await total(),before);
  assert.equal(await scalar('select count(*)::int from tlb.voucher_completions where order_id in ($1,$2)',[dm.id,sale.id]),0);
  await complete(await create(u));assert.equal((await wallet(u)).total,1,'A first website order still qualifies after a DM/POS purchase');
 })();
 await check('Vouchers: verified ownership, no forged buyer email, no admin promo editing or newsletter broadcasts',async()=>{
  await assert.rejects(wallet({id:ids.unverified}),/verify/i);
  assert.equal((await wallet({id:ids.stranger})).total,0);
  const {product,date}=await h.fixture(20,{price_cents:20000}),payload=h.checkout(product,date,{promo_code:reward.code});
  await assert.rejects(api('quote',payload,ids.stranger),/different|belongs|earned this voucher/i);
  const quote=await api('quote',payload,eligible.id);assert.equal(quote.discount_cents,2500);assert.equal(quote.total_cents,17500);
  await assert.rejects(api('save_promo',{promo:{id:reward.id}},ids.owner),/original terms/i);
  await assert.rejects(api('delete_promo',{id:reward.id},ids.owner),/original terms/i);
  assert.equal((await api('admin_bootstrap',{},ids.owner)).promos.some(p=>p.id===reward.id),false);
  const newsletter=(action,payload)=>h.as(ids.owner,async()=>(await db.query('select public.newsletter_admin($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
  await db.query("update tlb.newsletter_config set segment_id='test-segment',topic_id='test-topic'");
  const draft=await newsletter('save',{id:randomUUID(),revision:0,content:{template:'showcase',subject:'Personal voucher guard',title:'Test only',offer_code:reward.code,cta_url:'https://example.test/shop.html',items:[]}});
  await assert.rejects(newsletter('queue',{id:draft.id,revision:draft.revision,confirm:true}),/regular promo|personal/i);
  assert.equal(await scalar('select count(*)::int from tlb.newsletter_broadcast_jobs where campaign_id=$1',[draft.id]),0);
 })();
 await check('Vouchers: redemption reserves once, refund releases it, restoring after reuse is rejected',async()=>{
  const {product,date}=await h.fixture(20,{price_cents:20000});const payload=()=>h.checkout(product,date,{promo_code:reward.code});
  let order=await api('create_order',payload(),eligible.id);assert.equal((await wallet(eligible)).vouchers[0].status,'reserved');
  await assert.rejects(api('create_order',payload(),eligible.id),/use limit/);
  order=await h.action('approve_payment',await h.proof(order));assert.equal((await wallet(eligible,'used')).vouchers[0].status,'used');
  order=await h.action('set_refund_label',order,{enabled:true});assert.equal((await wallet(eligible)).vouchers[0].status,'available');
  let next=await api('create_order',payload(),eligible.id);await assert.rejects(h.action('set_refund_label',order,{enabled:false}),/already been reused/i);
  await h.action('cancel_order',next,{reason:'Test release'});await h.action('set_refund_label',order,{enabled:false});
  const stats=(await api('voucher_campaigns',{},ids.owner)).campaigns.find(c=>c.id===campaign.id).stats;
  assert.equal(stats.used,1);assert.equal(stats.sales_cents,17500);assert.equal(stats.discount_cents,2500);
 })();
 await check('Vouchers: opted-out customers still get wallet rewards but no marketing delivery',async()=>{
  const u=await user();await complete(await create(u));const v=(await wallet(u)).vouchers[0];
  assert.equal(await scalar('select status from tlb.outbox where voucher_id=$1',[v.id]),'skipped');
  assert.equal(await scalar('select count(*)::int from tlb.voucher_email_tokens where voucher_id=$1',[v.id]),0);
 })();
 await check('Vouchers: guest issuance follows verified email and cannot be claimed by another account',async()=>{
  const u=await user(),guest=await create({id:null,email:u.email});await complete(guest);
  assert.equal((await wallet(u)).total,1);await complete(await create(u));assert.equal((await wallet(u)).total,1,'Guest-to-account does not reset first-order eligibility');
 })();
 await check('Vouchers: campaign edits preserve issued terms and queued email; pause prevents new rewards',async()=>{
  const original=await scalar('select payload from tlb.outbox where voucher_id=$1',[reward.id]);
  const stale=campaign;campaign=await save({...campaign,terms:{...terms,value:5000},email_subject:'A new thank-you',email_copy:{eyebrow:'Thanks',heading:'{{discount}} for you',message:'A new message'}});
  await assert.rejects(save({...stale,name:'Stale edit'}),/changed/i);
  assert.equal((await scalar('select data from tlb.promos where id=$1',[reward.id])).value,2500);assert.deepEqual(await scalar('select payload from tlb.outbox where voucher_id=$1',[reward.id]),original);
  campaign=await save({...campaign,status:'paused'});const before=await total();await complete(await create(await user()));assert.equal(await total(),before);
 })();
 await check('Vouchers: every-order campaign honors customer limit, cap, fixed expiry and source refunds',async()=>{
  const expires=new Date(Date.now()+86400000).toISOString();let c=await save({name:'Repeat thank-you',terms:{...terms,trigger:'every_completed',kind:'percent',value:20,cap_cents:1500,customer_limit:2,expiry_mode:'fixed',expires_at:expires}});c=await save({...c,status:'active'});
  const u=await user();let o=await complete(await create(u));await complete(await create(u));await complete(await create(u));assert.equal((await wallet(u)).total,2);
  const v=(await wallet(u)).vouchers[0],{product,date}=await h.fixture(10,{price_cents:20000});assert.equal((await api('quote',h.checkout(product,date,{promo_code:v.code}),u.id)).discount_cents,1500);
  o=await h.action('set_refund_label',o,{enabled:true});assert.equal((await wallet(u,'expired')).vouchers[0].status,'inactive');
  const invalid=(await wallet(u,'expired')).vouchers[0];await assert.rejects(api('quote',h.checkout(product,date,{promo_code:invalid.code}),u.id),/qualifying|eligible|available/i);
  await db.query("update tlb.promos set data=jsonb_set(data,'{expires_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",[v.id]);await assert.rejects(api('quote',h.checkout(product,date,{promo_code:v.code}),u.id),/expired/);
  await save({...c,status:'paused'});
 })();
 await check('Vouchers: existing newsletter codes appear in the wallet without reissue or expiry changes',async()=>{
  const u=await user(true),token=randomBytes(32).toString('hex');await db.query('update tlb.newsletter_subscribers set unsubscribe_token_hash=$2 where email=$1',[u.email,createHash('sha256').update(token).digest('hex')]);
  await db.query('select tlb.queue_newsletter_welcome($1,$2)',[u.email,token]);
  const before=await scalar('select payload from tlb.outbox where to_email=$1 and event_type=$2',[u.email,'newsletter_welcome']);
  const first=(await wallet(u)).vouchers[0];assert.equal(first.source,'newsletter');assert.equal(first.code,before.welcome_offer.code);assert.match(first.code,/^(?=.*[A-Z])(?=.*[2-9])[A-HJ-NP-Z2-9]{6}$/);assert.equal(Date.parse(first.expires_at),Date.parse(before.welcome_offer.expires_at));
  await wallet(u);assert.deepEqual(await scalar('select payload from tlb.outbox where to_email=$1 and event_type=$2',[u.email,'newsletter_welcome']),before);
 })();
 await check('Vouchers: unsubscribe tokens resolve only while their original consent remains current',async()=>{
  const p=await scalar('select payload from tlb.outbox where voucher_id=$1',[reward.id]);
  const call=()=>h.as(null,async()=>(await db.query('select public.newsletter_service($1,$2::jsonb) result',['begin_unsubscribe',JSON.stringify({token_hash:createHash('sha256').update(p.unsubscribe_token).digest('hex')})])).rows[0].result,'service_role');
  const result=await call();assert.ok(result.operation_id);assert.equal(result.email,eligible.email);
  await db.query("update tlb.newsletter_subscribers set operation_id=null,operation_kind=null,operation_expires_at=null,unsubscribe_token_hash=$2 where email=$1",[eligible.email,'b'.repeat(64)]);
  assert.equal((await call()).valid,false,'An old token cannot revoke a later subscription');
 })();
 await check('Vouchers: marketing consent and qualifying source are checked again before delivery',async()=>{
  const row=(await db.query('select * from tlb.outbox where voucher_id=$1',[reward.id])).rows[0],lease=randomUUID();
  await db.query("update tlb.outbox set status='sending',lease_token=$2,leased_until=now()+interval '1 minute' where id=$1",[row.id,lease]);
  await db.query("update tlb.newsletter_subscribers set status='unsubscribed' where email=$1",[eligible.email]);
  assert.equal((await h.service('prepare_email',{id:row.id,lease_token:lease})).skip,true);
  assert.equal(await scalar('select status from tlb.outbox where id=$1',[row.id]),'skipped');
 })();
 await check('Vouchers: pre-send checks reject changed consent, source, expiry and account email',async()=>{
  let c=await save({name:'Delivery guard tests',terms:{...terms,trigger:'every_completed'}});c=await save({...c,status:'active'});
  const u=await user(true),o=await complete(await create(u)),v=(await wallet(u)).vouchers[0];
  const row=(await db.query('select * from tlb.outbox where voucher_id=$1',[v.id])).rows[0];
  for(const scenario of ['valid','optout','unsubscribe_in_progress','new_consent','new_email','refunded','cancelled','expired']){
   await db.exec('begin');
   try{
    const lease=randomUUID();await db.query("update tlb.outbox set status='sending',lease_token=$2,leased_until=now()+interval '1 minute' where id=$1",[row.id,lease]);
    if(scenario==='optout')await db.query("update tlb.newsletter_subscribers set status='unsubscribed' where email=$1",[u.email]);
    if(scenario==='unsubscribe_in_progress')await db.query("update tlb.newsletter_subscribers set operation_id=gen_random_uuid(),operation_kind='unsubscribe',operation_expires_at=now()+interval '5 minutes' where email=$1",[u.email]);
    if(scenario==='new_consent')await db.query("update tlb.newsletter_subscribers set unsubscribe_token_hash=$2 where email=$1",[u.email,'c'.repeat(64)]);
    if(scenario==='new_email')await db.query("update auth.users set email='changed@example.test' where id=$1",[u.id]);
    if(scenario==='refunded')await db.query('update tlb.orders set refund_label=true where id=$1',[o.id]);
    if(scenario==='cancelled')await db.query("update tlb.orders set fulfillment_status='cancelled' where id=$1",[o.id]);
    if(scenario==='expired')await db.query("update tlb.outbox set payload=jsonb_set(payload,'{offer,expires_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",[row.id]);
    const prepared=await h.service('prepare_email',{id:row.id,lease_token:lease});
    if(scenario==='valid'){assert.equal(prepared.to_email,u.email);assert.deepEqual(prepared.payload,row.payload);}
    else {assert.equal(prepared.skip,true,scenario);assert.equal(await scalar('select status from tlb.outbox where id=$1',[row.id]),'skipped',scenario);}
   }finally{await db.exec('rollback');}
  }
  await save({...c,status:'paused'});
 })();
 await check('Vouchers: invalid email copy, expired activation and discount caps are rejected',async()=>{
  for(const changes of [{value:0},{kind:'percent',value:101,cap_cents:1000},{kind:'percent',value:10,cap_cents:0},{customer_limit:0},{expiry_days:366}])await assert.rejects(save({name:'Invalid',terms:{...terms,...changes}}));
  await assert.rejects(save({name:'Invalid',terms,email_subject:'Header\r\nBcc: attacker@example.test'}),/subject/i);
  await assert.rejects(save({name:'Invalid',terms,email_copy:{heading:'',eyebrow:'Thanks',message:'Hello'}}),/heading/i);
  let expired=await save({name:'Expired draft',terms:{...terms,expiry_mode:'fixed',expires_at:'2000-01-01T00:00:00Z'}});await assert.rejects(save({...expired,status:'active'}),/future expiry/i);
 })();
 await check('Vouchers: private tables and helpers stay inaccessible to browser roles',async()=>{
  for(const role of ['anon','authenticated','service_role'])for(const sig of ['tlb.short_offer_code()','tlb.voucher_api(text,jsonb)','tlb.voucher_completed_order()','tlb.voucher_email_settings()','tlb.promo_use_counts(uuid,uuid)'])assert.equal(await scalar("select has_function_privilege($1,$2,'execute')",[role,sig]),false);
  await assert.rejects(h.as(ids.customer,()=>db.query('select * from tlb.vouchers')),/permission/);
  await assert.rejects(api('voucher_campaign_report',{id:campaign.id},ids.staff),/owner|authorized/i);
  const r=await api('voucher_campaign_report',{id:campaign.id,offset:99999},ids.owner);assert.equal(r.vouchers.length,0);assert.equal(r.limit,50);
 })();
}
