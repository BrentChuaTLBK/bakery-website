import {brandName} from './brand.js?v=brand-20261001';
// Shared by the owner preview and email worker. Issued terms and editorial text
// are snapshotted in the outbox; campaign edits never rewrite a queued message.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value)/100);
export function renderVoucherEmail(payload) {
 const s=payload?.settings||{},offer=payload?.offer||{},site=new URL(s.site_url);
 const expires=new Date(offer.expires_at);
 if(site.protocol!=='https:'||site.username||site.password||!/^[a-f0-9]{64}$/.test(payload.unsubscribe_token||'')
  || !/^[A-Z0-9_-]{1,50}$/.test(offer.code||'')||!Number.isFinite(expires.getTime())
  ||!['fixed','percent'].includes(offer.kind)||!Number.isInteger(offer.value)||offer.value<=0
  ||(offer.kind==='percent'&&(offer.value>100||!Number.isInteger(offer.cap_cents)||offer.cap_cents<=0))
  ||!Number.isInteger(offer.min_subtotal_cents)||offer.min_subtotal_cents<0)throw Error('Voucher email configuration is incomplete.');
 const discount=offer.kind==='fixed'?money(offer.value):`${offer.value}%`;
 const copy=payload.email_copy||{};
 const fill=value=>String(value).replaceAll('{{discount}}',discount);
 const eyebrow=fill(copy.eyebrow||'A little thank-you from TLB');
 const heading=fill(copy.heading||'{{discount}} off your next order.');
 const message=fill(copy.message||'Your order is complete. Thank you for ordering with TLB Kitchen. Here’s a little treat for your next order.');
 const shop=brandName(s.shop_name);
 const account=new URL('/account.html#account-vouchers',site).href;
 const unsubscribe=new URL('/newsletter.html',site);unsubscribe.hash='unsubscribe='+payload.unsubscribe_token;
 const expiry=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'long',timeStyle:'short'}).format(expires)+' PHT';
 const terms=[['Discount',discount+' off'],['Minimum product spend',offer.min_subtotal_cents?money(offer.min_subtotal_cents):'No minimum'],...(offer.kind==='percent'?[['Maximum discount',money(offer.cap_cents)]]:[]),['Expires',expiry],['Use','One use · one code per order']];
 const identity='Sign in with the email address receiving this message. If you ordered as a guest, create and verify an account with that email to use your voucher.';
 const rules='Applies to products and option surcharges. Delivery fees are excluded from the minimum spend and discount. Cannot be combined with another code.';
 const footer=[s.pickup_address,s.contact_email,s.contact_phone].filter(Boolean).join(' · ');
 const text=`${shop}\n${eyebrow}\n${heading}\n\n${message}\n\nYour code: ${offer.code}\n${terms.map(([k,v])=>`${k}: ${v}`).join('\n')}\n\n${rules}\n${identity}\n\nMy vouchers: ${account}\n\nYou received this offer because you subscribed to TLB marketing emails. Unsubscribe: ${unsubscribe.href}\nYour voucher remains available in your account if you unsubscribe.\n${footer}`;
 const brandFonts=`@font-face{font-family:Chelsea;src:url('${new URL('/assets/fonts/BCawqZsHqfr89WNP_IApC8tzKChiJg8MKVWl.woff2',site).href}')}@font-face{font-family:Lobster;src:url('${new URL('/assets/fonts/neILzCirqoswsqX9zoKmM4MwWJU.woff2',site).href}')} `;
 const html=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title><style>${brandFonts}</style></head><body style="margin:0;background:#faf6ed;color:#35251d;font-family:Chelsea,Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid #e5d5c1;border-radius:14px"><tr><td style="padding:28px"><p style="font-size:12px;letter-spacing:1px;color:#784c28">${esc(shop)}</p><p style="margin-top:28px;font-size:13px;color:#78634f">${esc(eyebrow)}</p><h1 style="font:normal 32px/1.2 Lobster,Georgia,serif;margin:10px 0 20px">${esc(heading)}</h1><p style="font-size:15px;line-height:1.7;overflow-wrap:anywhere">${esc(message).replace(/\n/g,'<br>')}</p><div style="margin:24px 0;padding:20px;border:1px dashed #c6a781;background:#f7efdf;border-radius:10px"><p style="margin:0;font-size:12px">YOUR PERSONAL CODE</p><p style="font-size:24px;line-height:1.4;font-weight:bold;letter-spacing:2px;word-break:break-word">${esc(offer.code)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${terms.map(([k,v])=>`<tr><td style="padding:10px 8px 10px 0;border-top:1px solid #ddcbb7;font-size:12px;vertical-align:top">${esc(k)}</td><td align="right" style="padding:10px 0;border-top:1px solid #ddcbb7;font-size:12px;line-height:1.5;vertical-align:top">${esc(v)}</td></tr>`).join('')}</table></div><p style="font-size:13px;line-height:1.7">${esc(rules)}</p><p style="font-size:13px;line-height:1.7">${esc(identity)}</p><p style="margin:28px 0"><a href="${esc(account)}" style="display:inline-block;background:#784c28;color:white;text-decoration:none;padding:14px 22px;border-radius:8px">View my vouchers</a></p><p style="font-size:12px;line-height:1.7;color:#78634f">You received this offer because you subscribed to TLB marketing emails. <a href="${esc(unsubscribe.href)}" style="color:#784c28">Unsubscribe</a> anytime. Your voucher remains available in your account.</p><p style="font-size:12px;line-height:1.7;color:#78634f">${esc(footer)}</p></td></tr></table></td></tr></table></body></html>`;
 return {html,text};
}
