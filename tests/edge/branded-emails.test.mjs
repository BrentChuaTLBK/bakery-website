import test from 'node:test';import assert from 'node:assert/strict';
import {renderEmail} from '../../supabase/functions/_shared/emails.ts';
import {emailProductPhoto} from '../../supabase/functions/_shared/emails-branded.ts';
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
