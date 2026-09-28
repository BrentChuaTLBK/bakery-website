import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}){
 const h=state.harness,{api,ids}=h;
 let current=(await api('admin_bootstrap',{},ids.owner)).settings;
 const original=structuredClone(current);
 const option=(label,number)=>({id:randomUUID(),label,account_name:'QA Account Only',account_number:number,note:'',enabled:true});
 let options=[option('GCash','00000000001'),option('BDO','000000000002'),option('East West','000000000003')];
 await check('payment options: conservative migration keeps exact text and leading zeros',async()=>{
  const text='Accepted Payment Methods:\n\nGCash\nQA Account\n00000000001\n\nBDO\nQA Bank\n000000000002';
  const result=await h.scalar('select tlb.parse_legacy_payment_options($1)',[text]);
  assert.equal(result.length,2);assert.equal(result[1].account_number,'000000000002');
  for(const value of ['Other instructions',text+'\nDo not change this note',text.replace('00000000001','not a number')])assert.equal(await h.scalar('select tlb.parse_legacy_payment_options($1)',[value]),null);
 })();
 await check('payment options: owner-only edits validate structure and preserve numeric strings',async()=>{
  for(const user of [null,ids.staff,ids.customer,ids.unverified])await assert.rejects(api('save_settings',{settings:{payment_options:options,payment_note:'',payment_options_revision:0}},user),/owner|authorized|verified/i);
  current=await api('save_settings',{settings:{payment_options:options,payment_note:'Use your order reference.',payment_options_revision:0,paused:false}},ids.owner);
  assert.equal(current.payment_options_revision,1);assert.deepEqual(current.payment_options,options);
  assert.match(current.payment_instructions,/BDO\nQA Account Only\n000000000002/);assert.match(current.payment_instructions,/Use your order reference\./);
  const bad=[null,{},[{...options[0],account_number:123}], [{...options[0],enabled:'true'}], [{...options[0],account_number:'000\n111'}], [options[0],options[0]], [{...options[0],id:'bad'}], [{...options[0],account_name:''}], [{...options[0],note:'x'.repeat(301)}], [{...options[0],extra:true}], Array.from({length:21},()=>option('Bank','000111'))];
  for(const list of bad)await assert.rejects(api('save_settings',{settings:{payment_options:list,payment_note:'',payment_options_revision:1}},ids.owner),/payment options/i);
  await assert.rejects(api('save_settings',{settings:{payment_note:'x'.repeat(1001)}},ids.owner),/1000/);
  await assert.rejects(api('save_settings',{settings:{payment_options:options.map(p=>({...p,enabled:false})),payment_options_revision:1}},ids.owner),/at least one/i);
 })();
 await check('payment options: checkout and queued email freeze the supplied account details',async()=>{
  const {product,date}=await h.fixture(5);
  const before=await api('create_order',h.checkout(product,date));
  assert.deepEqual(before.payment_options,options);assert.equal(before.payment_note,'Use your order reference.');
  const beforeEmail=await h.scalar("select payload from tlb.outbox where order_id=$1 and event_type='order_submitted'",[before.id]);
  assert.deepEqual(beforeEmail.order.payment_options,options);assert.equal(beforeEmail.order.payment_instructions,current.payment_instructions);
  const fourth=option('Another bank','000000000004');
  options=[fourth,{...options[2],account_number:'000000000009'}, {...options[0],enabled:false}];
  current=await api('save_settings',{settings:{payment_options:options,payment_note:'Updated instructions.',payment_options_revision:1}},ids.owner);
  assert.equal(current.payment_options_revision,2);assert.doesNotMatch(current.payment_instructions,/GCash|000000000001/);
  const after=await api('create_order',h.checkout(product,date));
  assert.deepEqual(after.payment_options,options.filter(p=>p.enabled));assert.equal(after.payment_note,'Updated instructions.');
  assert.equal((await h.order(before.id)).payment_instructions,before.payment_instructions);
  assert.deepEqual((await h.order(before.id)).payment_options,before.payment_options);
  assert.deepEqual(await h.scalar("select payload from tlb.outbox where order_id=$1 and event_type='order_submitted'",[before.id]),beforeEmail);
 })();
 await check('payment options: stale updates cannot overwrite bank details; unchanged retries remain safe',async()=>{
  const retry=await api('save_settings',{settings:{payment_options:options,payment_note:'Updated instructions.',payment_options_revision:1}},ids.owner);
  assert.equal(retry.payment_options_revision,2);
  await assert.rejects(api('save_settings',{settings:{payment_options:[...options].reverse(),payment_options_revision:1}},ids.owner),/another window/);
  const stable=await api('save_settings',{settings:{shop_name:current.shop_name}},ids.owner);
  assert.deepEqual(stable.payment_options,options);assert.equal(stable.payment_options_revision,2);
  // Legacy callers cannot replace generated account instructions behind the cards.
  const overwrite=await api('save_settings',{settings:{payment_instructions:'Wrong account'}},ids.owner);
  assert.equal(overwrite.payment_instructions,current.payment_instructions);
 })();
 // Restore fixture settings without sending anything outside the local database.
 await db.query('update tlb.settings set data=$1::jsonb where id',[JSON.stringify(original)]);
}
