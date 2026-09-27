// The editor suggests copy from existing promos; the server rechecks the code before queueing.
export function newsletterPromos(promos=[],now=Date.now()){
 return promos.filter(p=>p.active===true&&!p.deleted_at&&p.source!=='newsletter_welcome'&&p.code&&(!p.expires_at||Date.parse(p.expires_at)>now));
}
export function newsletterPromoOffer(p){
 const money=c=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(c)/100);
 const terms=[];
 if(p.min_subtotal_cents>0)terms.push(`${money(p.min_subtotal_cents)} minimum product purchase.`);
 if(p.kind==='percent'&&p.cap_cents>0)terms.push(`Up to ${money(p.cap_cents)} discount.`);
 if(p.expires_at&&Number.isFinite(Date.parse(p.expires_at)))terms.push(`Valid until ${new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(p.expires_at))} PHT.`);
 if(p.per_account_limit>0)terms.push(`Up to ${p.per_account_limit} ${p.per_account_limit===1?'use':'uses'} per verified account.`);
 terms.push('Delivery excluded. Subject to remaining redemptions.');
 return {offer_code:p.code,offer_heading:`${p.kind==='percent'?`${p.value}%`:money(p.value)} OFF`,offer_terms:terms.join('\n')};
}
