import test from 'node:test';
import assert from 'node:assert/strict';
import {pesoCents,posEstimate,paymentProofAllowed,posOrderUrl,deliveryProofAllowed,productsDue,paymentDue} from '../assets/ordering/pos.js';
import {buildAnalytics} from '../assets/ordering/analytics.js';
test('POS currency parsing never rounds malformed or negative input into a sale',()=>{
 assert.equal(pesoCents('123.45'),12345);assert.equal(pesoCents('0.1'),10);assert.equal(pesoCents('75'),7500);
 for(const v of ['','-1','NaN','Infinity','1.234','1e3','10,000','10000000000'])assert.throws(()=>pesoCents(v));
 assert.deepEqual(posEstimate([{quantity:2,unit_price_cents:8000}],{kind:'percent',value:10},1000),{subtotal_cents:16000,discount_cents:1600,delivery_cents:1000,total_cents:15400});
});
test('only active DM reservations may accept proof without a deadline',()=>{
 const dm={source:'direct_message',payment_deadline:null,payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation'};
 assert.equal(paymentProofAllowed(dm),true);
 for(const p of [{source:'website'},{source:'popup'},{payment_status:'paid'},{fulfillment_status:'cancelled'},{fulfillment_status:'completed'},{payment_status:'under_review'}])assert.equal(paymentProofAllowed({...dm,...p}),false);
 assert.equal(paymentProofAllowed({...dm,source:'website',payment_deadline:'2026-10-01T00:00:00Z'},Date.parse('2026-09-30T23:59:00Z')),true);
 assert.equal(paymentProofAllowed({...dm,source:'website',payment_deadline:'2026-10-01T00:00:00Z'},Date.parse('2026-10-01T00:00:00Z')),false);
});
test('POS links retain the private token and send customers to their order',()=>{
 assert.equal(posOrderUrl({id:'order',access_token:'a&b'},'https://example.test'),'https://example.test/shop.html#order=order&token=a%26b');
});
test('deferred delivery keeps product payment separate from the current fee and proof',()=>{
 const o={source:'direct_message',deferred_delivery:true,payment_status:'paid',delivery_payment_status:'awaiting_payment',fulfillment_status:'confirmed',total_cents:11550,delivery_cents:1550};
 assert.equal(productsDue(o),10000);assert.equal(paymentDue(o),1550);assert.equal(paymentProofAllowed(o),true);
 for(const extra of [{refund_label:true},{fulfillment_status:'cancelled'},{delivery_payment_status:'pending'},{delivery_payment_status:'paid'},{delivery_payment_status:'under_review'},{source:'website'}])assert.equal(deliveryProofAllowed({...o,...extra}),false);
 assert.equal(paymentDue({...o,payment_status:'awaiting_payment'}),10000);
});
test('analytics counts separately collected delivery once and excludes a quoted unpaid fee',()=>{
 const order={source:'direct_message',deferred_delivery:true,id:'one',method:'delivery',created_at:'2026-09-28T00:00:00Z',fulfillment_date:'2026-09-30',payment_status:'paid',fulfillment_status:'confirmed',delivery_payment_status:'awaiting_payment',total_cents:11550,subtotal_cents:10000,delivery_cents:1550,paid_amount_cents:10000,items:[]};
 let r=buildAnalytics([order]);assert.equal(r.currentOrderValueCents,10000);assert.equal(r.approvedPaymentsCents,10000);assert.equal(r.currentDeliveryCents,0);assert.equal(r.additionalPaymentCents,0);
 r=buildAnalytics([{...order,delivery_payment_status:'paid',delivery_paid_cents:1550,delivery_cash_received_cents:2000,delivery_change_cents:450}]);
 assert.equal(r.currentOrderValueCents,11550);assert.equal(r.approvedPaymentsCents,11550);assert.equal(r.currentDeliveryCents,1550);assert.equal(r.additionalPaymentCents,0);
 assert.equal(r.trend.reduce((sum,b)=>sum+b.approvedPaymentsCents,0),11550);
});
test('analytics separates pop-ups from pickup and counts custom items and paid totals once',()=>{
 const order={source:'popup',id:'one',method:'pickup',created_at:'2026-09-28T00:00:00Z',fulfillment_date:'2026-09-28',payment_status:'paid',fulfillment_status:'completed',total_cents:10000,subtotal_cents:10000,paid_amount_cents:10000,cash_received_cents:15000,change_cents:5000,items:[{name:'Custom cake',quantity:1,unit_price_cents:10000,line_total_cents:10000}]};
 const r=buildAnalytics([order,{...order,id:'two',source:'direct_message',buyer:{}}]);
 assert.equal(r.currentOrderValueCents,20000);assert.equal(r.popupCount,1);assert.equal(r.pickupCount,1);assert.equal(r.topProducts[0].units,2);assert.equal(r.customerCount,0);
});
