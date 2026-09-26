import {emailLayout,emailColumns,emailPanel,emailButton,paragraph,sectionTitle,escapeHtml as esc,httpsUrl} from './email-layout.ts';

const money=(v:unknown)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v||0)/100);
const date=(v:string,time=false)=>{const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v+'T12:00:00+08:00':v);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',...(time?{timeStyle:'short' as const}:{})}).format(d)+(time?' PHT':''):'See your order page';};
const itemOptions=(item:any)=>(Array.isArray(item.selection_labels)?item.selection_labels:[]).map((c:any)=>typeof c==='string'?c:`${c.group?c.group+': ':''}${c.label||'Option'}${c.quantity?' × '+c.quantity:''}${Number(c.surcharge_cents)?' (+'+money(c.surcharge_cents)+' each)':''}`).join('\n');
const contactHtml=(s:any)=>[s.contact_email?`<a href="mailto:${esc(s.contact_email)}" style="color:#764b25;text-decoration:underline">${esc(s.contact_email)}</a>`:'',s.contact_phone?esc(s.contact_phone):''].filter(Boolean).join(' · ');

// Product images are public bakery assets only, never proof uploads or arbitrary
// remote hosts. Text, quantities and prices remain readable with images blocked.
export function emailProductPhoto(value:unknown,site:string):string {
 const url=httpsUrl(value);if(!url)return '';
 const u=new URL(url),s=new URL(site);
 if(u.search||u.hash)return '';
 if(u.hostname==='aulhqofjjckwwjmdvqgi.supabase.co'&&u.pathname.startsWith('/storage/v1/object/public/product-images/'))return url;
 if(u.origin===s.origin&&u.pathname.startsWith('/assets/img/'))return url;
 return '';
}
function products(order:any,photos:any[],site:string):string {
 const items=Array.isArray(order.items)?order.items:[];
 return sectionTitle('Products ordered')+(items.length?items.map((item:any,i:number)=>{
 const photo=emailProductPhoto(photos[i],site),options=itemOptions(item);
 return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-bottom:1px solid #e4d8c9"><tr>${photo?`<td width="78" valign="top" style="padding:0 12px 16px 0"><img class="email-thumb" src="${esc(photo)}" width="66" height="66" alt="${esc(item.name)}" style="display:block;width:66px;height:66px;object-fit:cover;border-radius:8px;background:#f5eee2;color:#675445;font-size:11px"></td>`:''}<td valign="top" style="padding:0 0 16px;overflow-wrap:anywhere"><p style="font-size:15px;line-height:1.5;margin:0 0 6px"><strong>${esc(item.quantity)} × ${esc(item.name)}</strong></p>${options?`<p style="font-size:12px;color:#675445;line-height:1.6;margin:0 0 8px">${esc(options).replace(/\n/g,'<br>')}</p>`:''}<p style="font-size:12px;color:#675445;margin:0">${esc(money(item.unit_price_cents))} each</p><p style="margin:6px 0 0;font-size:15px;font-weight:bold">${esc(money(item.line_total_cents))}</p></td></tr></table>`;
 }).join(''):paragraph('See the product details on your order page.'));
}
function totals(o:any):string {
 const discount=`Discount${o.promo_code||o.promo_snapshot?.code?' ('+(o.promo_code||o.promo_snapshot.code)+')':''}`;
 const rows=[['Product subtotal',money(o.subtotal_cents)],[discount,(Number(o.discount_cents)>0?'−':'')+money(o.discount_cents)],['Delivery fee',money(o.delivery_cents)]];
 return sectionTitle('Payment breakdown')+`<table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6">${rows.map(([k,v])=>`<tr><th scope="row" align="left" style="padding:5px 10px 5px 0;font-weight:normal;overflow-wrap:anywhere">${esc(k)}</th><td align="right" style="padding:5px 0;white-space:nowrap">${esc(v)}</td></tr>`).join('')}<tr><th scope="row" align="left" style="padding:14px 10px 0 0;border-top:1px solid #ddcdbd">Order total</th><td align="right" style="padding:14px 0 0;border-top:1px solid #ddcdbd;font-size:20px;font-weight:bold;white-space:nowrap">${esc(money(o.total_cents))}</td></tr></table>`;
}
function newsletter(payload:any,text:string):{html:string;text:string} {
 const s=payload.settings,offer=payload.welcome_offer,site=new URL(s.site_url),menu=new URL('/shop.html',site).toString(),unsubscribe=new URL('/newsletter.html',site);unsubscribe.hash='unsubscribe='+payload.unsubscribe_token;
 let body=paragraph('Thanks for subscribing to the TLB newsletter. You’re on the list! Stay tuned for new treats, seasonal menus, and more discount codes exclusively for our newsletter subscribers.');
 if(offer){
  const expiry=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'long',timeStyle:'short'}).format(new Date(offer.expires_at))+' PHT';
  const code=emailPanel(`<p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase">Your welcome code</p><p style="font:bold 32px/1.3 'Courier New',monospace;letter-spacing:4px;margin:12px 0 0;word-break:break-word">${esc(offer.code)}</p>`,'#f4ded2');
  const term=(label:string,value:string)=>`<p style="margin:0 0 15px;font-size:12px;color:#675445">${label}<br><strong style="font-size:16px;color:#302623">${value}</strong></p>`;
  const terms=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="50%" valign="top" style="padding-right:12px">${term('Valid for','30 days from signup')}${term('Maximum discount','₱100')}</td><td width="50%" valign="top">${term('Minimum purchase','₱300')}${term('Per subscriber','one use only')}</td></tr></table>`;
  body+=code+sectionTitle('A few sweet details')+terms+paragraph('Applies to products and option surcharges. Delivery fees are excluded from both the minimum spend and the discount.')+paragraph('Sign in with the email address receiving this message to use your code. One promo code per order.')+`<p style="font-size:13px;margin:0 0 20px"><strong>Expires:</strong> ${esc(expiry)}</p>`;
 }
 body+=emailButton('Explore the menu',menu);
 const html=emailLayout({title:offer?'Your welcome gift: 5% OFF':'Welcome to our kitchen!',preview:offer?'Your personal welcome code is inside. Enjoy 5% OFF your next order.':'Welcome to the TLB newsletter. A little deliciousness, in your inbox.',kicker:'The TLB newsletter',shop:s.shop_name,body,footer:`${paragraph('You’re receiving this email because you subscribed to the TLB newsletter.')}<p style="margin:0 0 14px"><a href="${esc(unsubscribe.toString())}" style="color:#764b25;text-decoration:underline">Unsubscribe from the newsletter</a></p>${paragraph(s.pickup_address||'')}${contactHtml(s)}`});
 return {html:offer?html.replace('Your welcome gift: 5% OFF</h1>','Your welcome gift: <strong style="white-space:nowrap">5% OFF</strong></h1>'):html,text:text.replace('Your welcome gift: 5% off','Your welcome gift: 5% OFF')};
}
export function renderBrandedEmail(payload:any,text:string):{html:string;text:string} {
 if(payload.event_type==='newsletter_welcome')return newsletter(payload,text);
 const o=payload.order,s={...payload.settings},review=payload.event_type==='order_review_required';
 for(const key of ['payment_instructions','pickup_address','pickup_hours','pickup_instructions','delivery_window','contact_email','contact_phone'])if(o[key]!=null)s[key]=o[key];
 const site=new URL(s.site_url);site.search='';site.hash='';site.pathname=site.pathname.replace(/\/$/,'')+'/';
 const url=new URL(review?'manage.html':'shop.html',site);if(!review)url.hash=new URLSearchParams({order:o.id,token:o.access_token}).toString();
 const reason=[...(o.history||[])].reverse().find((e:any)=>e.reason&&!e.private)?.reason||payload.reason||'See your order page for details.';
 const copy:Record<string,[string,string]>={
  order_submitted:['Your order has been received','Your order is awaiting full initial payment and manual approval. Upload your proof of payment before the deadline using the secure order link. A payment reference is optional. Uploading proof places payment under review; it does not confirm payment.'],
  payment_approved:['Your order is confirmed','Our team approved your full initial payment. We look forward to preparing a little deliciousness for you.'],
  payment_rejected:['Payment rejected · order cancelled',`Our team could not approve the initial payment. This order is closed and cannot accept more proof. Reason: ${reason}`],
  order_cancelled:['Your order has been cancelled',`Reason: ${reason}`],
  order_expired:['Your payment-proof deadline has expired','No payment proof was submitted before the deadline. Your unpaid reservations have been released. This order can no longer accept payment proof.'],
  fulfillment_reminder:['Your order is scheduled for today',`Your paid order is scheduled for ${o.method==='delivery'?'delivery':'pickup'} today. This reminder does not change the order’s fulfillment status.`],
  ready_for_pickup:['Your order is ready for pickup','A little deliciousness is ready for you. Our team has marked your order ready for pickup. Please follow the collection details below.'],
  pickup_reminder:['A friendly pickup reminder','Your order is ready and waiting for pickup. Please collect it during our pickup hours, or contact us if you need help arranging collection.'],
  out_for_delivery:['Your order is out for delivery','Our team has marked your order out for delivery. An exact arrival time is not guaranteed. Contact us if you have questions.'],
  order_review_required:['An order is ready for review','A customer submitted payment proof. Sign in with your staff or owner account to review it before approving or rejecting payment.'],
 };
 const [title,message]=copy[payload.event_type]||['Your order has been updated','Open your secure order page to review the current details and history. For an order already paid, payment remains recorded and our team handles any difference directly with you.'];
 let alert='';
 if(payload.event_type==='order_submitted')alert=emailPanel(sectionTitle('Payment instructions')+paragraph(s.payment_instructions||'Open your order page for payment instructions.')+`<p style="margin:0"><strong>Payment-proof deadline</strong><br>${esc(date(o.payment_deadline,true))}</p>`,'#f4ded2');
 if(['payment_rejected','order_expired'].includes(payload.event_type))alert=emailPanel(paragraph('You may place a new order, subject to current prices and availability. If you already transferred funds, contact us about that payment before making any further payment.'),'#f4ded2');
 if(payload.event_type==='order_cancelled')alert=emailPanel(paragraph('Cancellation does not confirm a refund. Our team handles any refund directly with you; contact us with questions about an existing payment.'),'#f4ded2');
 const pickup=o.method!=='delivery';
 let fulfillment=sectionTitle(pickup?'Pickup details':'Delivery details')+`<p style="margin:0 0 14px;font-weight:bold">${esc(date(o.fulfillment_date))}</p>`;
 if(review)fulfillment+=paragraph(`Customer: ${o.buyer_name||'See the order in the dashboard'}`);
 else if(pickup)fulfillment+=paragraph(s.pickup_address||'See your order page for the pickup address.')+(s.pickup_hours?paragraph('Opening hours: '+s.pickup_hours):'')+(s.pickup_instructions?paragraph(s.pickup_instructions):'');
 else fulfillment+=paragraph([o.recipient?.name,o.recipient?.phone,o.address?.line1,o.address?.line2,o.address?.locality,o.address?.postal_code].filter(Boolean).join('\n'))+paragraph('Delivery window: '+(s.delivery_window||'See your order page')+'. Arrival can be anytime within this window; no exact time is guaranteed.')+(o.delivery_zone_name?paragraph('Delivery zone: '+o.delivery_zone_name):'')+(o.delivery_zone_description?paragraph(o.delivery_zone_description):'');
 const button=emailButton(review?'Open orders for review':'View your order',url.toString());
 const body=paragraph(message)+`<p style="margin:0 0 6px;color:#764b25;font-size:14px">Order <strong style="letter-spacing:1px">${esc(o.reference)}</strong></p>`+button+`<div style="height:24px;line-height:24px">&nbsp;</div>`+alert+emailColumns(products(o,payload.product_photos||[],site.toString())+emailPanel(totals(o)),emailPanel(fulfillment,'#e8ede2'),55);
 const footer=review?paragraph('You received this notification because your account is assigned a Staff or Owner role. The dashboard shows the current order status.'):paragraph('Keep your order link private; it grants access to this order.')+paragraph('For changes, cancellations, or payment concerns, contact us using the details below or on your order page.')+contactHtml(s);
 return {html:emailLayout({title,preview:`${o.reference} · ${title}`,kicker:review?'For the kitchen team':'Your TLB order',shop:s.shop_name,body,footer}),text};
}
