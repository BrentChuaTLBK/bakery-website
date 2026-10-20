import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
export default async function({db,check}){
 const h=await makeHarness(db),{owner,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 let salt,recipe;const close=(a,b)=>assert.ok(Math.abs(Number(a)-b)<1e-9,`${a} ≈ ${b}`);
 const summary=async(source='current')=>(await api('costing',{id:recipe.id,source})).snapshot.variants[0];
 await check('tsp recipe becomes costed from kg purchase price after adding its ingredient equivalent, without changing its formula',async()=>{
  salt=await api('save_resource',{kind:'ingredient',name:'Fixture salt',data:{default_unit:'g'},price:{amount:'100',quantity:'1',unit:'kg'}});
  const d=blankRecipe();d.name='Fixture teaspoon costing';d.variants[0].groups[0].ingredients=[{id:'salt',ingredient_id:salt.id,name:salt.name,quantity:'1/8',unit:'tsp'}];d.variants[0].methods[0].steps[0].instruction='Mix.';
  recipe=await api('create',{document:d,status:'production'});assert.equal((await summary()).complete,false);
  salt=await api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:{tsp:{quantity:'6',unit:'g'},tbsp:{quantity:'18',unit:'g'}}}});
  assert.equal((await summary()).complete,true);close((await summary()).ingredient_cost,.075);
  assert.equal((await summary('saved')).complete,false);
  assert.deepEqual((await api('get',{id:recipe.id})).document,recipe.document);
  const unchanged=await api('save',{id:recipe.id,revision:recipe.revision,document:recipe.document,status:'production'});
  assert.equal(unchanged.unchanged,true);assert.equal(unchanged.version,recipe.version);assert.equal((await summary('saved')).complete,false);
  const changed=structuredClone(recipe.document);changed.variants[0].methods[0].steps[0].instruction='Mix thoroughly.';
  recipe=await api('save',{id:recipe.id,revision:recipe.revision,document:changed,status:'production'});
  close((await summary('saved')).ingredient_cost,.075);
  salt=await api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:{tsp:{quantity:'4',unit:'g'},tbsp:{quantity:'12',unit:'g'}}}});
  close((await summary()).ingredient_cost,.05);close((await summary('saved')).ingredient_cost,.075);
  const scaled=(await api('costing',{id:recipe.id,factor:'2'})).snapshot.variants[0];close(scaled.ingredient_cost,.1);
 })();
 await check('equivalents remain ingredient-specific, validate on the server, and can be removed without rewriting history',async()=>{
  for(const conversions of [[],{tsp:{quantity:'0',unit:'g'}},{tsp:{quantity:'-1',unit:'g'}},{tsp:{quantity:'6',unit:'cup'}},{kg:{quantity:'2',unit:'g'}},{tsp:{quantity:'6',unit:'g'},TSP:{quantity:'5',unit:'g'}}]){
   await assert.rejects(()=>api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:conversions}}));
  }
  const other=await api('save_resource',{kind:'ingredient',name:'No inferred flour density',data:{default_unit:'g'},price:{amount:'100',quantity:'1',unit:'kg'}});
  const d=structuredClone(recipe.document);d.variants[0].groups[0].ingredients[0].ingredient_id=other.id;
  assert.equal((await api('cost_preview',{document:d})).snapshot.variants[0].complete,false);
  await api('save_access',{user_id:customer,permission:'kitchen'});
  await assert.rejects(()=>api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:salt.data},customer));
  salt=await api('save_resource',{id:salt.id,revision:salt.revision,kind:'ingredient',name:salt.name,data:{...salt.data,unit_conversions:{}}});
  assert.equal((await summary()).complete,false);close((await summary('saved')).ingredient_cost,.075);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.recipe_validate_unit_equivalents()','execute')",[role]),false);
 })();
 await check('piece weights cost existing gram recipes, aliases and linked yields without changing saved history',async()=>{
  let eggs=await api('save_resource',{kind:'ingredient',name:'Measured egg whites',data:{default_unit:'pcs'},price:{amount:'12',quantity:'1',unit:'pc'}});
  const d=blankRecipe();d.name='Measured egg white recipe';d.variants[0].groups[0].ingredients=[{id:'egg',ingredient_id:eggs.id,name:eggs.name,quantity:'60',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Whisk.';
  const saved=await api('create',{document:d,status:'final'});
  const cost=async(source='current')=>(await api('costing',{id:saved.id,source})).snapshot.variants[0];
  assert.equal((await cost()).complete,false);
  eggs=await api('save_resource',{id:eggs.id,revision:eggs.revision,kind:'ingredient',name:eggs.name,data:{...eggs.data,unit_conversions:{pcs:{quantity:'30',unit:'g'},tray:{quantity:'12',unit:'pc'}}}});
  close((await cost()).ingredient_cost,24);assert.equal((await cost()).complete,true);assert.equal((await cost('saved')).complete,false);
  assert.deepEqual((await api('get',{id:saved.id})).document,saved.document);
  close((await api('costing',{id:saved.id,factor:'3'})).snapshot.variants[0].ingredient_cost,72);
  for(const [quantity,unit] of [['0.06','kg'],['60000','mg'],['2','pc'],['2','pcs'],['2','piece'],['2','pieces'],['1/6','tray']]){
   const doc=structuredClone(d);Object.assign(doc.variants[0].groups[0].ingredients[0],{quantity,unit});
   close((await api('cost_preview',{document:doc})).snapshot.variants[0].ingredient_cost,24);
  }
  const blend=await api('save_resource',{kind:'ingredient',name:'Measured egg white yield',data:{default_unit:'g',yield_source:{sources:[{ingredient_id:eggs.id,source_quantity:'60',source_unit:'g'},{ingredient_id:salt.id,source_quantity:'1',source_unit:'g'}],yield_quantity:'20',yield_unit:'g'}}});
  const quote=(await api('resources',{kind:'ingredient',query:blend.name})).rows[0].price;close(quote.amount,24.1);close(quote.quantity,20);
  for(const conversions of [{pc:{quantity:'30',unit:'g'},pcs:{quantity:'40',unit:'g'}},{pcs:{quantity:'2',unit:'piece'}},{pcs:{quantity:'0',unit:'g'}},{g:{quantity:'1/30',unit:'pc'}}])await assert.rejects(()=>api('save_resource',{id:eggs.id,revision:eggs.revision,kind:'ingredient',name:eggs.name,data:{...eggs.data,unit_conversions:conversions}}));
  const other=await api('save_resource',{kind:'ingredient',name:'Unmeasured egg whites',data:{default_unit:'pcs'},price:{amount:'12',quantity:'1',unit:'pcs'}});
  const otherDoc=structuredClone(d);otherDoc.variants[0].groups[0].ingredients[0].ingredient_id=other.id;
  assert.equal((await api('cost_preview',{document:otherDoc})).snapshot.variants[0].complete,false);
  eggs=await api('save_resource',{id:eggs.id,revision:eggs.revision,kind:'ingredient',name:eggs.name,data:{...eggs.data,unit_conversions:{pcs:{quantity:'40',unit:'g'}}}});close((await cost()).ingredient_cost,18);
  eggs=await api('save_resource',{id:eggs.id,revision:eggs.revision,kind:'ingredient',name:eggs.name,data:{...eggs.data,unit_conversions:{}}});assert.equal((await cost()).complete,false);
 })();
 await check('piece equivalents preserve purchases and compare suppliers per piece or per gram',async()=>{
  const a=await api('save_resource',{kind:'supplier',name:'Egg supplier A',data:{}}),b=await api('save_resource',{kind:'supplier',name:'Egg supplier B',data:{}});
  const eggs=await api('save_resource',{kind:'ingredient',name:'Egg purchase equivalents',data:{default_unit:'g',unit_conversions:{pcs:{quantity:'30',unit:'g'},tray:{quantity:'10',unit:'pcs'}}},suppliers:[{supplier_id:a.id,price:{amount:'9',quantity:'1',unit:'pc'}},{supplier_id:b.id,price:{amount:'120',quantity:'300',unit:'g'}}]});
  const purchase={request_id:randomUUID(),resource_id:eggs.id,kind:'ingredient',name:eggs.name,supplier_id:a.id,amount:'10',quantity:'1',unit:'pcs'};
  const preview=await api('purchase_preview',purchase);close(preview.current_unit_cost,12);close(preview.proposed_unit_cost,10);close(preview.effective_unit_cost,12);
  await api('record_purchase',purchase);
  const preferred={...purchase,request_id:randomUUID(),preferred:true};close((await api('purchase_preview',preferred)).effective_unit_cost,10);await api('record_purchase',preferred);
  const row=(await api('resources',{kind:'ingredient',query:eggs.name})).rows[0];close(row.price.amount/row.price.quantity,1/3);assert.equal(row.price.unit,'g');
  assert.ok((await api('prices',{id:eggs.id})).some(p=>p.unit==='pcs'&&Number(p.amount)===10&&Number(p.quantity)===1));
  const pack={...purchase,request_id:randomUUID(),unit:'tray',quantity:'1',amount:'100',contents_quantity:'10',contents_unit:'pcs'};
  close((await api('purchase_preview',pack)).effective_unit_cost,10);await api('record_purchase',pack);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar("select has_function_privilege($1,'tlb.recipe_resource_unit(jsonb,text)','execute')",[role]),false);
 })();
}
