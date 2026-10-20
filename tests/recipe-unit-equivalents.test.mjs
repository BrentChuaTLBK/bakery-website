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
