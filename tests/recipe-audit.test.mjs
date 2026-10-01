import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRecipe,validateRecipe,yieldReview,scaledCopy} from '../assets/ordering/recipe-model.js';
import {quantity,inputQuantity,exact,scaleFactor,scaleIngredients,displayQuantity,convert} from '../assets/ordering/recipe-math.js';
function recipe(){const d=blankRecipe();d.name='Audit recipe';const v=d.variants[0];v.groups[0].ingredients[0]={id:'butter',name:'Butter',quantity:'94',unit:'g'};v.methods[0].steps[0].instruction='Mix.';return d;}
test('six pieces scales to eighteen without a duplicated portions entry',()=>{
 assert.equal(exact(scaleFactor({quantity:'6',unit:'pcs'},'pieces','18')),'3');
 assert.equal(exact(scaleFactor({quantity:'2',unit:'cake',portions:'16'},'portions','24')),'1.5');
 assert.equal(exact(scaleFactor({quantity:'6',unit:'pcs',portions:'12'},'pieces','18')),'3');
});
test('editor and server quantity limits agree before a save is attempted',()=>{
 for(const key of ['quantity','portions','portion_weight','batch_weight','finished_weight','pans','loss_percent']){const d=recipe();d.variants[0].yield[key]='-1';assert.ok(validateRecipe(d).length,key);}
 const d=recipe();d.variants[0].yield.loss_percent='101';assert.ok(validateRecipe(d).some(s=>s.includes('loss percent')));
 d.variants[0].yield.loss_percent='0';d.variants[0].groups[0].ingredients[0].quantity='1000000000001';assert.ok(validateRecipe(d).length);
 assert.throws(()=>inputQuantity('1000000000001'));assert.equal(exact(inputQuantity('1000000000000')),'1000000000000');
});
test('duplicated method/checklist identities are rejected',()=>{
 const d=recipe(),v=d.variants[0];v.methods.push(structuredClone(v.methods[0]));assert.ok(validateRecipe(d).some(s=>s.includes('identifiers')));
 v.methods.pop();v.methods[0].steps[0].id='butter';assert.ok(validateRecipe(d).some(s=>s.includes('identifiers')));
});
test('yield review distinguishes measured raw mass, unknown conversions, finished weight and loss',()=>{
 const d=recipe(),v=d.variants[0];v.groups[0].ingredients.push({id:'flour',name:'Flour',quantity:'0.906',unit:'kg'});v.yield={quantity:'6',unit:'pcs',batch_weight:'1000',finished_weight:'900',loss_percent:'10'};
 assert.deepEqual(yieldReview(v),{raw_weight:'1000',complete:true,warnings:[]});
 v.yield.finished_weight='1200';assert.equal(yieldReview(v).warnings.length,2);
 v.groups[0].ingredients.push({id:'milk',name:'Milk',quantity:'100',unit:'ml'});assert.equal(yieldReview(v).complete,false);assert.equal(yieldReview(v).raw_weight,'1000');
});
test('all required multipliers preserve exact formulas and display rounding does not alter them',()=>{
 const d=recipe(),source=JSON.stringify(d),v=d.variants[0];
 for(const [factor,expected] of [['0.25','23.5'],['0.5','47'],['0.75','70.5'],['1','94'],['1.15','108.1'],['1.5','141'],['2','188'],['3','282'],['10','940']])assert.equal(scaleIngredients(v.groups,factor)[0].ingredients[0].scaled_display,expected);
 const scaled=scaledCopy(d,v.id,'6');assert.equal(scaled.variants[0].groups[0].ingredients[0].quantity,'564');assert.equal(JSON.stringify(d),source);
 assert.equal(displayQuantity('487.6',{mode:'whole'}).text,'488');assert.equal(exact(displayQuantity('487.6',{mode:'whole'}).exact),'487.6');
 for(const step of ['0','-1','bad'])assert.throws(()=>displayQuantity('1',{mode:'practical',step}));
 for(const unit of ['pack','bottle','tray','box']){assert.equal(exact(convert('2',unit,unit)),'2');assert.throws(()=>convert('2',unit,'pc'));}
 assert.throws(()=>convert('1','g','ml'));assert.throws(()=>convert('1','kg','pcs'));
});
test('saving a scaled saleable copy preserves revenue basis and portion-size semantics',()=>{
 const d=recipe(),v=d.variants[0];v.costing={mode:'saleable',labor_percent:'20',saleable_yield:'6',sale_unit:'box',price_basis:'batch',selling_price:'1080'};
 const copy=scaledCopy(d,v.id,'2');assert.equal(copy.variants[0].costing.saleable_yield,'12');assert.equal(copy.variants[0].costing.selling_price,'2160');
 const larger=scaledCopy(d,v.id,'2',{mode:'portion',target:'200'});assert.equal(larger.variants[0].costing.saleable_yield,'6');assert.equal(larger.variants[0].costing.selling_price,'1080');
 assert.equal(v.costing.saleable_yield,'6');assert.equal(v.costing.selling_price,'1080');
});
