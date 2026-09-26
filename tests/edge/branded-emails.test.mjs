import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';
import {emailProductPhoto,emailDeliveryTrackingUrl} from '../../supabase/functions/_shared/emails-branded.ts';
import {authEmails,renderAuthEmail} from '../../supabase/functions/_shared/auth-emails.ts';
const photo='https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/test/photo.webp';
const base={email_design_version:2,event_type:'ready_for_pickup',settings:{site_url:'https://thelittlebakerkitchen.com',pickup_address:'Current address',pickup_instructions:'Current notes'},product_photos:[photo],order:{id:'sample',reference:'TLB-ABC234',access_token:'private-token',method:'pickup',fulfillment_date:'2026-09-29',payment_deadline:'2026-09-28T00:00:00Z',pickup_address:'Saved address',pickup_instructions:'Saved pickup notes\nSecond line',items:[{name:'Cake <script>',quantity:2,unit_price_cents:15000,line_total_cents:30000,selection_labels:['Cheese & chocolate']}],subtotal_cents:30000,discount_cents:1500,delivery_cents:0,total_cents:28500}};
test('every order event uses the brand, preserves saved facts and escapes customer content',()=>{
 for(const event of ['order_submitted','payment_approved','payment_rejected','order_cancelled','order_expired','order_updated','fulfillment_reminder','ready_for_pickup','pickup_reminder','out_for_delivery','order_review_required']){
  const p={...base,event_type:event};const {html,text}=renderEmail(p);
  assert.match(html,/<html lang="en" dir="ltr">/);assert.match(html,/<title>.+<\/title>/);assert.equal((html.match(/<h1 /g)||[]).length,1);
  assert.match(html,/#764b25/);assert.match(html,/email-stack/);assert.ok(html.includes(photo));assert.match(html,/Cake &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(html,/₱285\.00/);assert.match(html,/−₱15\.00/);assert.match(text,/₱285\.00/);
  if(event==='order_review_required'){assert.doesNotMatch(html,/private-token|Saved pickup notes/);assert.match(html,/manage.html/);}
  else{assert.match(html,/Saved address/);assert.match(html,/Saved pickup notes<br>Second line/);assert.doesNotMatch(html,/Current address|Current notes/);assert.match(html,/#order=sample&amp;token=private-token/);}
  assert.deepEqual(renderEmail(p),{html,text});
 }
});
test('delivery never includes pickup instructions and uses the saved recipient and zone',()=>{
 const {html}=renderEmail({...base,event_type:'out_for_delivery',order:{...base.order,method:'delivery',recipient:{name:'Sample recipient'},address:{line1:'Saved destination'},delivery_zone_name:'Zone A',delivery_zone_description:'Saved zone notes'}});
 for(const value of ['Sample recipient','Saved destination','Zone A','Saved zone notes','no exact time is guaranteed'])assert.ok(html.includes(value));
 assert.doesNotMatch(html,/Saved pickup notes|Pickup details/);
});

test('tracking adds a usable escaped customer button and plaintext URL only to delivery emails',()=>{
 const url='https://web.lalamove.com/track?order=sample&lang=en';
 for(const event_type of ['out_for_delivery','delivery_tracking_updated','order_updated']){
  const result=renderEmail({...base,event_type,order:{...base.order,method:'delivery',delivery_tracking_url:url}});
  assert.match(result.html,/href="https:\/\/web\.lalamove\.com\/track\?order=sample&amp;lang=en"/);
  assert.match(result.html,/>Track delivery<\/span>/);assert.ok(result.text.endsWith('Track delivery:\n'+url));
 }
 for(const payload of [{...base,order:{...base.order,delivery_tracking_url:url}},{...base,event_type:'order_review_required',order:{...base.order,method:'delivery',delivery_tracking_url:url}}]){
  assert.deepEqual(renderEmail(payload),renderEmail({...payload,order:{...payload.order,delivery_tracking_url:undefined}}));
 }
});

test('tracking rejects unsafe or malformed values without exposing them in HTML or text',()=>{
 const p={...base,event_type:'out_for_delivery',order:{...base.order,method:'delivery'}};
 for(const value of [null,0,{},'', 'http://grab.com/track','https:/grab.com/track','https:grab.com/track','javascript:alert(1)','https://user:password@grab.com/track','https://grab.com/track\nheader','https://grab.com/track path','https://grab.com/"onclick="bad','https://grab.com/\'bad','https://grab.com/<script>','https://grab.com/\\evil','https://grab.com/\u0000','https://grab.com/\u007f','https://','https://grab.com/'+ 'x'.repeat(2048)]){
  assert.equal(emailDeliveryTrackingUrl(value),'');assert.deepEqual(renderEmail({...p,order:{...p.order,delivery_tracking_url:value}}),renderEmail(p));
 }
 assert.equal(emailDeliveryTrackingUrl('https://grab.com/track?id=sample#location'),'https://grab.com/track?id=sample#location');
});

test('replacement and temporarily unavailable tracking have matching HTML and plaintext messages',()=>{
 const p={...base,event_type:'delivery_tracking_updated',order:{...base.order,method:'delivery'}};
 for(const [value,copy] of [['https://www.grab.com/ph/','Your courier tracking link has changed.'],[null,'Courier tracking is temporarily unavailable.']]){
  const result=renderEmail({...p,order:{...p.order,delivery_tracking_url:value}});
  for(const content of Object.values(result)){assert.ok(content.includes('Your delivery tracking link was updated'));assert.ok(content.includes(copy));assert.ok(content.includes('₱285.00'));assert.doesNotMatch(content,/rider cancelled|rider canceled/);}
  if(value===null)for(const content of Object.values(result))assert.doesNotMatch(content,/Track delivery/);
 }
});

test('closed or refunded delivery emails never invite customers to track a stored courier link',()=>{
 const p={...base,event_type:'out_for_delivery',order:{...base.order,method:'delivery',delivery_tracking_url:'https://www.grab.com/ph/'}};
 const cases=[...['order_cancelled','order_expired','payment_rejected'].map(event_type=>({...p,event_type})),...['cancelled','expired','completed','refunded'].map(fulfillment_status=>({...p,order:{...p.order,fulfillment_status}})),{...p,order:{...p.order,refund_label:true}}];
 for(const payload of cases){
  const rendered=renderEmail(payload);assert.deepEqual(rendered,renderEmail({...payload,order:{...payload.order,delivery_tracking_url:undefined}}));
  for(const content of Object.values(rendered))assert.doesNotMatch(content,/Track delivery|https:\/\/www\.grab\.com/);
 }
});

test('all existing v1 and no-tracking v2 payloads preserve exact bytes for provider retries',()=>{
 const snapshots=JSON.parse(readFileSync(new URL('./email-tracking-baseline.json',import.meta.url),'utf8'));
 for(const [key,expected] of Object.entries(snapshots)){
  const [version,event_type,method]=key.split('/');const payload={...base,email_design_version:Number(version),event_type,order:{...base.order,method}};
  assert.equal(createHash('sha256').update(JSON.stringify(renderEmail(payload))).digest('hex'),expected,key);
  if(version==='1')assert.deepEqual(renderEmail({...payload,order:{...payload.order,delivery_tracking_url:'https://www.grab.com/ph/'}}),renderEmail(payload),key+' ignores newly added tracking');
 }
});
test('missing/unsafe photos do not hide item details or expose private storage',()=>{
 for(const value of ['javascript:alert(1)','https://evil.test/a.webp','https://thelittlebakerkitchen.com/private/a.webp','https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/sign/payment-proofs/a.webp?token=secret']){
  assert.equal(emailProductPhoto(value,base.settings.site_url),'');
  const {html}=renderEmail({...base,product_photos:[value]});assert.doesNotMatch(html,/class="email-thumb"/);assert.match(html,/Cake &lt;script&gt;/);
 }
});
test('newsletter keeps full terms, uppercase OFF, exact expiry and unsubscribe without granting old subscribers a code',()=>{
 const p={email_design_version:2,event_type:'newsletter_welcome',settings:base.settings,unsubscribe_token:'a'.repeat(64),welcome_offer:{code:'7K4M9Q',value:5,min_subtotal_cents:30000,cap_cents:10000,expires_at:'2026-10-26T04:00:00Z'}};
 for(const content of Object.values(renderEmail(p)))for(const value of ['5% OFF','7K4M9Q','Minimum purchase','₱300','₱100','30 days','one use only','Delivery fees are excluded from both','Sign in with the email address','One promo code per order','#unsubscribe='])assert.ok(content.includes(value),value);
 assert.doesNotMatch(renderEmail({...p,welcome_offer:null}).html,/5% OFF|7K4M9Q/);
});
test('all 13 account templates preserve Supabase variables and action semantics',()=>{
 assert.equal(Object.keys(authEmails).length,13);
 for(const [name,c] of Object.entries(authEmails)){const html=renderAuthEmail(name);assert.match(html,/<html lang="en" dir="ltr">/);assert.match(html,/#764b25/);assert.equal((html.match(/<h1 /g)||[]).length,1);if(c.button)assert.match(html,/href="{{ .ConfirmationURL }}"/);if(c.code)assert.match(html,/{{ .Token }}/);assert.doesNotMatch(html,/newsletter|5%|private-token/);}
});
