import test from 'node:test';
import assert from 'node:assert/strict';
import {quantity,exact,multiply,formatQuantity,displayQuantity,scaleIngredients,ingredientTotals,ingredientCost,convert} from '../assets/ordering/recipe-math.js';
import {blankRecipe,scaledCopy,validateRecipe,csvIngredients,csvTotals,productionPlan} from '../assets/ordering/recipe-model.js';
import {configureRecipeUnits,unitOptions} from '../assets/ordering/recipe-units.js';
import {preparePrintRecords,printBook} from '../assets/ordering/recipe-print.js';

const row=(name,amount,unit='tsp')=>({id:crypto.randomUUID(),name,quantity:amount,unit});
const fixture=(rows=[row('Vanilla','1/8')])=>{
 const document=blankRecipe();document.name='Sample teaspoon recipe';
 document.variants[0].groups[0].ingredients=rows;
 document.variants[0].methods[0].steps[0].instruction='Mix the sample ingredients.';
 return {id:'sample',code:'SAMPLE',version:1,version_id:'sample-v1',status:'draft',updated_at:'2026-10-19T00:00:00Z',document,links:[]};
};

test('teaspoon multiplication presents the requested reduced fractions and mixed numbers',()=>{
 for(const [amount,factor,expected] of [['1/8','2','1/4'],['1/2','3','1 1/2'],['1 1/2','2','3'],['⅛','2','1/4'],['½','3','1 1/2']]){
  const source=[{ingredients:[row('Sample',amount)]}],before=structuredClone(source);
  const scaled=scaleIngredients(source,factor)[0].ingredients[0];
  assert.equal(scaled.scaled_display,expected);
  assert.equal(exact(scaled.scaled_quantity),exact(multiply(quantity(amount),quantity(factor))));
  assert.deepEqual(source,before);
 }
});

test('teaspoon formatting handles decimals, improper fractions, zero, and normalized unit labels exactly',()=>{
 for(const [amount,expected] of [['0','0'],['0/8','0'],['2/8','1/4'],['12/8','1 1/2'],['16/8','2'],['1½','1 1/2'],['0.125','1/8'],['1.5','1 1/2'],['0.1','1/10'],['1/3','1/3']]){
  for(const unit of ['tsp','TSP',' tsp '])assert.equal(formatQuantity(amount,unit),expected);
 }
 assert.equal(formatQuantity({n:'6',d:'4'},'tsp'),'1 1/2');
 for(const value of ['-1','1/0','NaN',''])assert.throws(()=>formatQuantity(value,'tsp'));
});

test('teaspoon presentation leaves decimal display, costing, and explicit conversion rules unchanged',()=>{
 assert.equal(exact(quantity('1 1/2')),'1.5');
 for(const unit of ['', 'g','kg','ml','pcs','tbsp'])assert.equal(formatQuantity('1/8',unit),'0.125');
 assert.equal(exact(ingredientCost(row('Vanilla','1/8'),{amount:'80',quantity:'10',unit:'tsp'})),'1');
 assert.throws(()=>convert('1','tsp','ml'),/explicit conversion/);
 assert.throws(()=>convert('1','tsp','g'),/explicit conversion/);
});

test('display rounding retains exact teaspoon quantities and marks only actual rounding',()=>{
 const exactDisplay=displayQuantity('1/4',{unit:'tsp'});
 assert.equal(exactDisplay.text,'1/4');assert.equal(exactDisplay.rounded,false);
 const rounded=displayQuantity('5/16',{unit:'tsp',mode:'practical',step:'1/8'});
 assert.equal(rounded.text,'3/8');assert.equal(rounded.rounded,true);
 assert.equal(exact(rounded.exact),'0.3125');
 assert.equal(displayQuantity('1/4',{unit:'g'}).text,'0.25');
});

test('teaspoon is available once even when an existing custom teaspoon was configured',()=>{
 try{
  configureRecipeUnits([{name:'Teaspoon',symbol:'tsp'},{name:'Legacy teaspoon',symbol:'TSP'},{name:'Bag',symbol:'bag'}]);
  const options=unitOptions();
  assert.equal(options.filter(([value])=>value.trim().toLowerCase()==='tsp').length,1);
  assert(options.some(([value])=>value==='tsp'));assert(options.some(([value])=>value==='bag'));
 }finally{configureRecipeUnits();}
});

test('scaled recipe copies retain readable teaspoons and validate without altering the saved formula',()=>{
 const record=fixture([row('Vanilla','1/2'),row('Flour','0.5','g')]),before=structuredClone(record.document);
 const copy=scaledCopy(record.document,record.document.variants[0].id,'3');
 assert.equal(copy.variants[0].groups[0].ingredients[0].quantity,'1 1/2');
 assert.equal(copy.variants[0].groups[0].ingredients[1].quantity,'1.5');
 assert.deepEqual(validateRecipe(copy),[]);assert.deepEqual(record.document,before);
 assert.notEqual(copy.variants[0].groups[0].ingredients[0].id,before.variants[0].groups[0].ingredients[0].id);
});

test('ingredient totals and CSV exports combine teaspoon fractions while keeping different dimensions separate',()=>{
 const record=fixture([row('Vanilla','1/8'),row('Vanilla','1/8'),row('Vanilla','1','ml')]);
 const variant=record.document.variants[0],totals=ingredientTotals(variant.groups,'3');
 assert.equal(totals.length,2);
 assert.equal(totals.find(item=>item.unit==='tsp').display,'3/4');
 assert.equal(totals.find(item=>item.unit==='ml').display,'3');
 assert.match(csvIngredients(record.document,variant.id,'3'),/"Vanilla","","3\/4","tsp"/);
});

test('linked production totals combine teaspoons exactly across parent and component recipes',async()=>{
 const parent=fixture([row('Vanilla','1/8')]),child=fixture([row('Vanilla','1/8')]);
 child.id='child';child.version_id='child-v1';child.document.name='Sample component';
 const size=parent.document.variants[0],childSize=child.document.variants[0];
 childSize.yield.quantity='2';
 size.components=[{id:'component',version_id:child.version_id,variant_id:childSize.id,quantity:'1',unit:'batch'}];
 const before=structuredClone([parent,child]);
 const plan=await productionPlan(parent,size.id,'2',{loadRecipe:async()=>child});
 assert.equal(plan.totals[0].display,'3/8');
 assert.match(csvTotals(plan.totals),/"Vanilla","","3\/8","tsp"/);
 assert.deepEqual([parent,child],before);
});

test('prepared kitchen and presentation exports print scaled mixed fractions',async()=>{
 const record=fixture([row('Vanilla','1/2')]),before=structuredClone(record);
 const prepared=await preparePrintRecords([record],{production:{variant_id:record.document.variants[0].id,factor:'3'}});
 assert.equal(prepared[0].document.variants[0].groups[0].ingredients[0].quantity,'1 1/2');
 for(const layout of ['kitchen','presentation'])assert.match(printBook(prepared,{layout,packaging:false,process:false}),/<td>1 1\/2 tsp<\/td>/);
 assert.deepEqual(record,before);
});
