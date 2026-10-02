import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import {blankRecipe,freshVariant} from '../../assets/ordering/recipe-model.js';

export default async function({db,check,state={}}){
 const h=state.recipeHarness||await makeHarness(db),{owner,staff,customer,stranger}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const original=(await db.query('select settings from tlb.recipe_settings where id')).rows[0].settings;
 const accounting=(action,payload={},user=owner)=>h.api('accounting_'+action,{...payload,report_version:2},user);
 const doc=name=>{const d=blankRecipe();d.name=name;d.variants[0].methods[0].steps[0].instruction='Mix and finish.';return d;};
 const setting=()=>api('costing_settings');const setPercent=async percent=>api('save_costing_settings',{percent,revision:(await setting()).revision});
 const summary=async(record,source='current')=>(await api('costing',{id:record.id,version_id:record.version_id,source})).snapshot.variants;
 let child,parent,ingredient;
 try{
  await api('save_access',{user_id:staff,permission:'chef'});await api('save_access',{user_id:customer,permission:'kitchen'});
  await check('shared allowance remains unset until chosen and legacy costs stay unchanged',async()=>{
   assert.equal((await setting()).configured,false);
   ingredient=await api('save_resource',{kind:'ingredient',name:'Refinement butter',data:{default_unit:'g'},price:{amount:'100',quantity:'1000',unit:'g'}});
   const d=doc('Refinement component'),v=d.variants[0];v.yield={quantity:'100',unit:'g'};v.costing.labor_percent='5';v.groups[0].ingredients=[{id:randomUUID(),ingredient_id:ingredient.id,name:ingredient.name,quantity:'100',unit:'g'}];
   child=await api('create',{document:d,status:'final'});
   const p=doc('Refinement product'),pv=p.variants[0];pv.groups[0].ingredients=[{id:randomUUID(),ingredient_id:ingredient.id,name:ingredient.name,quantity:'50',unit:'g'}];pv.yield={quantity:'2',unit:'cakes'};pv.components=[{id:randomUUID(),version_id:child.version_id,variant_id:v.id,quantity:'50',unit:'g'}];pv.costing={mode:'saleable',labor_percent:'30',saleable_yield:'2',sale_unit:'whole_cake',selling_price:'20',price_basis:'unit'};
   const second=freshVariant(pv,'Large');second.groups[0].ingredients[0].quantity='100';second.components[0].quantity='200';p.variants.push(second);parent=await api('create',{document:p,status:'final'});
   assert.equal(Number((await summary(child))[0].adjusted_cost),10.5);assert.deepEqual((await summary(parent)).map(c=>Number(c.adjusted_cost)),[13,39]);
  })();
  await check('one owner percentage updates every size and linked component once, without changing history',async()=>{
   const before=structuredClone(parent);await setPercent('25');
   assert.equal(Number((await summary(child))[0].adjusted_cost),12.5);
   assert.deepEqual((await summary(parent)).map(c=>Number(c.adjusted_cost)),[12.5,37.5]);
   assert.deepEqual((await summary(parent,'saved')).map(c=>Number(c.adjusted_cost)),[13,39]);
   const unchanged=await api('get',{id:parent.id});assert.deepEqual(unchanged.document,before.document);assert.deepEqual(unchanged.cost_snapshot,before.cost_snapshot);assert.equal(unchanged.version,1);
   const scaled=(await api('costing',{id:parent.id,factor:'2'})).snapshot.variants[0];assert.equal(Number(scaled.adjusted_cost),25);assert.equal(Number(scaled.revenue),80);
   const overview=await api('costing_overview',{query:'Refinement product',mode:'all'});assert.equal(overview.global_allowance.percent,'25');assert.equal(overview.rows.length,2);assert(overview.rows.every(row=>Number(row.summary.labor_percent)===25));
   const next=await api('save',{id:parent.id,revision:parent.revision,document:parent.document,status:'final'});assert(next.document.variants.every(v=>v.costing.labor_percent==='25'));parent=next;
  })();
  await check('zero is a valid shared allowance; invalid values and stale writes are rejected',async()=>{
   const stale=await setting();await setPercent('0');assert.equal(Number((await summary(parent))[0].adjusted_cost),10);assert.equal(Number((await summary(parent,'saved'))[0].adjusted_cost),12.5);
   await assert.rejects(()=>api('save_costing_settings',{percent:'15',revision:stale.revision}),/changed/);
   for(const percent of ['-1','10001','NaN','Infinity','',null])await assert.rejects(()=>setPercent(percent));
   assert.equal(Number((await setting()).percent),0);
  })();
  await check('custom units persist for editors and prevent case-insensitive duplicates',async()=>{
   const saved=await api('save_recipe_unit',{name:'Bag',symbol:'bag'},staff);assert(saved.units.some(u=>u.name==='Bag'&&u.symbol==='bag'));
   assert((await api('bootstrap',{},staff)).settings.recipe_units.some(u=>u.symbol==='bag'));
   for(const symbol of ['BAG','g','KG',''])await assert.rejects(()=>api('save_recipe_unit',{name:'Duplicate',symbol}));
   assert((await api('recipe_units',{},staff)).units.some(u=>u.symbol==='bag'));
  })();
  await check('library cards use current costs and preserve recipe sizes',async()=>{
   const result=await api('library_costs',{recipes:[{id:parent.id,version_id:parent.version_id},{id:child.id}]});assert.equal(result.rows.length,2);assert.equal(result.rows[0].variants.length,2);assert.equal(Number(result.rows[0].variants[0].adjusted_cost),10);assert.equal(result.rows[0].variants[0].yield.unit,'cakes');
   await assert.rejects(()=>api('library_costs',{recipes:Array(25).fill({id:parent.id})}),/24/);
   const rdDocument=structuredClone(child.document);rdDocument.name='Restricted card';
   const rd=await api('create',{document:rdDocument,status:'testing'});
   await assert.rejects(()=>api('library_costs',{recipes:[{id:rd.id,version_id:rd.version_id}]},staff),/R&D/);
  })();
  await check('pack purchases normalize explicit contents, preview supplier selection, and preserve historical costs',async()=>{
   const supplier=await api('save_resource',{kind:'supplier',name:'Refinement pack supplier',data:{}});
   const expensive=await api('save_resource',{kind:'supplier',name:'Refinement high supplier',data:{}});
   const flour=await api('save_resource',{kind:'ingredient',name:'Refinement pack flour',data:{default_unit:'g'},suppliers:[{supplier_id:supplier.id,price:{amount:'200',quantity:'1000',unit:'g'}},{supplier_id:expensive.id,price:{amount:'450',quantity:'1',unit:'kg'}}]});
   const d=doc('Refinement pack cake');d.variants[0].groups[0].ingredients=[{id:randomUUID(),ingredient_id:flour.id,name:flour.name,quantity:'100',unit:'g'}];const saved=await api('create',{document:d,status:'final'});
   const purchase={request_id:randomUUID(),resource_id:flour.id,kind:'ingredient',name:flour.name,brand:'',supplier_id:supplier.id,amount:'600',quantity:'2',unit:'bag',contents_quantity:'1000',contents_unit:'g'};
   let preview=await api('purchase_preview',purchase);assert.equal(Number(preview.proposed_unit_cost),0.3);assert.equal(Number(preview.current_unit_cost),0.45);assert.equal(Number(preview.effective_unit_cost),0.45);assert.equal(preview.quantity,'2000');assert.equal(preview.affected_recipes,1);
   const result=await api('record_purchase',purchase);assert.deepEqual(await api('record_purchase',purchase),result);assert.equal(Number((await summary(saved))[0].adjusted_cost),45);
   const preferred={...purchase,request_id:randomUUID(),preferred:true};preview=await api('purchase_preview',preferred);assert.equal(Number(preview.effective_unit_cost),0.3);await api('record_purchase',preferred);
   assert.equal(Number((await summary(saved))[0].adjusted_cost),30);assert.equal(Number((await summary(saved,'saved'))[0].adjusted_cost),45);
   const prices=await api('prices',{id:flour.id});assert(prices.some(p=>Number(p.quantity)===2000&&p.unit==='g'));
   const bagDoc=structuredClone(saved.document);bagDoc.name='Refinement custom unit recipe';bagDoc.variants[0].groups[0].ingredients[0].quantity='1/2';bagDoc.variants[0].groups[0].ingredients[0].unit='bag';const bagRecipe=await api('create',{document:bagDoc,status:'final'});
   assert.equal(Number((await summary(bagRecipe))[0].adjusted_cost),150);
   await api('record_purchase',{...preferred,request_id:randomUUID(),amount:'800',contents_quantity:'2000'});
   assert.equal(Number((await summary(saved))[0].adjusted_cost),20);assert.equal(Number((await summary(bagRecipe))[0].adjusted_cost),200);assert.equal(Number((await summary(bagRecipe,'saved'))[0].adjusted_cost),150);
   await assert.rejects(()=>api('record_purchase',{...purchase,amount:'601'}),/already saved/);
   for(const values of [{contents_quantity:'0'},{contents_unit:'ml'},{contents_unit:'bag'},{contents_quantity:'-1'},{supplier_id:flour.id},{supplier_id:null}])await assert.rejects(()=>api('record_purchase',{...purchase,request_id:randomUUID(),...values}));
   for(const user of [customer,stranger,null])await assert.rejects(()=>api('purchase_preview',purchase,user));
  })();
  await check('purchase supplier IDs distinguish duplicate names and pack previews do not write records',async()=>{
   const first=await api('save_resource',{kind:'supplier',name:'Same supplier name',data:{}}),second=await api('save_resource',{kind:'supplier',name:'Same supplier name',data:{}});
   const purchase={request_id:randomUUID(),kind:'ingredient',name:'New pack ingredient',brand:'Example',supplier_id:second.id,amount:'240',quantity:'2',unit:'bag',contents_quantity:'500',contents_unit:'g'};
   const before=await h.scalar('select count(*) from tlb.recipe_prices');const preview=await api('purchase_preview',purchase);assert.equal(Number(preview.effective_unit_cost),0.24);assert.equal(preview.affected_recipes,0);assert.equal(await h.scalar('select count(*) from tlb.recipe_prices'),before);
   const result=await api('record_purchase',purchase);assert.equal(result.supplier_id,second.id);assert.notEqual(result.supplier_id,first.id);const saved=(await api('resources',{kind:'ingredient',query:'New pack ingredient'})).rows[0];assert.equal(saved.data.default_unit,'g');assert.equal(saved.data.unit_conversions.bag.quantity,'500');
  })();
  await check('shared settings remain owner-only and new private functions expose no direct grants',async()=>{
   for(const user of [staff,customer,stranger,null])await assert.rejects(()=>api('save_costing_settings',{percent:'10',revision:1},user));
   for(const user of [customer,stranger,null])for(const action of ['costing_settings','recipe_units','save_recipe_unit','library_costs'])await assert.rejects(()=>api(action,{name:'Leak',symbol:'leak',recipes:[{id:parent.id}]},user));
   const kitchen=await api('bootstrap',{},customer);assert.equal(kitchen.global_allowance,undefined);assert.equal(kitchen.settings.recipe_units,undefined);assert.equal(kitchen.settings.labor_utilities_percent,undefined);
   for(const signature of ['tlb.recipe_costing_settings()','tlb.recipe_apply_shared_allowance(jsonb)','tlb.recipe_resource_unit(jsonb,text)','tlb.recipe_purchase_parameters(jsonb)','tlb.recipe_api_before_workflow_refinement(text,jsonb)','tlb.accounting_report_before_all_time(uuid,jsonb)'])for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
  })();
  await check('all-time accounting derives earliest and latest eligible entries and extends on new entries',async()=>{
   const category=await accounting('save_category',{id:randomUUID(),revision:0,name:'Refinement range '+randomUUID()});
   const add=(day,amount=100)=>accounting('save_entry',{id:randomUUID(),revision:0,entry_date:day,category_id:category.id,kind:'sale',amount_cents:amount});
   const first=await add('2001-01-15'),latest=await add('2090-10-02',250);
   let report=await accounting('report',{mode:'all'});assert.equal(report.mode,'all');assert.equal(report.first_entry,'2001-01-15');assert.equal(report.latest_entry,'2090-10-02');assert(report.entries.some(e=>e.id===first.id));assert(report.entries.some(e=>e.id===latest.id));
   const earlier=await add('2000-01-01'),later=await add('2091-02-03');report=await accounting('report',{mode:'all',start:'2026-10-01',end:'2026-10-31'});assert.equal(report.start,'2000-01-01');assert.equal(report.end,'2091-02-03');
   await accounting('delete_entry',{id:earlier.id,revision:earlier.revision});await accounting('delete_entry',{id:later.id,revision:later.revision});report=await accounting('report',{mode:'all'});assert.equal(report.start,'2001-01-15');assert.equal(report.end,'2090-10-02');
   const filtered=await accounting('report',{mode:'month',start:'2090-10-01',end:'2090-10-31'});assert.equal(filtered.mode,'month');assert.equal(filtered.entries.length,1);assert.equal(filtered.entries[0].id,latest.id);
   for(const user of [staff,customer,stranger,null])await assert.rejects(()=>accounting('report',{mode:'all'},user),/authorized|owner|staff|access/i);
  })();
 }finally{await db.query('update tlb.recipe_settings set settings=$1::jsonb,revision=revision+1 where id',[JSON.stringify(original)]);}
}
