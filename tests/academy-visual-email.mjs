import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup} from './academy-portal.mjs';
import {renderAcademyEmail} from '../assets/ordering/academy-email-render.js';
const s=await setup(),{db,h,api,service}=s;let passed=0;
const check=async(name,fn)=>{await fn();console.log('PASS',name);passed++;};
const content={layout:'invitation',preheader:'Bake with us',eyebrow:'From TLB Academy',headline:'Your next baking adventure',intro:'Join our kitchen.',hero_url:'https://thelittlebakerkitchen.com/class.jpg',hero_alt:'Bakers making cookies',cta_label:'Reserve your place',cta_url:'https://thelittlebakerkitchen.com/academy.html',items:[{title:'Chocolate cookies',description:'A hands-on class',image_url:'https://thelittlebakerkitchen.com/cookies.jpg',alt:'Chocolate chip cookies'}]};
const base={kind:'marketing',subject:'An invitation to bake',body:'All the class details.',email_content:content};
let template,broadcast;
try{
 await check('Owner templates retain every visual field, image, highlight and button without queueing',async()=>{
  const before=(await db.query('select count(*) n from tlb.outbox')).rows[0].n;
  template=await api(h.ids.owner,'save_email_template',{...base,name:'Visual class invitation',request_key:randomUUID()});
  assert.deepEqual(template.email_content,content);const loaded=await api(h.ids.owner,'email_templates',{kind:'marketing'});assert.deepEqual(loaded.templates[0].email_content,content);assert.equal(loaded.visual_email_templates,true);
  assert.equal((await db.query('select count(*) n from tlb.outbox')).rows[0].n,before);
 });
 await check('Template retries and revisions include the photos and layout in their checks',async()=>{
  const p={...base,name:'A saved design',request_key:randomUUID()};const t=await api(h.ids.owner,'save_email_template',p);assert.equal((await api(h.ids.owner,'save_email_template',p)).id,t.id);
  await assert.rejects(api(h.ids.owner,'save_email_template',{...p,email_content:{...content,hero_url:'https://example.com/different.jpg'}}));
  const updated=await api(h.ids.owner,'save_email_template',{...p,id:t.id,revision:t.revision,email_content:{...content,layout:'journal'}});assert.equal(updated.email_content.layout,'journal');await assert.rejects(api(h.ids.owner,'save_email_template',{...p,id:t.id,revision:t.revision}));
 });
 await check('Invalid URLs, missing photo descriptions, HTML fields, malformed cards and excessive content are rejected',async()=>{
  const invalid=[{...content,hero_url:'javascript:alert(1)'},{...content,hero_url:'data:image/svg+xml,test'},{...content,hero_url:'https://owner:password@example.com/x'},{...content,hero_url:'https://example.com/\nimage.jpg'},{...content,hero_url:'https://example.com\\@evil.test/x'}, {...content,hero_alt:''},{...content,cta_label:''},{...content,html:'<script>alert(1)</script>'},{...content,items:[{title:'Photo',image_url:'https://example.com/x',alt:''}]},{...content,items:Array(5).fill(content.items[0])},{...content,items:{}},{...content,headline:{html:'bad'}},{...content,headline:'a'.repeat(181)},{...content,items:[{title:'',description:'missing'}]},null,[],{layout:'unknown'}];
  for(const email_content of invalid){await assert.rejects(api(h.ids.owner,'save_email_template',{...base,email_content,name:'Bad',request_key:randomUUID()}));await assert.rejects(api(h.ids.owner,'broadcast_preview',{...base,email_content,audience:'subscribers'}));}
 });
 await check('Visual email APIs and stored templates remain owner-only',async()=>{
  for(const user of [null,h.ids.customer,h.ids.staff]){await assert.rejects(api(user,'save_email_template',{...base,name:'Denied'}));await assert.rejects(api(user,'broadcast_send',{...base,audience:'subscribers',idempotency_key:randomUUID()}));}
  await assert.rejects(h.as(h.ids.customer,()=>db.query('select tlb.academy_validate_email_content($1)',[JSON.stringify(content)])));
 });
 await check('Preview is read-only; queued email snapshots retain the full design and exclude non-subscribers',async()=>{
  await api(h.ids.customer,'newsletter',{academy:true});await api(h.ids.stranger,'newsletter',{academy:false});await db.query("update tlb.settings set data=jsonb_set(data,'{pickup_address}','\"Synthetic test kitchen\"') where id");
  const before=(await db.query('select count(*) n from tlb.outbox')).rows[0].n;
  assert.equal((await api(h.ids.owner,'broadcast_preview',{...base,audience:'subscribers'})).recipients,1);assert.equal((await db.query('select count(*) n from tlb.outbox')).rows[0].n,before);
  const p={...base,audience:'subscribers',idempotency_key:randomUUID()};broadcast=await api(h.ids.owner,'broadcast_send',p);assert.equal((await api(h.ids.owner,'broadcast_send',p)).id,broadcast.id);
  await assert.rejects(api(h.ids.owner,'broadcast_send',{...p,email_content:{...content,layout:'journal'}}));
  const rows=(await db.query("select * from tlb.outbox where payload->>'broadcast_id'=$1",[broadcast.id])).rows;assert.equal(rows.length,1);assert.deepEqual(rows[0].payload.email_content,content);assert.equal(rows[0].to_email,'customer@example.test');
  const rendered=renderAcademyEmail(rows[0].payload);assert.ok(rendered.html.includes(content.hero_url)&&rendered.html.includes(content.cta_url));assert.ok(rendered.text.includes('Chocolate cookies'));
 });
 await check('Editing or deleting a template never changes an already queued email',async()=>{
  await api(h.ids.owner,'save_email_template',{...base,id:template.id,revision:template.revision,name:'Changed',email_content:{...content,hero_url:'https://example.com/new.jpg'}});await api(h.ids.owner,'delete_email_template',{id:template.id});
  assert.deepEqual((await db.query("select payload->'email_content' c from tlb.outbox where payload->>'broadcast_id'=$1",[broadcast.id])).rows[0].c,content);
 });
 await check('Queued visual marketing email is skipped when consent is withdrawn',async()=>{
  await api(h.ids.customer,'newsletter',{academy:false});const lease=randomUUID();const out=(await db.query("update tlb.outbox set status='sending',lease_token=$1,leased_until=now()+interval '5 minutes' where payload->>'broadcast_id'=$2 returning id",[lease,broadcast.id])).rows[0];
  const prepared=await service('shop_service',['prepare_email',{id:out.id,lease_token:lease}]);assert.equal(prepared.skip,true);
 });
 await check('Existing plain templates and operational emails remain compatible',async()=>{
  const p={kind:'operational',subject:'Class reminder',body:'Bring an apron.',name:'Legacy',request_key:randomUUID()};const t=await api(h.ids.owner,'save_email_template',p);assert.deepEqual(t.email_content,{});
  const b=await api(h.ids.owner,'broadcast_send',{...p,audience:'students',idempotency_key:randomUUID()});const row=(await db.query("select payload from tlb.outbox where payload->>'broadcast_id'=$1 limit 1",[b.id])).rows[0];const r=renderAcademyEmail(row.payload);assert.ok(r.html.includes('Bring an apron.'));assert.ok(!r.html.includes('Unsubscribe from Academy marketing'));
 });
 console.log(`${passed} visual email database checks passed`);
}finally{await db.close();}
