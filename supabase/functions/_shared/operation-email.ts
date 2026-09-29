const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderOperationEmail(payload:any){
 const channel=payload.channel==='calendar'?'Google Calendar sync':'Email delivery';
 const recovered=payload.phase==='recovered';
 const title=recovered?`${channel} recovered`:`Action needed: ${channel} is delayed`;
 const message=recovered?'The monitor no longer finds sustained failures or overdue jobs. Email provider acceptance does not confirm inbox delivery.':`${Number(payload.affected)||1} job(s), or the calendar connection, need attention. Open the dashboard to review affected jobs. Check service credentials, provider limits and recent logs before retrying manually.`;
 const url='https://thelittlebakerkitchen.com/manage.html'+(payload.channel==='calendar'?'#calendar':'#overview');
 const text=`The Little Baker Kitchen\n${title}\n\n${message}\n\nObserved: ${payload.observed_at}\nIncident: ${payload.incident_id}\n\nOpen dashboard: ${url}\n\nThis operational alert contains no customer or payment details.`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title></head><body style="margin:0;background:#fefaef;color:#382719;font-family:Arial,sans-serif"><main style="max-width:560px;margin:24px auto;padding:28px;background:#fff;border:1px solid #e4d4c1;border-radius:12px"><p>The Little Baker Kitchen</p><h1 style="font-size:24px">${escape(title)}</h1><p style="line-height:1.6">${escape(message)}</p><p><a href="${url}" style="color:#794b26">Open dashboard</a></p><p style="font-size:12px">Observed: ${escape(payload.observed_at)}<br>Incident: ${escape(payload.incident_id)}</p><p style="font-size:12px">This operational alert contains no customer or payment details.</p></main></body></html>`;
 return {html,text};
}
