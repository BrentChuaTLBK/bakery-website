import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {renderEmail} from '../supabase/functions/_shared/emails.ts';
import {authEmails,renderAuthEmail} from '../supabase/functions/_shared/auth-emails.ts';
import {emailLayout,emailButton,emailPanel,paragraph,sectionTitle} from '../supabase/functions/_shared/email-layout.ts';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.EMAIL_PREVIEW_DIR||join(root,'test-results/emails'));
await mkdir(out,{recursive:true});await mkdir(join(root,'supabase/templates'),{recursive:true});
const files=[];
const settings={site_url:'https://thelittlebakerkitchen.com',shop_name:'The Little Baker Kitchen',pickup_address:'39 Acacia Drive, Bellevue Subdivision, Brgy. Apolonio Samson, Quezon City',pickup_hours:'10am – 8pm',pickup_instructions:'Pickup time: 10am onwards\n\nFor courier bookings, use The Little Baker Kitchen as the pickup pin.\n\nInclude the customer’s full name and order ID in the driver’s notes. The driver must provide the name when collecting the order.\n\nPlease check your order before leaving and handle it with care in transit.',payment_instructions:'Please follow the payment details on your secure order page, then upload your proof of payment.',contact_email:'tlbk.kitchen@gmail.com',contact_phone:'09608035795',delivery_window:'10am – 6pm'};
const photos=['https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/af2bd16c-b8bf-4fa0-afbf-18e2d038a4c5/a56026cb-4817-4894-b34a-3304bc79da51.webp','https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/af2bd16c-b8bf-4fa0-afbf-18e2d038a4c5/288b9015-10dd-4390-ab1d-2245c6b1722d.webp'];
const order={id:'preview-only',reference:'TLB-A7K9P2',access_token:'preview-not-a-real-order-token',buyer_name:'Sample customer',fulfillment_date:'2026-09-28',payment_deadline:'2026-09-27T04:00:00Z',method:'pickup',items:[{name:'Strawberry Shortcake (8”)',quantity:1,unit_price_cents:150000,line_total_cents:150000,selection_labels:[]},{name:'Nori Duo Pack',quantity:2,unit_price_cents:30000,line_total_cents:60000,selection_labels:['Original × 1','Barbeque × 1']}],subtotal_cents:210000,discount_cents:10000,delivery_cents:0,total_cents:200000,promo_snapshot:{code:'7K4M9Q'}};
async function save(name,html){await writeFile(join(out,name+'.html'),html);files.push(name);}
for(const event of ['order_submitted','payment_approved','payment_rejected','order_cancelled','order_expired','order_updated','fulfillment_reminder','ready_for_pickup','pickup_reminder','out_for_delivery','order_review_required']){
 const delivery=event==='out_for_delivery';
 const payload={email_design_version:2,event_type:event,order:{...order,...(delivery?{method:'delivery',recipient:{name:'Sample customer',phone:'Sample phone'},address:{line1:'Sample delivery address',locality:'Quezon City'},delivery_cents:15000,total_cents:201500+13500}:{}),reason:'Requested by the customer'},settings,product_photos:photos};
 const rendered=renderEmail(payload);await save(event,rendered.html);await writeFile(join(out,event+'.txt'),rendered.text);
}
// Courier homepages demonstrate the optional button without inventing a parcel.
for(const [name,event,tracking] of [['out_for_delivery_tracking','out_for_delivery','https://www.lalamove.com/en-ph/'],['delivery_tracking_updated','delivery_tracking_updated','https://www.grab.com/ph/'],['delivery_tracking_unavailable','delivery_tracking_updated',null]]){
 const rendered=renderEmail({email_design_version:2,event_type:event,order:{...order,method:'delivery',delivery_tracking_url:tracking,recipient:{name:'Sample customer'},address:{line1:'Sample delivery address',locality:'Quezon City'},delivery_cents:15000,total_cents:215000},settings,product_photos:photos});
 const notice=emailPanel(paragraph('Design preview only. The courier button opens an official homepage; this is not a real delivery tracking link.'),'#f4ded2');
 await save(name,rendered.html.replace('</h1>','</h1>'+notice));await writeFile(join(out,name+'.txt'),'Design preview only. No actual parcel.\n\n'+rendered.text);
}
for(const welcome_offer of [null,{code:'7K4M9Q',value:5,min_subtotal_cents:30000,cap_cents:10000,expires_at:'2026-10-26T04:00:00Z'}]){
 const payload={email_design_version:2,event_type:'newsletter_welcome',unsubscribe_token:'a'.repeat(64),settings,welcome_offer};const rendered=renderEmail(payload);await save(welcome_offer?'newsletter_offer':'newsletter_welcome',rendered.html);
}
const patch={};
for(const name of Object.keys(authEmails)){
 const html=renderAuthEmail(name);await writeFile(join(root,'supabase/templates',name+'.html'),html);patch['mailer_templates_'+name+'_content']=html;
 await save('account_'+name,html.replaceAll('{{ .ConfirmationURL }}','https://thelittlebakerkitchen.com/account.html').replaceAll('{{ .Token }}','123456').replaceAll(/{{\s*\.(?:NewEmail|OldEmail|Email)\s*}}/g,'sample@example.test').replaceAll(/{{.*?}}/g,'Sample'));
}
await writeFile(join(out,'supabase-auth-templates.json'),JSON.stringify(patch,null,2));
const campaign=emailLayout({title:'A little deliciousness, just for you',preview:'News and treats from The Little Baker Kitchen.',kicker:'The TLB newsletter',body:paragraph('Write your newsletter introduction here.')+emailPanel(sectionTitle('Your latest from the kitchen')+paragraph('Add your verified offer, class news, or seasonal menu here.'))+emailButton('Explore the menu','https://thelittlebakerkitchen.com/shop.html'),footer:paragraph(settings.pickup_address)+'<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#764b25;text-decoration:underline">Unsubscribe from the newsletter</a>'});
await writeFile(join(root,'supabase/templates/newsletter-campaign.html'),campaign);await save('newsletter_campaign',campaign);
await writeFile(join(out,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TLB email previews</title><style>body{margin:0;background:#fefaef;color:#302623;font:15px/1.6 Arial}header{padding:22px 28px;background:#302623;color:#fefaef}h1{font:32px Georgia;margin:0}main{display:grid;grid-template-columns:250px 1fr}nav{padding:22px}a{display:block;color:#764b25;padding:8px;text-decoration:none;border-bottom:1px solid #ddcdbd}a:focus,a:hover{background:#f4ded2}iframe{width:100%;height:calc(100vh - 110px);border:0}@media(max-width:700px){main{display:block}nav{max-height:190px;overflow:auto}iframe{height:100vh}}</style><header><h1>Emails from our kitchen</h1><span>Design preview · sample orders and prices · nothing is sent</span></header><main><nav>${files.map(f=>`<a href="${f}.html" target="email-preview">${f.replaceAll('_',' ')}</a>`).join('')}</nav><iframe name="email-preview" title="Selected email design" src="ready_for_pickup.html"></iframe></main></html>`);
console.log(`Generated ${files.length} email previews and 13 Supabase account templates in ${out}`);
