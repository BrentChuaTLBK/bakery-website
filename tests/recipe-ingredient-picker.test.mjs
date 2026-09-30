import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRecipeIngredient,unlinkRecipeIngredient,ingredientLinkText} from '../assets/ordering/recipe-ingredient-picker.js';
const flour={id:'flour-id',name:'Flour',data:{default_unit:'g',brand:'Sample brand'},price:{amount:'120',quantity:'1',unit:'kg',currency:'PHP'}};
test('selecting an ingredient links its identity, default unit, brand and saved price',()=>{
 const row={name:'Fl',quantity:'',unit:'pcs'};selectRecipeIngredient(row,flour);assert.equal(row.ingredient_id,flour.id);assert.equal(row.unit,'g');assert.equal(row.quantity,'');assert.equal(row.brand,'Sample brand');assert.deepEqual(row.cost_snapshot,flour.price);assert.match(ingredientLinkText(row),/Linked.*0\.12.*g/);
});
test('linking an imported quantity converts compatible units without changing the formula',()=>{
 const row={name:'Flour',quantity:'½',unit:'kg'};selectRecipeIngredient(row,flour);assert.equal(row.quantity,'500');assert.equal(row.unit,'g');
});
test('linking never guesses mass from pieces or volume',()=>{
 for(const unit of ['pcs','ml']){const row={name:'Ingredient',quantity:'3',unit};selectRecipeIngredient(row,flour);assert.equal(row.quantity,'3');assert.equal(row.unit,unit);assert.equal(row.ingredient_id,flour.id);}
});
test('changing to an ingredient without pricing clears the old price instead of reusing it',()=>{
 const row={name:'Flour',quantity:'100',unit:'g',ingredient_id:'old',cost_snapshot:flour.price};selectRecipeIngredient(row,{...flour,id:'no-price',price:null});assert.equal(row.cost_snapshot,undefined);assert.match(ingredientLinkText(row),/Price not set/);
});
test('typing a different ingredient clears its old costing link while preserving recipe quantity',()=>{
 const row={name:'Flour',quantity:'100',unit:'g'};selectRecipeIngredient(row,flour);row.name='Cream';unlinkRecipeIngredient(row);assert.equal(row.ingredient_id,undefined);assert.equal(row.cost_snapshot,undefined);assert.equal(row.quantity,'100');assert.equal(row.unit,'g');
});
test('typing a different name also clears a legacy manual price',()=>{
 const row={name:'New ingredient',quantity:'100',unit:'g',cost_snapshot:flour.price,brand:'Old brand'};unlinkRecipeIngredient(row);assert.equal(row.cost_snapshot,undefined);assert.equal(row.brand,'');
});
