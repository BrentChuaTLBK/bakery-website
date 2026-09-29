import test from 'node:test';import assert from 'node:assert/strict';
import {operatingMetrics as report,operatingMetricsView as view} from '../assets/ordering/operating-metrics.js';
test('outcomes separate sources, proof evidence, cancellations, refunds and edited paid totals',()=>{
 const order={created_at:'2026-09-30T01:00:00Z',source:'website',payment_status:'paid',fulfillment_status:'completed',proof_submitted:true,method:'pickup',promo_snapshot:{code:'THANKS'},discount_cents:100};
 const r=report([order,{...order,fulfillment_status:'cancelled'},{...order,refund_label:true},{...order,payment_status:'awaiting_payment',fulfillment_status:'expired',proof_submitted:false},{...order,source:'direct_message',proof_submitted:false,total_cents:9999},{...order,source:'popup',proof_submitted:false}],[],{start:'2026-09-30',end:'2026-09-30'});
 assert.deepEqual(r.sources.map(s=>[s.total,s.paid,s.proof,s.expired,s.promos]),[[4,1,3,1,1],[1,1,0,0,1],[1,1,0,0,1]]);
 assert.equal(r.sources[2].pickup,0);assert.match(view(r,s=>s),/25.0%/);
 assert.equal(report([order],[],{start:'2026-10-01'}).sources[0].total,0);
});
test('capacity is a current finite-stock snapshot, never a fabricated historic rate',()=>{
 const r=report([],[{date:'2026-09-29',capacity:10,reserved:10},{date:'2026-09-30',capacity:10,reserved:4},{date:'2026-10-01',capacity:null,reserved:9},{date:'2026-10-01',capacity:10,remaining:8},{date:'2026-10-02',capacity:10,reserved:1,available:false}],{today:'2026-09-30'});
 assert.deepEqual(r.capacity,{units:20,reserved:6,dates:2});assert.match(view(report(),s=>s),/No upcoming limited capacity/);
});
