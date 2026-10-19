import test from 'node:test';
import assert from 'node:assert/strict';
import {scalingOptions,initialScale,scaleFactor,exact} from '../assets/ordering/recipe-math.js';

const modes=yieldInfo=>scalingOptions(yieldInfo).map(([mode])=>mode);
const custom=(patch={})=>({id:'trays',label:'Trays',quantity:'2',unit:'trays',...patch});

test('recipes offer only scaling choices backed by saved amounts',()=>{
 assert.deepEqual(modes(),['multiplier']);
 assert.deepEqual(modes({}),['multiplier']);
 assert.deepEqual(modes({quantity:'1',unit:'batch'}),['multiplier','yield']);
 const full={quantity:'1',unit:'cake',portions:'8',portion_weight:'100',batch_weight:'800',pans:'2'};
 assert.deepEqual(modes(full),['multiplier','yield','pieces','portions','portion','weight','pans']);
 for(const [mode] of scalingOptions(full))assert.ok(scaleFactor(full,mode,'1').n>0n);
});

test('piece counts use the existing count-unit and portions fallback rules',()=>{
 for(const unit of ['pc','pcs','piece','pieces',' PCS ']){
  const info={quantity:'6',unit};
  assert.deepEqual(modes(info),['multiplier','yield','pieces']);
  assert.equal(exact(scaleFactor(info,'pieces','18')),'3');
 }
 assert.deepEqual(modes({quantity:'1',unit:'cake',portions:'12'}),['multiplier','yield','pieces','portions']);
 assert.deepEqual(modes({quantity:'0',unit:'pcs',portions:'12'}),['multiplier','portions']);
});

test('missing, zero and invalid amounts never become scaling options',()=>{
 for(const amount of [undefined,null,'',' ','0','0/2',0,'-1','1/0','unknown']){
  const info={quantity:amount,unit:'pcs',portions:amount,portion_weight:amount,batch_weight:amount,pans:amount};
  assert.deepEqual(modes(info),['multiplier'],String(amount));
 }
 assert.deepEqual(modes({quantity:'1',unit:'cake',pan_size:'8 inch',finished_weight:'500'}),['multiplier','yield']);
});

test('fractional saved amounts enable their exact scaling modes',()=>{
 const info={quantity:'1/2',unit:'batch',portions:'1 1/2',portion_weight:'½',batch_weight:'0.125',pans:'1/4'};
 assert.deepEqual(modes(info),['multiplier','yield','pieces','portions','portion','weight','pans']);
 assert.equal(exact(scaleFactor(info,'pans','1')),'4');
 assert.equal(exact(scaleFactor(info,'weight','0.25')),'2');
});

test('custom choices preserve their names, order and configured menu',()=>{
 const info={quantity:'1',unit:'cake',pans:'2',scale_options:[custom(),custom({id:'pcs',label:'Pieces',quantity:'12',unit:'pcs'})]};
 assert.deepEqual(scalingOptions(info),[['multiplier','Multiplier'],['custom:trays','Trays'],['custom:pcs','Pieces']]);
 assert.equal(exact(scaleFactor(info,'custom:pcs','18')),'1.5');
 assert.deepEqual(modes({...info,scale_options:[]}),['multiplier','yield','pans']);
});

test('incomplete custom choices are omitted without exposing unrelated standard modes',()=>{
 const invalid=[null,custom({id:''}),custom({label:' '}),custom({unit:''}),custom({quantity:''}),custom({quantity:'0'}),custom({quantity:'1/0'}),custom({quantity:'1000000000001'})];
 const info={quantity:'1',unit:'cake',pans:'2',scale_options:invalid};
 assert.deepEqual(modes(info),['multiplier']);
 info.scale_options.push(custom({id:'valid',quantity:'1/2'}));
 assert.deepEqual(modes(info),['multiplier','custom:valid']);
 assert.equal(exact(scaleFactor(info,'custom:valid','1')),'2');
});

test('unavailable saved defaults fall back to Multiplier without changing recipe information',()=>{
 const fallback={mode:'multiplier',target:'1',rounding:'exact',step:'1'};
 for(const option of [custom({quantity:'0'}),custom({unit:''}),null]){
  const info={scale_options:[option],scale_default:'custom:trays'},before=structuredClone(info);
  assert.deepEqual(initialScale(info),fallback);assert.deepEqual(info,before);
 }
 assert.deepEqual(initialScale({scale_options:[custom()],scale_default:'custom:removed'}),fallback);
 const info={scale_options:[custom({quantity:'1 1/2'})],scale_default:'custom:trays'},before=structuredClone(info);
 assert.deepEqual(initialScale(info),{...fallback,mode:'custom:trays',target:'1 1/2'});
 assert.deepEqual(info,before);
});
