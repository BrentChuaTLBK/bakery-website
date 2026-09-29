import {manilaOrderDate} from './analytics.js?v=pos-1';
const SOURCES=[['website','Website'],['direct_message','Direct orders'],['popup','POS']];
export function operatingMetrics(orders=[],inventory=[],{start='',end='',today=manilaOrderDate(new Date())}={}){
 const sources=SOURCES.map(([id,name])=>({id,name,total:0,paid:0,proof:0,expired:0,promos:0,pickup:0,delivery:0}));
 for(const o of orders){
  const date=manilaOrderDate(o.created_at);if(!date||(start&&date<start)||(end&&date>end))continue;
  const row=sources.find(s=>s.id===(o.source||'website'));if(!row)continue;
  row.total++;if(o.proof_submitted===true)row.proof++;if(o.fulfillment_status==='expired')row.expired++;
  if(o.payment_status!=='paid'||o.refund_label===true||['cancelled','expired'].includes(o.fulfillment_status))continue;
  row.paid++;if(o.promo_snapshot?.code&&Number(o.discount_cents)>0)row.promos++;
  if(row.id!=='popup'&&['pickup','delivery'].includes(o.method))row[o.method]++;
 }
 // Snapshot only: no historical utilization can be inferred from today's holds.
 const capacity={units:0,reserved:0,dates:0};const dates=new Set();
 for(const i of inventory){if(i.date<today||i.available===false||i.capacity==null||!Number.isFinite(Number(i.capacity))||Number(i.capacity)<=0)continue;
  const cap=Number(i.capacity),reserved=Number(i.reserved??(cap-Number(i.remaining)));
  if(!Number.isFinite(reserved)||reserved<0)continue;
  capacity.units+=cap;capacity.reserved+=reserved;dates.add(i.date);
 }
 capacity.dates=dates.size;return {sources,capacity};
}
export function operatingMetricsView(report,esc){
 const ratio=(n,d)=>d?`${n} / ${d} · ${(n/d*100).toFixed(1)}%`:'—';
 const table=`<div class="table-wrap"><table class="data-table"><caption class="sr-only">Order outcomes by sales source</caption><thead><tr><th scope="col">Source</th><th scope="col">Orders</th><th scope="col">Paid conversion</th><th scope="col">Proof submitted</th><th scope="col">Expired holds</th><th scope="col">Promo use</th><th scope="col">Pickup / delivery</th></tr></thead><tbody>${report.sources.map(s=>`<tr><th scope="row">${esc(s.name)}</th><td>${s.total}</td><td>${ratio(s.paid,s.total)}</td><td>${s.id==='popup'?'Not applicable':ratio(s.proof,s.total)}</td><td>${s.id==='website'?ratio(s.expired,s.total):'No automatic expiry'}</td><td>${ratio(s.promos,s.paid)}</td><td>${s.id==='popup'?'In person':`${s.pickup} / ${s.delivery}`}</td></tr>`).join('')}</tbody></table></div>`;
 const c=report.capacity;
 return `<section class="panel operating-metrics"><h2>Order outcomes by source</h2>${table}<p class="help-text">Placement dates follow the selected period. Paid conversion excludes cancelled, expired and Refund-labelled orders; its denominator includes every order. Proof submission counts orders with a saved product-payment proof, including later cancellations. Promo use and fulfillment mix use the same eligible paid orders. Manually received payments do not imply a proof upload.</p><h3>Upcoming capacity reserved</h3><p>${c.units?`${ratio(c.reserved,c.units)} units reserved across ${c.dates} configured fulfillment date${c.dates===1?'':'s'}.`:'No upcoming limited capacity is configured.'}</p><p class="help-text no-margin">Current website inventory from today onward, independent of the placement-date filter. Includes active unpaid holds and retained paid quantities. Unlimited stock, unavailable inventory rows and separate POS event stock are excluded. This is a current snapshot, not historical utilization.</p></section>`;
}
