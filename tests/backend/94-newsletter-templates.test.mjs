import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export default async function({db,check,state}){
 const {as,ids,scalar}=state.harness;
 const migration=await readFile(new URL('../../supabase/migrations/20260927203047_newsletter_offer_templates.sql',import.meta.url),'utf8');
 await db.exec(migration);
 const admin=(action,payload={},user=ids.owner)=>as(user,async()=>(await db.query('select public.newsletter_admin($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 const content={template:'promo',subject:'Special offer fixture',title:'A little treat',cta_url:'https://thelittlebakerkitchen.com/shop.html',items:[]};
 const save=(extra={})=>admin('save',{id:randomUUID(),revision:0,content:{...content,...extra}});
 await check('all six newsletter templates save; unknown templates and non-owners are rejected',async()=>{
  for(const template of ['showcase','offer','journal','promo','launch','academy'])assert.equal((await save({template})).content.template,template);
  await assert.rejects(save({template:'unknown'}),/template/);
  for(const user of [null,ids.staff,ids.stranger])await assert.rejects(admin('save',{id:randomUUID(),revision:0,content},user),/owner|authorized|permission/i);
 })();
 await check('promo drafts can be incomplete but cannot send or test without code, heading and terms',async()=>{
  const draft=await save();
  for(const action of ['queue','test'])await assert.rejects(admin(action,{id:draft.id,revision:draft.revision,confirm:true,request_id:randomUUID()}),/Add a promo code/);
  await assert.rejects(save({offer_code:'A'.repeat(101)}),/offer details/);
  await assert.rejects(save({offer_heading:'A'.repeat(181)}),/offer details/);
  await assert.rejects(save({offer_terms:'A'.repeat(2001)}),/offer details/);
 })();
 await check('offer campaigns normalize codes and reject missing, inactive, expired and personal welcome promos',async()=>{
  const cases=[['MISSING',null],['INACTIVE',{active:false}],['EXPIRED',{expires_at:'2020-01-01T00:00:00Z'}],['PERSONAL',{source:'newsletter_welcome'}]];
  for(const [code,extra] of cases){
   if(extra)await db.query('insert into tlb.promos(id,code,data) values($1,$2,$3::jsonb)',[randomUUID(),code,JSON.stringify({code,active:true,...extra})]);
   const draft=await save({offer_code:` ${code.toLowerCase()} `,offer_heading:'15% OFF',offer_terms:'Ends tomorrow.'});assert.equal(draft.content.offer_code,code);
   await assert.rejects(admin('queue',{id:draft.id,revision:draft.revision,confirm:true}),/active regular promo/);
  }
 })();
 await check('a valid special offer snapshots into one Broadcast and never transactional campaign sends',async()=>{
  const code='QA-SWEET15';await db.query('insert into tlb.promos(id,code,data) values($1,$2,$3::jsonb)',[randomUUID(),code,JSON.stringify({code,active:true,kind:'percent',value:15})]);
  const draft=await save({offer_code:code,offer_heading:'15% OFF',offer_terms:'Delivery excluded.'});
  const request={id:draft.id,revision:draft.revision,confirm:true};assert.equal((await admin('queue',request)).delivery_method,'broadcast');await admin('queue',request);
  assert.equal(await scalar('select count(*) from tlb.newsletter_broadcast_jobs where campaign_id=$1',[draft.id]),1);
  assert.deepEqual(await scalar('select content from tlb.newsletter_broadcast_jobs where campaign_id=$1',[draft.id]),draft.content);
  assert.equal(await scalar("select count(*) from tlb.outbox where event_type='newsletter_campaign' and payload->>'campaign_id'=$1",[draft.id]),0);
  await db.exec(migration);assert.equal((await admin('load')).campaigns.find(c=>c.id===draft.id).status,'queued');
 })();
}
