import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRecipe} from '../assets/ordering/recipe-model.js';
import {addRecipePackaging,packagingItems,scaledPackagingItems,packagingReferenceMarkup} from '../assets/ordering/recipe-packaging.js';
import {preparePrintRecords,printBook} from '../assets/ordering/recipe-print.js';
const box={id:'box',name:'Cake box',data:{dimensions:'10 × 10 × 6 inches'},price:{amount:'300',quantity:'10',unit:'pcs'}};
test('selecting packaging links its identity and unit once without overwriting existing charges',()=>{
 const v=blankRecipe().variants[0];v.additional_costs=[{name:'Saved labor',amount:'15'}];assert.deepEqual(addRecipePackaging(v,box),{index:1,added:true});assert.deepEqual(addRecipePackaging(v,box),{index:1,added:false});assert.equal(v.additional_costs.length,2);assert.equal(v.additional_costs[1].unit,'pc');assert.equal(v.additional_costs[1].quantity,'1');assert.equal(packagingItems(v).length,1);
});
test('packaging quantities scale without mutating the saved document or exposing prices',()=>{
 const v=blankRecipe().variants[0];addRecipePackaging(v,box);v.additional_costs[0].quantity='2';const before=structuredClone(v),scaled=scaledPackagingItems(v,'3');assert.equal(scaled[0].quantity,'6');assert.equal(scaled[0].cost_snapshot,undefined);assert.equal(scaled[0].amount,undefined);assert.deepEqual(v,before);
});
test('kitchen packaging references retain names and quantities while escaping markup',()=>{
 const v={packaging:{items:[{resource_name:'Box <script>',resource_dimensions:'10 × 10',quantity:'2',unit:'pc'}]}};assert.match(packagingReferenceMarkup(v,'2'),/Box &lt;script&gt;/);assert.match(packagingReferenceMarkup(v,'2'),/4 pc/);assert.doesNotMatch(packagingReferenceMarkup(v),/cost_snapshot|amount|supplier/);
});
test('PDF references include linked packaging even without manual descriptions and scale it once',async()=>{
 const d=blankRecipe();d.name='Packaging export';const v=d.variants[0];v.groups=[];v.methods=[];addRecipePackaging(v,box);v.additional_costs[0].quantity='2';const record={id:'qa',version:1,updated_at:'2026-10-01',status:'production',document:d,links:[]};
 const records=await preparePrintRecords([record],{production:{variant_id:v.id,factor:'3'}}),html=printBook(records,{packaging:true});assert.match(html,/Packaging &amp; special equipment|Packaging & special equipment/);assert.match(html,/Cake box/);assert.match(html,/6 pc/);assert.doesNotMatch(html,/300|supplier/);assert.equal(v.additional_costs[0].quantity,'2');
});
