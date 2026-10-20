import test from 'node:test';
import assert from 'node:assert/strict';
import {readUnitConversions} from '../assets/ordering/recipe-unit-conversions.js';
import {ingredientCost,exact} from '../assets/ordering/recipe-math.js';
test('explicit ingredient equivalents cost fractions from a kg price without assuming density',()=>{
 const equivalents=readUnitConversions([{from:' tsp ',quantity:'6',unit:'g'},{from:'tbsp',quantity:'18',unit:'g'}]),price={amount:'100',quantity:'1',unit:'kg'};
 assert.equal(exact(ingredientCost({quantity:'1/8',unit:'tsp'},price,equivalents)),'0.075');
 assert.equal(exact(ingredientCost({quantity:'1 1/2',unit:'tsp'},price,equivalents)),'0.9');
 assert.equal(exact(ingredientCost({quantity:'1/2',unit:'tbsp'},price,equivalents)),'0.9');
 assert.throws(()=>ingredientCost({quantity:'1/8',unit:'tsp'},price),/explicit conversion/);
 assert.deepEqual(equivalents,{tsp:{quantity:'6',unit:'g'},tbsp:{quantity:'18',unit:'g'}});
});
test('equivalents accept fractions and saved aliases, reject zero, duplicates and global standard-unit overrides',()=>{
 assert.equal(readUnitConversions([{from:'cup',quantity:'1 1/2',unit:'grams'}]).cup.quantity,'1.5');
 assert.deepEqual(readUnitConversions([]),{});
 for(const row of [{from:'kg',quantity:'1',unit:'g'},{from:'tsp',quantity:'0',unit:'g'},{from:'tsp',quantity:'-1',unit:'g'},{from:'tsp',quantity:'6',unit:'cup'},{from:'',quantity:'1',unit:'g'}])assert.throws(()=>readUnitConversions([row]));
 assert.throws(()=>readUnitConversions([{from:'tsp',quantity:'6',unit:'g'},{from:'TSP',quantity:'5',unit:'g'}]),/one equivalent/);
});
test('one measured piece costs grams, kilograms and all piece aliases in either direction',()=>{
 const equivalents=readUnitConversions([{from:'pcs',quantity:'30',unit:'g'},{from:'tray',quantity:'12',unit:'pc'}]);
 for(const unit of ['pc','pcs','piece','pieces']){
  assert.equal(exact(ingredientCost({quantity:'60',unit:'g'},{amount:'12',quantity:'1',unit},equivalents)),'24');
  assert.equal(exact(ingredientCost({quantity:'2',unit},{amount:'120',quantity:'300',unit:'g'},equivalents)),'24');
 }
 assert.equal(exact(ingredientCost({quantity:'0.06',unit:'kg'},{amount:'12',quantity:'1',unit:'pc'},equivalents)),'24');
 assert.equal(exact(ingredientCost({quantity:'60',unit:'g'},{amount:'144',quantity:'1',unit:'tray'},equivalents)),'24');
 assert.equal(exact(ingredientCost({quantity:'1/2',unit:'pcs'},{amount:'12',quantity:'1',unit:'pc'},equivalents)),'6');
 assert.equal(exact(ingredientCost({quantity:'1',unit:'kg'},{amount:'120',quantity:'300',unit:'g'},equivalents)),'400');
 assert.throws(()=>ingredientCost({quantity:'30',unit:'g'},{amount:'12',quantity:'1',unit:'pc'}),/explicit conversion/);
 assert.throws(()=>readUnitConversions([{from:'pc',quantity:'30',unit:'g'},{from:'pieces',quantity:'35',unit:'g'}]),/one equivalent/);
 assert.throws(()=>readUnitConversions([{from:'pcs',quantity:'2',unit:'pc'}]),/weight or volume/);
 assert.throws(()=>ingredientCost({quantity:'1',unit:'pc'},{amount:'1',quantity:'1',unit:'g'},{pcs:{quantity:'2',unit:'pc'}}),/weight or volume/);
});
