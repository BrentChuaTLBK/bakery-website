import {unwrapRecipeResult} from './recipe-staff-fixture.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {blankRecipe,clone} from '../../assets/ordering/recipe-model.js';
export default async function({db,check,state}){
 const h=state.recipeHarness,{owner,staff,customer,stranger,unverified}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result).then(unwrapRecipeResult);
 const oracle=JSON.parse(await readFile(new URL('../fixtures/recipe-cost-oracle.json',import.meta.url),'utf8'));
 const actuals=[],records=new Map();
 function document(name='Cost audit'){const d=blankRecipe();d.name=name;d.variants[0].methods[0].steps[0].instruction='Mix the measured ingredients.';return d;}
 function equal(actual,expected,label){if(expected===null){assert.equal(actual,null,label);return;}assert.ok(actual!==null&&Number.isFinite(Number(actual)),label+' available');assert.ok(Math.abs(Number(actual)-Number(expected))<1e-9,`${label}: expected ${expected}, received ${actual}`);}
 for(const fixture of oracle.cases)await check(`Independent cost oracle ${fixture.id}: ${fixture.name}`,async()=>{
  const d=document(`Cost audit ${fixture.id}: ${fixture.name}`),v=d.variants[0];v.costing=fixture.costing;v.yield={quantity:'6',unit:'pcs',portions:'6'};
  v.groups[0].ingredients=fixture.ingredients.map((r,i)=>({id:`ingredient-${i}`,name:r.name,quantity:r.quantity,unit:r.unit,...(r.price?{cost_snapshot:r.price}:{})}));
  for(const p of fixture.packaging){const r=await api('save_resource',{kind:'packaging',name:p.name+' '+fixture.id,data:{default_unit:p.unit},price:p.price});v.additional_costs.push({id:r.id,resource_id:r.id,resource_name:p.name,quantity:p.quantity,unit:p.unit,amount:'0'});}
  if(fixture.other_direct!=='0')v.additional_costs.push({id:'direct',name:'Other direct',kind:'direct',amount:fixture.other_direct});
  if(fixture.component){const c=document('Cost audit component'),cv=c.variants[0];cv.groups[0].ingredients=[{id:'sugar',name:'Sugar',quantity:'100',unit:'g',cost_snapshot:{amount:'100',quantity:'1000',unit:'g',currency:'PHP'}}];cv.yield={quantity:'100',unit:'g'};const child=await api('create',{document:c,status:'final'});v.components=[{id:'component',version_id:child.version_id,variant_id:cv.id,quantity:'50',unit:'g'}];}
  const saved=await api('create',{document:d,status:'final'});records.set(fixture.id,saved);
  const cost=await api('costing',{id:saved.id,version_id:saved.version_id,factor:fixture.factor,source:'saved'});const summary=cost.snapshot.variants[0];
  assert.equal(summary.complete,fixture.complete);assert.equal(cost.version_id,saved.version_id);assert.equal(cost.source,'saved');
  for(const [field,expected] of Object.entries(fixture.expected))equal(summary[field],expected,`${fixture.id} ${field}`);
  actuals.push({id:fixture.id,name:fixture.name,expected:fixture.expected,actual:Object.fromEntries(Object.keys(fixture.expected).map(k=>[k,summary[k]])),result:'PASS'});
 })();
 await check('selling basis and saleable yield are independent of raw yield, including box, cake, tray and set',async()=>{
  for(const sale_unit of ['each','box','whole_cake','tray','set']){const d=clone(records.get('O').document);d.variants[0].yield={quantity:'1000',unit:'g'};d.variants[0].costing={mode:'saleable',saleable_yield:'4',sale_unit,price_basis:'unit',selling_price:'50',labor_percent:'20'};const c=(await api('cost_preview',{document:d})).snapshot.variants[0];equal(c.revenue,'200','revenue');equal(c.unit_adjusted,'30','per saleable unit');assert.equal(c.sale_unit,sale_unit);}
 })();
 await check('incomplete ingredient or packaging prices suppress full cost and profit, while zero cost remains explicit',async()=>{
  const d=clone(records.get('O').document);const box=await api('save_resource',{kind:'packaging',name:'Unpriced audit box',data:{default_unit:'pc'}});
  d.variants[0].additional_costs=[{resource_id:box.id,resource_name:'Unpriced audit box',quantity:'1',unit:'pc',amount:'0'}];const c=(await api('cost_preview',{document:d})).snapshot.variants[0];assert.equal(c.complete,false);assert.equal(c.profit,null);assert.equal(c.base_cost,null);assert.ok(c.missing.some(m=>m.name==='Unpriced audit box'));
  const zero=records.get('S').cost_snapshot.variants[0];assert.equal(zero.markup,null);equal(zero.margin,'100','zero cost margin');
 })();
 await check('costing-only components have base and adjusted costs without invented selling prices',async()=>{
  const d=clone(records.get('O').document);d.variants[0].costing={mode:'costing_only',labor_percent:'25'};const c=(await api('cost_preview',{document:d})).snapshot.variants[0];equal(c.base_cost,'100','base');equal(c.adjusted_cost,'125','adjusted');assert.equal(c.profit,null);assert.equal(c.revenue,null);assert.equal(c.saleable_yield,null);
 })();
 await check('larger portion weights increase ingredient cost without inventing extra saleable items',async()=>{
  const r=records.get('P'),c=(await api('costing',{id:r.id,factor:'2',scaling_mode:'portion'})).snapshot.variants[0];
  equal(c.base_cost,'1200','larger portion cost');equal(c.saleable_yield,'6','same six pieces');equal(c.revenue,'1080','same six saleable pieces');equal(c.profit,'-120','larger portion profit');
  const batch=records.get('Q'),b=(await api('costing',{id:batch.id,factor:'2',scaling_mode:'portion'})).snapshot.variants[0];equal(b.revenue,'1080','same base batch selling price');equal(b.break_even,'1200','batch break even');
 })();
 await check('server rejects invalid profitability settings before saving any recipe version',async()=>{
  const saved=records.get('O');
  for(const change of [{mode:'wrong'},{saleable_yield:'0'},{saleable_yield:'-1'},{selling_price:'-1'},{selling_price:''},{labor_percent:'-1'},{labor_percent:'10001'},{price_basis:'unknown'},{sale_unit:'unknown'}]){const d=clone(saved.document);Object.assign(d.variants[0].costing,change);await assert.rejects(()=>api('save',{id:saved.id,revision:saved.revision,document:d,status:'final'}));}
  assert.equal((await api('get',{id:saved.id})).version,1);
 })();
 await check('a fixed charge is not multiplied while variable ingredients and packaging scale',async()=>{
  const d=clone(records.get('J').document);d.name='Fixed audit charge';d.variants[0].additional_costs=[{name:'Fixed delivery',amount:'10',per_batch:false},{name:'Manual packaging',kind:'packaging',amount:'20'}];
  const saved=await api('create',{document:d,status:'final'}),c=(await api('costing',{id:saved.id,factor:'2'})).snapshot.variants[0];equal(c.ingredient_cost,'200','ingredients');equal(c.packaging_cost,'40','packaging');equal(c.other_direct_cost,'10','fixed direct');equal(c.base_cost,'250','base');assert.equal(c.lines.at(-2).amount,'10');
 })();
 await check('legacy format-one snapshots reconstruct saved costs without consulting new prices or guessing charge categories',async()=>{
  const d=clone(records.get('J').document),v=d.variants[0];delete v.costing;
  v.additional_costs=[{name:'Legacy charge',amount:'20'}];
  const snapshot={format_version:1,currency:'PHP',calculated_at:'2026-01-01T00:00:00Z',variants:[{variant_id:v.id,total:'120',complete:true,missing:[],lines:[{row_id:v.groups[0].ingredients[0].id,name:'Saved ingredient',amount:'100'},{name:'Legacy charge',amount:'20',additional:true}]}]};
  const c=(await db.query('select tlb.recipe_snapshot_variant($1::jsonb,$2::jsonb,$3,2) result',[JSON.stringify(d),JSON.stringify(snapshot),v.id])).rows[0].result;
  equal(c.base_cost,'240','legacy base at x2');equal(c.ingredient_cost,'200','legacy ingredients');equal(c.packaging_cost,'0','not guessed');equal(c.other_direct_cost,'40','legacy charge retained');assert.equal(c.mode,'costing_only');assert.equal(c.profit,null);
 })();
 await check('current prices recursively refresh pinned component formulas while saved costs and profitability remain immutable',async()=>{
  const supplier=await api('save_resource',{kind:'supplier',name:'Audit supplier A',data:{}});
  let ingredient=await api('save_resource',{kind:'ingredient',name:'Audit linked flour',data:{default_unit:'g',preferred_supplier_id:supplier.id},price:{amount:'100',quantity:'1000',unit:'g',supplier_id:supplier.id}});
  const childDoc=document('Audit pinned child');childDoc.variants[0].groups[0].ingredients=[{id:'flour',ingredient_id:ingredient.id,name:ingredient.name,quantity:'100',unit:'g'}];childDoc.variants[0].yield={quantity:'100',unit:'g'};
  let child=await api('create',{document:childDoc,status:'final'});
  const d=document('Audit live versus saved');d.variants[0].groups=[];d.variants[0].methods=[];d.variants[0].components=[{id:'child',version_id:child.version_id,variant_id:childDoc.variants[0].id,quantity:'50',unit:'g'}];d.variants[0].costing={mode:'saleable',saleable_yield:'1',sale_unit:'box',price_basis:'unit',selling_price:'30',labor_percent:'20'};
  const parent=await api('create',{document:d,status:'final'}),before=clone(parent.cost_snapshot);
  let current=await api('costing',{id:parent.id,source:'current'});assert.equal(current.prices_changed,false);equal(current.snapshot.variants[0].base_cost,'5','initial');
  ingredient=await api('save_resource',{id:ingredient.id,revision:ingredient.revision,kind:'ingredient',name:ingredient.name,data:ingredient.data,price:{amount:'200',quantity:'1000',unit:'g',supplier_id:supplier.id}});
  const changed=clone(child.document);changed.variants[0].groups[0].ingredients[0].quantity='200';child=await api('save',{id:child.id,revision:child.revision,document:changed,status:'final'});
  current=await api('costing',{id:parent.id});assert.equal(current.source,'current');assert.equal(current.prices_changed,true);equal(current.snapshot.variants[0].base_cost,'10','same pinned 100g formula with new price');equal(current.saved.variants[0].base_cost,'5','saved');equal(current.snapshot.variants[0].profit,'18','current profit');equal(current.saved.variants[0].profit,'24','saved profit');
  assert.deepEqual((await api('get',{id:parent.id})).cost_snapshot,before);
  const overview=await api('costing_overview',{query:'Audit live versus saved'});assert.equal(overview.source,'current');equal(overview.rows[0].summary.base_cost,'10','overview current component cost');
  const historical=await api('costing_overview',{query:'Audit live versus saved',source:'saved'});equal(historical.rows[0].summary.base_cost,'5','explicit historical overview');
  equal((await api('costing',{id:parent.id,source:'saved'})).snapshot.variants[0].base_cost,'5','explicit historical cost');
  const draft=await api('save',{id:parent.id,revision:parent.revision,document:parent.document,status:'draft'});equal(draft.cost_snapshot.variants[0].base_cost,'5','saved pinned component price rule');
  const restored=await api('restore_version',{version_id:parent.version_id,revision:draft.revision,status:'draft'});assert.deepEqual(restored.cost_snapshot,before);assert.deepEqual(restored.document.variants[0].costing,parent.document.variants[0].costing);
 })();
 await check('one ingredient and packaging price change updates every linked recipe and overview filters without saving recipes',async()=>{
  let butter=await api('save_resource',{kind:'ingredient',name:'Automatic butter',data:{default_unit:'g'},price:{amount:'100',quantity:'100',unit:'g'}});
  let box=await api('save_resource',{kind:'packaging',name:'Automatic box',data:{default_unit:'pc'},price:{amount:'10',quantity:'1',unit:'pc'}});
  const linked=[];
  for(const [name,quantity] of [['A','10'],['B','20']]){
   const d=document('Automatic cost '+name);d.variants[0].groups[0].ingredients=[{id:'butter',ingredient_id:butter.id,name:butter.name,quantity,unit:'g'}];
   d.variants[0].additional_costs=[{id:box.id,resource_id:box.id,resource_name:box.name,quantity:'1',unit:'pc',amount:'0'}];
   d.variants[0].costing={mode:'saleable',saleable_yield:'1',sale_unit:'box',price_basis:'unit',selling_price:'40',labor_percent:'0'};
   linked.push(await api('create',{document:d,status:'final'}));
  }
  butter=await api('save_resource',{id:butter.id,revision:butter.revision,kind:'ingredient',name:butter.name,data:butter.data,price:{amount:'200',quantity:'100',unit:'g'}});
  box=await api('save_resource',{id:box.id,revision:box.revision,kind:'packaging',name:box.name,data:box.data,price:{amount:'15',quantity:'1',unit:'pc'}});
  for(const [i,r] of linked.entries()){
   const current=await api('costing',{id:r.id});assert.equal(current.source,'current');equal(current.snapshot.variants[0].base_cost,i===0?'35':'55','automatic cost');
   const unchanged=await api('get',{id:r.id});assert.equal(unchanged.version,1);assert.deepEqual(unchanged.document,r.document);assert.deepEqual(unchanged.cost_snapshot,r.cost_snapshot);
  }
  const overview=await api('costing_overview',{query:'Automatic cost ',sort:'highest_cost',limit:1});assert.equal(overview.total,2);assert.equal(overview.rows[0].id,linked[1].id);equal(overview.rows[0].summary.base_cost,'55','sort uses current costs');
  const negative=await api('costing_overview',{query:'Automatic cost ',condition:'negative'});assert.equal(negative.total,1);assert.equal(negative.rows[0].id,linked[1].id);
  assert.equal((await api('costing_overview',{query:'Automatic cost ',condition:'negative',source:'saved'})).total,0);
  await api('save_resource',{id:butter.id,revision:butter.revision,kind:'ingredient',name:butter.name,data:{...butter.data,allow_unassigned_price:false}});
  const missing=await api('costing_overview',{query:'Automatic cost ',condition:'missing'});assert.equal(missing.total,2);assert(missing.rows.every(r=>r.summary.profit===null));
 })();
 await check('costing APIs and private helper functions deny students, kitchen, unverified and anonymous callers',async()=>{
  for(const user of [null,customer,stranger,unverified])for(const action of ['costing','cost_preview','costing_overview'])await assert.rejects(()=>api(action,{id:records.get('O').id,document:records.get('O').document},user),/permission|Authorized/);
  const kitchen=await api('get',{id:records.get('O').id},customer);assert.equal(kitchen.cost_snapshot,undefined);assert.equal(kitchen.document.variants[0].costing,undefined);
  for(const user of [customer,staff])await assert.rejects(()=>h.as(user,()=>db.query("select tlb.recipe_profit_metrics('{}',1,1,1,true,1)")),/permission/);
  assert.ok((await api('costing_overview',{},staff)).total>0);
 })();
 await check('Academy imports whitelist a real costed production version and retain an independent student copy',async()=>{
  const production=records.get('O');const academy=(action,payload={})=>h.as(owner,async()=>(await db.query('select public.academy_portal_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
  const imported=await academy('import_recipe',{version_id:production.version_id});
  const forbidden=new Set(['costing','cost_snapshot','additional_costs','supplier_id','price','selling_price','labor_percent','profit','margin','markup']);
  function verify(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){assert.equal(forbidden.has(key),false,`Academy field ${key}`);verify(item);}}verify(imported.document);
  const changed=clone(production.document);changed.description='Changed production after student import';changed.variants[0].costing.selling_price='400';
  await api('save',{id:production.id,revision:production.revision,document:changed,status:'draft'});
  const student=(await db.query('select document from tlb.academy_student_recipes where id=$1',[imported.id])).rows[0].document;assert.deepEqual(student,imported.document);
 })();
 await check('costing overview filters, totals, sorting and pagination operate on matching saleable sizes',async()=>{
  const all=await api('costing_overview',{query:'Cost audit ',limit:100});assert.equal(all.total,19);assert.equal(all.rows.length,19);
  const missing=await api('costing_overview',{query:'Cost audit ',condition:'missing'});assert.equal(missing.total,1);assert.match(missing.rows[0].name,/ H:/);
  const negative=await api('costing_overview',{query:'Cost audit ',condition:'negative'});assert.deepEqual(negative.rows.map(r=>r.summary.profit).map(Number).sort((a,b)=>a-b),[-212,-20]);
  for(const [sort,field,direction] of [['highest_cost','adjusted_cost',-1],['lowest_cost','adjusted_cost',1],['highest_profit','profit',-1],['lowest_margin','margin',1],['highest_margin','margin',-1]]){const data=await api('costing_overview',{query:'Cost audit ',sort,limit:100});const values=data.rows.map(r=>r.summary[field]).filter(v=>v!==null).map(Number);assert.deepEqual(values,[...values].sort((a,b)=>(a-b)*direction));}
  const page=await api('costing_overview',{query:'Cost audit ',limit:3,offset:3});assert.equal(page.rows.length,3);assert.equal(page.total,19);assert.deepEqual(page.rows.map(r=>r.id),all.rows.slice(3,6).map(r=>r.id));
  const cat=await api('save_category',{name:'Audit saleable filter'}),filtered=records.get('B'),d=clone(filtered.document);d.category_id=cat.id;d.product_line='Audit line';
  const updated=await api('save',{id:filtered.id,revision:filtered.revision,document:d,status:'draft'});
  const combined=await api('costing_overview',{query:'Cost audit ',category_id:cat.id,product_line:'Audit line',status:'draft',recent:true,condition:'profitable',sort:'updated'});assert.equal(combined.total,1);assert.equal(combined.rows[0].version_id,updated.version_id);
  const target=records.get('A');await api('set_status',{id:target.id,revision:target.revision,status:'archive'});assert.equal((await api('costing_overview',{query:'Cost audit '})).total,18);assert.equal((await api('costing_overview',{query:'Cost audit ',status:'archive'})).total,1);
 })();
 await mkdir('work/recipe-audit',{recursive:true});await writeFile('work/recipe-audit/calculation-results.json',JSON.stringify(actuals,null,2));
}
