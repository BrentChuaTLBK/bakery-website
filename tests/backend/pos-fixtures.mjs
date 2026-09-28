import {randomUUID} from 'node:crypto';
// Existing POS scenarios explicitly open their fixture drawer before cash sales.
// Register-specific tests exercise missing, stale, closed and shared sessions directly.
export async function withCashSession(h,p){
 if(p.source!=='popup'||p.payment?.method!=='cash')return p;
 let session=(await h.api('pos_bootstrap',{},h.ids.owner)).cash_sessions.find(s=>s.event_id===p.event_id&&!s.closed_at);
 if(!session)session=await h.api('pos_cash_open',{event_id:p.event_id,opening_cents:100000,idempotency_key:randomUUID()},h.ids.owner);
 return {...p,payment:{...p.payment,cash_session_id:session.id}};
}
