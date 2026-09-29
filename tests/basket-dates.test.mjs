import test from 'node:test';import assert from 'node:assert/strict';
import {basketDateAdvice as advice} from '../assets/ordering/basket-dates.js';
const now=new Date('2026-09-30T01:00:00Z'),settings={cutoff_time:'12:00'},p={id:'ready',name:'Ready',active:true,lead_days:0,allow_same_day:true,price_cents:100,min_quantity:1,option_groups:[]},cake={...p,id:'cake',name:'Cake',lead_days:2,allow_same_day:false};
const line=(p,q=1)=>({product_id:p.id,quantity:q,selections:{}});
test('mixed basket names limiting item, respects production cutoff and closed dates',()=>{
 const result=advice([line(p),line(cake)],[p,cake],[],{...settings,blocked_dates:['2026-10-02']},'2026-09-30','pickup',now);
 assert.equal(result.earliest,'2026-10-03');assert.deepEqual(result.limitingNames,['Cake']);
 assert.equal(advice([line(p)],[p],[],settings,'2026-09-30','pickup',now),null);
 assert.equal(advice([line(cake)],[cake],[],settings,'','pickup',new Date('2026-09-30T04:00:00Z')).earliest,'2026-10-03');
});
test('stock is aggregated across configurations and common dates are checked',()=>{
 const rows=[{product_id:p.id,date:'2026-10-02',capacity:2,remaining:1},{product_id:cake.id,date:'2026-10-03',available:false}];
 assert.equal(advice([line(p),line(p),line(cake)],[p,cake],rows,settings,'2026-09-30','pickup',now).earliest,'2026-10-04');
});
test('does not promise a date for invalid options, missing products, minimums or pickup-only delivery',()=>{
 for(const product of [{...p,min_quantity:2},{...p,pickup_only:true},{...p,active:false},{...p,option_groups:[{id:'g',required_count:1,choices:[]}]}])assert.equal(advice([line(product)],[product],[],settings,'','delivery',now),null);
 assert.equal(advice([line(p)],[],[],settings,'','pickup',now),null);
});
test('reports no common date inside the booking horizon without extending it',()=>{
 assert.equal(advice([line(cake)],[{...cake,lead_days:200}],[],settings,'','pickup',now).earliest,'');
});
