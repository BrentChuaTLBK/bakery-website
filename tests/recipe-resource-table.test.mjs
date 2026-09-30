import test from 'node:test';
import assert from 'node:assert/strict';
import {exact} from '../assets/ordering/recipe-math.js';
import {resourceUnitCost,resourceMoney,sortResourceRows,resourceTableMarkup} from '../assets/ordering/recipe-resource-table.js';
const resource=(id,amount,quantity,unit,currency='PHP')=>({id,name:id,active:true,data:{},price:{amount,quantity,unit,currency}});

test('ingredient comparisons show cost per gram and millilitre without changing purchase prices',()=>{
 const flour=resource('Flour','500','2','kg'),original=structuredClone(flour),mass=resourceUnitCost(flour);
 assert.equal(mass.basis,'g');assert.equal(exact(mass.amount),'0.25');assert.deepEqual(flour,original);
 const oil=resourceUnitCost(resource('Oil','380','2','L'));assert.equal(oil.basis,'ml');assert.equal(exact(oil.amount),'0.19');
});
test('packaging compares per piece, sheet or pack without inventing pack contents',()=>{
 for(const [unit,basis]of [['pcs','pc'],['pieces','pc'],['sheet','sheet'],['box','box'],['pack','pack']]){
  const cost=resourceUnitCost(resource('Packaging','155','25',unit));assert.equal(cost.basis,basis);assert.equal(exact(cost.amount),'6.2');
 }
});
test('missing or invalid quotes remain unpriced while an actual zero price remains valid',()=>{
 for(const price of [null,{amount:10,quantity:0,unit:'g'},{amount:-1,quantity:2,unit:'g'},{amount:10,quantity:2,unit:''}])assert.equal(resourceUnitCost({price}),null);
 const free=resourceUnitCost(resource('Free','0','100','g'));assert.equal(exact(free.amount),'0');
 assert.match(resourceTableMarkup([{id:'missing',name:'Unpriced',data:{}}]),/Price not set/);
});
test('unit-cost sorting compares compatible dimensions and currencies and never mutates the records',()=>{
 const rows=[resource('Expensive flour','200','1','kg'),resource('Cheap flour','50','500','g'),resource('Different currency','1','1','kg','USD'),resource('Box','1','1','box'),{id:'missing',name:'Unpriced',data:{}}];
 const original=structuredClone(rows),sorted=sortResourceRows(rows,'cost');
 assert.ok(sorted.findIndex(r=>r.id==='Cheap flour')<sorted.findIndex(r=>r.id==='Expensive flour'));
 assert.ok(sorted.findIndex(r=>r.id==='Different currency')>sorted.findIndex(r=>r.id==='Expensive flour'));
 assert.equal(sorted.at(-1).id,'missing');assert.deepEqual(rows,original);
});
test('small unit costs keep useful precision and never silently display a positive cost as zero',()=>{
 assert.equal(resourceMoney('0.062','PHP',4),'₱0.062');assert.equal(resourceMoney('0.000001','PHP',4),'< ₱0.0001');
 assert.equal(resourceMoney('0','PHP',4),'₱0.00');
});
test('untrusted ingredient names, brands and packaging units are escaped in table cells',()=>{
 const row=resource('safe','10','1','<img src=x onerror=alert(1)>');row.name='<script>alert(1)</script>';row.data.brand='" onmouseover="alert(1)';
 const html=resourceTableMarkup([row]);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img '));assert.match(html,/&lt;script&gt;/);
});
