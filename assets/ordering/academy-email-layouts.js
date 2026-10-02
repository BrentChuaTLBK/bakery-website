// Shared by browser previews and the sending worker. Only escaped text and
// validated HTTPS links enter these email-client-friendly layouts.
export const academyEmailLayouts = [
 {id:'invitation',name:'Class invitation',description:'A warm introduction, a large photo and class highlights.'},
 {id:'launch',name:'Photo feature',description:'Put your main photograph first and follow with the details.'},
 {id:'showcase',name:'Academy edit',description:'A headline, an introduction and a collection of highlights.'},
 {id:'journal',name:'Kitchen letter',description:'A personal note with photographs and room for a story.'},
];
export function academyEmailUrl(value){
 try{const raw=String(value||'');if(/[\s<>\\]/.test(raw))return '';const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lines=v=>esc(v).replace(/\r?\n/g,'<br>');
export function renderAcademyLayout(p,{url,unsub,token}){
 const c=p.email_content||{},layout=academyEmailLayouts.find(t=>t.id===c.layout)?.id||'invitation';
 const items=(Array.isArray(c.items)?c.items:[]).slice(0,4),cta=academyEmailUrl(c.cta_url)||url,label=c.cta_label||'Open Academy';
 const photo=(src,alt,height=330)=>academyEmailUrl(src)?`<img src="${esc(academyEmailUrl(src))}" alt="${esc(alt)}" width="576" style="display:block;width:100%;max-width:100%;height:${height}px;object-fit:cover;border:0;border-radius:6px">`:'';
 const title=`<p style="font:11px/1.5 Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#764b25;margin:0 0 14px">${esc(c.eyebrow||'TLB Academy')}</p><h1 style="font:normal 36px/1.15 Georgia,serif;color:#30251f;margin:0 0 20px;overflow-wrap:anywhere">${esc(c.headline||p.title)}</h1>`;
 const intro=c.intro?`<p style="font:16px/1.75 Arial,sans-serif;color:#594a40;margin:0 0 24px">${lines(c.intro)}</p>`:'';
 const hero=photo(c.hero_url,c.hero_alt),story=`<p style="font:16px/1.8 ${layout==='journal'?'Georgia,serif':'Arial,sans-serif'};color:#594a40;margin:24px 0;overflow-wrap:anywhere">${lines(p.preview)}</p>`;
 const highlights=items.length?`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;margin:28px 0 0">${Array.from({length:Math.ceil(items.length/2)},(_,i)=>`<tr>${items.slice(i*2,i*2+2).map(item=>`<td class="academy-email-card" width="50%" valign="top" style="padding:0 8px 26px;overflow-wrap:anywhere">${photo(item.image_url,item.alt,190)}<h2 style="font:normal 23px/1.3 Georgia,serif;color:#30251f;margin:16px 0 8px">${esc(item.title)}</h2><p style="font:14px/1.7 Arial,sans-serif;color:#594a40;margin:0">${lines(item.description)}</p></td>`).join('')}</tr>`).join('')}</table>`:'';
 const layouts={
  invitation:`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8ecdf;border-radius:8px;margin-bottom:24px"><tr><td style="padding:28px 24px">${title}${intro}</td></tr></table>${hero}${story}${highlights}`,
  launch:`${hero?`<div style="margin-bottom:28px">${hero}</div>`:''}${title}${intro}${story}${highlights}`,
  showcase:`${title}${intro}${hero}${story}${highlights}`,
  journal:`${title}${intro}${hero}${story}${highlights}<p style="font:italic 20px/1.5 Georgia,serif;color:#764b25">See you in the kitchen,<br>TLB Academy</p>`,
 };
 const footer=token?`<p style="font:12px/1.7 Arial,sans-serif;margin:0 0 12px">You’re receiving this email because you subscribed to the Academy newsletter.<br>${esc(p.address)}</p><a href="${esc(unsub)}" style="font:13px Arial,sans-serif;color:#764b25">Unsubscribe from Academy marketing</a>`:'<p style="font:12px/1.7 Arial,sans-serif;margin:0">This is an Academy account or class notification.</p>';
 const html=`<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><style>@media(max-width:480px){.academy-email-pad{padding:26px 18px!important}.academy-email-card{display:block!important;width:auto!important;padding:0 0 24px!important}h1{font-size:30px!important}}</style></head><body style="margin:0;background:#f2eadf;color:#30251f"><div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div><table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fffaf0;border-top:4px solid #764b25"><tr><td style="padding:25px 32px;border-bottom:1px solid #e6d8c6"><p style="font:normal 25px Georgia,serif;margin:0">TLB Academy</p><p style="font:10px Arial,sans-serif;letter-spacing:2px;color:#764b25;margin:8px 0 0">BY TLB KITCHEN</p></td></tr><tr><td class="academy-email-pad" style="padding:34px 32px">${layouts[layout]}<p style="text-align:center;margin:28px 0 0"><a href="${esc(cta)}" style="display:inline-block;background:#764b25;color:#fff;font:bold 15px Arial,sans-serif;text-decoration:none;border-radius:6px;padding:16px 25px;overflow-wrap:anywhere">${esc(label)} →</a></p></td></tr><tr><td align="center" style="background:#e8ecdf;padding:26px 24px"><p style="font:14px/1.7 Arial,sans-serif;margin:0 0 10px">TLB Academy by TLB Kitchen</p>${footer}</td></tr></table></td></tr></table></body></html>`;
 const imageText=(src,alt)=>academyEmailUrl(src)?`${alt||'Photo'}: ${academyEmailUrl(src)}`:'';
 const text=['TLB Academy by TLB Kitchen',c.preheader,c.headline||p.title,c.intro,imageText(c.hero_url,c.hero_alt),p.preview,...items.map(i=>[i.title,i.description,imageText(i.image_url,i.alt)].filter(Boolean).join('\n')),`${label}: ${cta}`,token?`${p.address}\nUnsubscribe from Academy marketing: ${unsub}`:'This is an Academy account or class notification.'].filter(Boolean).join('\n\n');
 return {html,text};
}
