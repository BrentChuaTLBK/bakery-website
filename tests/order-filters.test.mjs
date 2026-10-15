import test from 'node:test';
import assert from 'node:assert/strict';
import {isOverdueOrder,matchesUpcomingOrder,matchesOrderView} from '../assets/ordering/order-dashboard.js';

const today='2026-10-15';
const order=overrides=>({source:'website',payment_status:'paid',fulfillment_status:'confirmed',fulfillment_date:'2026-10-14',refund_label:false,...overrides});

test('Upcoming retains overdue paid fulfillment for website and direct orders at every active stage',()=>{
 for(const source of ['website','direct_message'])for(const fulfillment_status of ['confirmed','preparing','ready_for_pickup','out_for_delivery']){
  const value=order({source,fulfillment_status});
  assert.equal(matchesUpcomingOrder(value,today),true);
  assert.equal(isOverdueOrder(value,today),true);
  assert.equal(matchesOrderView(value,'today',today),false);
 }
});

test('Upcoming preserves today and future active orders but does not absorb overdue unpaid work',()=>{
 for(const payment_status of ['paid','awaiting_payment','under_review','rejected'])for(const fulfillment_date of [today,'2026-10-16']){
  const value=order({payment_status,fulfillment_date});
  assert.equal(matchesUpcomingOrder(value,today),true);
  assert.equal(isOverdueOrder(value,today),false);
 }
 for(const payment_status of ['awaiting_payment','under_review','rejected'])assert.equal(matchesUpcomingOrder(order({payment_status}),today),false);
});

test('Closed and refunded orders stay outside Upcoming and Awaiting payment at every date',()=>{
 for(const fulfillment_date of ['2026-10-14',today,'2026-10-16'])for(const state of [{fulfillment_status:'completed'},{fulfillment_status:'cancelled'},{fulfillment_status:'expired'},{fulfillment_status:'refunded'},{refund_label:true}]){
  const paid=order({...state,fulfillment_date});
  assert.equal(matchesUpcomingOrder(paid,today),false);
  assert.equal(isOverdueOrder(paid,today),false);
  assert.equal(matchesOrderView({...paid,payment_status:'awaiting_payment'},'awaiting',today),false);
 }
});

test('Awaiting payment includes active unpaid orders regardless of date and stops matching once payment changes',()=>{
 for(const source of ['website','direct_message'])for(const fulfillment_date of ['2026-01-01',today,'2026-12-31']){
  const unpaid=order({source,fulfillment_date,payment_status:'awaiting_payment',fulfillment_status:'pending_confirmation'});
  assert.equal(matchesOrderView(unpaid,'awaiting',today),true);
  for(const payment_status of ['under_review','paid','rejected','cancelled'])assert.equal(matchesOrderView({...unpaid,payment_status},'awaiting',today),false);
 }
 assert.equal(matchesOrderView(order({deferred_delivery:true,delivery_payment_status:'awaiting_payment'}),'awaiting',today),false);
});

test('A paid order survives the date rollover, disappears on completion, and returns after reopening',()=>{
 const value=order({fulfillment_date:'2026-12-31'}),before=structuredClone(value);
 assert.equal(matchesUpcomingOrder(value,'2026-12-31'),true);
 assert.equal(isOverdueOrder(value,'2026-12-31'),false);
 assert.equal(matchesUpcomingOrder(value,'2027-01-01'),true);
 assert.equal(isOverdueOrder(value,'2027-01-01'),true);
 assert.equal(matchesUpcomingOrder({...value,fulfillment_status:'completed'},'2027-01-01'),false);
 assert.equal(matchesUpcomingOrder({...value,fulfillment_status:'confirmed'},'2027-01-01'),true);
 assert.deepEqual(value,before,'Filtering must not change payment, progress or dates');
});
