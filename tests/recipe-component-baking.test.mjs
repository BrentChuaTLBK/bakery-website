import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRecipe,addComponent,removeComponent,duplicateComponent,freshVariant,scaledCopy,recipeSections,pinBakingAssociations,stage,validateRecipe,differences} from '../assets/ordering/recipe-model.js';
import {bakingStageGroupId,bakingSections,hasBakingDetails,bakingDetailsMarkup,bakingEditor,bakingFieldLabel,setBakingFieldVisible,rememberBakingEditor,resetBakingEditor} from '../assets/ordering/recipe-baking.js';
import {rebuildImportedSections} from '../assets/ordering/recipe-import.js';
import {printBook,preparePrintRecords} from '../assets/ordering/recipe-print.js';

function sample(){
 const doc=blankRecipe();doc.name='Synthetic component baking sample';const v=doc.variants[0];
 v.groups[0].name='Batter';v.groups[0].ingredients[0].name='Sample flour';v.groups[0].ingredients[0].quantity='100';v.methods[0].steps[0].instruction='Mix the sample.';
 return {doc,v,group:v.groups[0]};
}
function details(overrides={}){return {...stage(),name:'Initial bake',top:'165',bottom:'160',minutes:'11',...overrides};}
function savedValues(value){const {id,group_id,...values}=value;return values;}
const helpers={field:(label,path)=>`<label>${label}<input data-path="${path}"></label>`,button:(label,action,extra='')=>`<button data-action="${action}" ${extra}>${label}</button>`};

test('legacy single-component association is read-only and explicit unassigned stays unassigned',()=>{
 const {v,group}=sample();const old={id:'old',name:'Bake',temperature:'180',notes:'Keep these notes'};v.baking=[old,{...details(),group_id:''}];const before=structuredClone(v);
 assert.equal(bakingStageGroupId(v,old),group.id);assert.equal(bakingStageGroupId(v,v.baking[1]),'');
 const sections=recipeSections(v);assert.equal(sections.components[0].baking[0].stage,old);assert.equal(sections.unassignedBaking[0].stage,v.baking[1]);assert.deepEqual(v,before);
});

test('ambiguous and stale legacy links remain visible in the unassigned fallback',()=>{
 const {v}=sample();addComponent(v,'Filling');v.baking=[{name:'Legacy bake',top:'170'},details({group_id:'missing'}),details({group_id:''})];const before=structuredClone(v);
 assert.deepEqual(bakingSections(v).map(s=>s.groupId),['','','']);assert.equal(recipeSections(v).unassignedBaking.length,3);assert.deepEqual(v,before);
});

test('adding a component pins an unambiguous legacy bake to its original component',()=>{
 const {v,group}=sample();v.baking=[{name:'Bake',top:'165',minutes:'11'}];const added=addComponent(v,'Filling');
 assert.equal(v.baking[0].group_id,group.id);assert.equal(recipeSections(v).components[0].baking.length,1);assert.equal(recipeSections(v).components[1].baking.length,0);assert.notEqual(added.id,group.id);
});

test('removing a component does not assign previously ambiguous legacy baking to the survivor',()=>{
 const {v}=sample();addComponent(v,'Filling');v.baking=[{name:'Legacy bake',top:'165'}];removeComponent(v,1);
 assert.equal(v.groups.length,1);assert.equal(v.baking[0].group_id,'');assert.equal(recipeSections(v).components[0].baking.length,0);assert.equal(recipeSections(v).unassignedBaking.length,1);
});

test('pinning only materializes missing associations and preserves explicit values and order',()=>{
 const {v,group}=sample();v.baking=[{id:'legacy',top:'180'},details({group_id:''}),details({group_id:group.id}),details({group_id:'missing'})];
 const before=v.baking.map(savedValues);pinBakingAssociations(v);assert.deepEqual(v.baking.map(s=>s.group_id),[group.id,'',group.id,'missing']);assert.deepEqual(v.baking.map(savedValues),before);
});

test('removing a component removes only its own baking stages and procedures',()=>{
 const {v,group}=sample();const filling=addComponent(v,'Filling');v.baking=[details({group_id:group.id}),details({name:'Filling',group_id:filling.id}),details({name:'Shared',group_id:''}),details({name:'Finish batter',group_id:group.id})];
 const keep=structuredClone(v.baking.filter(s=>s.group_id!==group.id));removeComponent(v,0);
 assert.deepEqual(v.baking,keep);assert.equal(v.groups[0].id,filling.id);assert.equal(v.methods.length,1);assert.equal(v.methods[0].group_id,filling.id);
});

test('duplicating a component copies only its methods and stages with fresh identities',()=>{
 const {v,group}=sample();const filling=addComponent(v,'Filling');v.baking=[details({group_id:group.id,core:'55'}),details({name:'Other component',group_id:filling.id}),details({name:'Browning',group_id:group.id,minutes:'3'}),details({name:'Shared',group_id:''})];
 const source=recipeSections(v).components[0],original=structuredClone(source),copy=duplicateComponent(v,0),sections=recipeSections(v),duplicated=sections.components[1];
 assert.equal(copy.name,'Batter — copy');assert.equal(duplicated.group.id,copy.id);assert.notEqual(copy.id,group.id);assert.notEqual(copy.ingredients[0].id,group.ingredients[0].id);
 assert.equal(duplicated.methods.length,source.methods.length);assert.notEqual(duplicated.methods[0].method.id,source.methods[0].method.id);assert.notEqual(duplicated.methods[0].method.steps[0].id,source.methods[0].method.steps[0].id);
 assert.deepEqual(duplicated.baking.map(s=>savedValues(s.stage)),original.baking.map(s=>savedValues(s.stage)));assert.equal(new Set(v.baking.map(s=>s.id)).size,v.baking.length);
 assert.deepEqual(duplicated.baking.map(s=>s.stage.name),['Initial bake','Browning']);assert.equal(sections.unassignedBaking.length,1);
 duplicated.baking[0].stage.top='190';duplicated.methods[0].method.steps[0].instruction='Only the copy';assert.equal(source.baking[0].stage.top,'165');assert.equal(source.methods[0].method.steps[0].instruction,'Mix the sample.');
});

test('duplicating a legacy sole component preserves the source association and copies its baking',()=>{
 const {v,group}=sample();v.baking=[{id:'legacy',name:'Bake',temperature:'175',minutes:'8'}];const copied=duplicateComponent(v,0);
 assert.deepEqual(v.baking.map(s=>s.group_id),[group.id,copied.id]);assert.deepEqual(v.baking.map(savedValues),[{name:'Bake',temperature:'175',minutes:'8'},{name:'Bake',temperature:'175',minutes:'8'}]);
});

test('new size variants remap component links without changing baking values or source versions',()=>{
 const {v,group}=sample();const filling=addComponent(v,'Filling');v.baking=[details({group_id:group.id,core:'55'}),details({group_id:filling.id,notes:'Chill first'}),details({group_id:''})];const before=structuredClone(v),copy=freshVariant(v);
 assert.deepEqual(copy.baking.map(s=>s.group_id),[copy.groups[0].id,copy.groups[1].id,'']);assert.deepEqual(copy.baking.map(savedValues),v.baking.map(savedValues));
 assert.ok(copy.baking.every((s,index)=>s.id!==v.baking[index].id));assert.deepEqual(v,before);
});

test('scaled recipe copies retain stage order, temperatures and time while scaling ingredient quantities',()=>{
 const {doc,v,group}=sample();v.baking=[details({group_id:group.id,actual_bottom:'158',core:'55',fan:'Low',batter_temperature:'23'}),details({name:'Browning',group_id:group.id,top:'180',minutes:'3'})];const before=structuredClone(doc),copy=scaledCopy(doc,v.id,'2'),result=copy.variants[0];
 assert.equal(result.groups[0].ingredients[0].quantity,'200');assert.deepEqual(result.baking.map(savedValues),v.baking.map(savedValues));assert.ok(result.baking.every(s=>s.group_id===result.groups[0].id));assert.deepEqual(doc,before);
});

test('component rename and reorder never reassign explicitly linked stages',()=>{
 const {v,group}=sample();const filling=addComponent(v,'Filling');v.baking=[details({group_id:group.id}),details({name:'Filling stage',group_id:filling.id})];v.groups.reverse();v.groups[0].name='Renamed filling';
 assert.equal(recipeSections(v).components[0].baking[0].stage.name,'Filling stage');assert.equal(recipeSections(v).components[1].baking[0].stage.name,'Initial bake');v.baking.reverse();assert.equal(bakingSections(v)[0].stage.name,'Filling stage');
});

test('saved baking links must refer to a component in the same size',()=>{
 const {doc,v,group}=sample();v.baking=[details({group_id:group.id})];assert.deepEqual(validateRecipe(doc),[]);
 v.baking[0].group_id='another-size-component';assert.match(validateRecipe(doc).join(' '),/existing component for this baking stage/);
 delete v.baking[0].group_id;assert.deepEqual(validateRecipe(doc),[]);v.baking[0].group_id='';assert.deepEqual(validateRecipe(doc),[]);
});

test('version differences identify changed component baking while the earlier version is unchanged',()=>{
 const {doc,v,group}=sample();v.baking=[details({group_id:group.id})];const earlier=structuredClone(doc),draft=structuredClone(doc);draft.variants[0].baking[0].minutes='12';
 assert.deepEqual(differences(earlier,draft),[{field:'variants.0.baking.0.minutes',before:'11',after:'12'}]);assert.deepEqual(doc,earlier);
});

test('reader omits empty stages and labels but includes zero, notes and legacy temperatures',()=>{
 assert.equal(hasBakingDetails({name:'Bake',top:' ',notes:'\n'}),false);assert.equal(bakingDetailsMarkup([{name:'Bake'}]),'');
 assert.equal(hasBakingDetails({top:0}),true);assert.equal(hasBakingDetails({notes:'Cool overnight'}),true);assert.equal(hasBakingDetails({temperature:'175'}),true);
 const html=bakingDetailsMarkup([{name:'Bake <example>',top:0,bottom:'160',minutes:'11',fan:' ',core:'55',notes:'Keep <safe>\nCool'},{name:'Legacy',temperature:'175'}]);
 assert.match(html,/Bake &lt;example&gt;/);assert.match(html,/<dd>0 <span>°C<\/span><\/dd>/);assert.match(html,/Keep &lt;safe&gt;\nCool/);assert.match(html,/Temperature/);assert.match(html,/175/);
 assert.doesNotMatch(html,/Fan setting|Ingredient temperature|checkbox/);assert.ok(html.indexOf('Bake &lt;example&gt;')<html.indexOf('Legacy'));assert.doesNotMatch(html,/Stage [12]/);
});

test('editor starts with four essential fields and only activates requested optional fields',()=>{
 resetBakingEditor();const {v,group}=sample();v.baking=[stage(group.id)];let html=bakingEditor(v,'variants.0',group.id,helpers);
 assert.equal((html.match(/data-path=/g)||[]).length,4);assert.doesNotMatch(html,/data-baking-field=/);assert.match(html,/>\+ Add Field</);
 setBakingFieldVisible(v.baking[0],'core',true);setBakingFieldVisible(v.baking[0],'core',true);html=bakingEditor(v,'variants.0',group.id,helpers);
 assert.equal((html.match(/data-baking-field="core"/g)||[]).length,1);assert.equal((html.match(/data-path=/g)||[]).length,5);assert.doesNotMatch(html,/data-action="add-baking-field"[^>]*data-field="core"/);
 setBakingFieldVisible(v.baking[0],'core',false);assert.doesNotMatch(bakingEditor(v,'variants.0',group.id,helpers),/data-baking-field="core"/);
});

test('existing optional fields cannot be silently hidden or erased by UI visibility',()=>{
 resetBakingEditor();const {v,group}=sample();v.baking=[details({group_id:group.id,core:0,temperature:'175',notes:'Saved notes'})];const before=structuredClone(v);
 setBakingFieldVisible(v.baking[0],'core',false);setBakingFieldVisible(v.baking[0],'notes',false);const html=bakingEditor(v,'variants.0',group.id,helpers);
 assert.match(html,/data-baking-field="core"/);assert.match(html,/data-baking-field="notes"/);assert.match(html,/data-baking-field="temperature"/);assert.equal(bakingFieldLabel('temperature'),'Temperature · °C');assert.deepEqual(v,before);
});

test('stage expansion survives rerenders and reorder, and resets for a new editing session',()=>{
 resetBakingEditor();const {v,group}=sample();v.baking=[details({id:'first',group_id:group.id}),details({id:'second',group_id:group.id})];bakingEditor(v,'variants.0',group.id,helpers);
 const key=`${v.id}:first`;rememberBakingEditor({querySelectorAll:()=>[{dataset:{bakingOpenKey:key},open:false}]},v);v.baking.reverse();let html=bakingEditor(v,'variants.0',group.id,helpers);
 assert.ok(!html.includes(`data-baking-open-key="${key}" open`));assert.ok(html.includes(`data-baking-open-key="${v.id}:second" open`));resetBakingEditor();html=bakingEditor(v,'variants.0',group.id,helpers);assert.ok(html.includes(`data-baking-open-key="${key}" open`));
});

test('rebuilding imported components preserves all baking instructions as an explicit review fallback',()=>{
 const {doc,v,group}=sample();doc.import_review={source_text:'Imported sample\nBatter\nFlour 100 g\nProcedure\n1. Mix it.\nFilling\nCream 50 g\nProcedure\n1. Whip it.',reviewed:true};
 v.baking=[details({group_id:group.id,core:'55'}),{id:'legacy',name:'Cool',temperature:'0',notes:'Keep chilled'},details({group_id:''})];
 const before=structuredClone(doc),result=rebuildImportedSections(doc),rebuilt=result.document.variants[0];
 assert.equal(rebuilt.groups.length,2);assert.deepEqual(rebuilt.baking.map(s=>s.id),v.baking.map(s=>s.id));assert.deepEqual(rebuilt.baking.map(savedValues),v.baking.map(savedValues));assert.deepEqual(rebuilt.baking.map(s=>s.group_id),['','','']);
 assert.equal(recipeSections(rebuilt).unassignedBaking.length,3);assert.equal(result.document.import_review.reviewed,false);assert.match(result.warnings.join(' '),/baking stages were preserved as unassigned/);assert.deepEqual(validateRecipe(result.document),[]);assert.deepEqual(doc,before);
});

test('rebuilding a single imported component never guesses that it owns old baking data',()=>{
 const {doc,v}=sample();doc.import_review={source_text:'Imported sample\nFlour 100 g\nProcedure\n1. Mix it.',reviewed:true};v.baking=[{id:'legacy',top:'165',minutes:'11'}];
 const rebuilt=rebuildImportedSections(doc).document.variants[0];assert.equal(rebuilt.groups.length,1);assert.equal(rebuilt.baking[0].group_id,'');assert.equal(recipeSections(rebuilt).unassignedBaking.length,1);
});

test('reset ignores expansion state from stale editor markup before the next render',()=>{
 const {v,group}=sample();v.baking=[details({id:'reopened',group_id:group.id})];const key=`${v.id}:reopened`;resetBakingEditor();
 rememberBakingEditor({querySelectorAll:()=>[{dataset:{bakingOpenKey:key},open:false}]},v);
 assert.ok(bakingEditor(v,'variants.0',group.id,helpers).includes(`data-baking-open-key="${key}" open`));
});

test('active empty optional controls survive a saved document clone but remain transient',()=>{
 resetBakingEditor();const {v,group}=sample();v.baking=[stage(group.id)];bakingEditor(v,'variants.0',group.id,helpers);setBakingFieldVisible(v.baking[0],'core',true);
 const saved=structuredClone(v),before=structuredClone(saved);assert.match(bakingEditor(saved,'variants.0',group.id,helpers),/data-baking-field="core"/);assert.deepEqual(saved,before);
 setBakingFieldVisible(saved.baking[0],'core',false);assert.doesNotMatch(bakingEditor(structuredClone(saved),'variants.0',group.id,helpers),/data-baking-field="core"/);
 resetBakingEditor();assert.doesNotMatch(bakingEditor(saved,'variants.0',group.id,helpers),/data-baking-field="core"/);
});

test('print puts each component baking after its procedure once and keeps legacy fallback visible',()=>{
 const {doc,v,group}=sample();const filling=addComponent(v,'Filling');filling.ingredients[0].name='Sample cream';filling.ingredients[0].quantity='50';v.methods[1].steps[0].instruction='Whip the sample filling.';
 v.baking=[details({name:'Batter oven stage',group_id:group.id,notes:'Batter-only note'}),details({name:'Filling cooling stage',group_id:filling.id,top:'',bottom:'',minutes:'',core:0,notes:'Filling-only note'}),{id:'legacy',name:'Old oven instructions',temperature:'175',notes:'Unassigned retained note'}];
 const record={id:'print-sample',version_id:'print-version',version:4,code:'SYNTHETIC',status:'draft',updated_at:'2026-10-20',document:doc},before=structuredClone(record);
 for(const layout of ['kitchen','presentation']){
  const html=printBook([record],{layout,process:true,packaging:true,showMetadata:false});
  const batterAt=html.indexOf('data-print-component="Batter"'),batterMethodAt=html.indexOf('Mix the sample.'),batterBakeAt=html.indexOf('Batter oven stage'),fillingAt=html.indexOf('data-print-component="Filling"'),fillingMethodAt=html.indexOf('Whip the sample filling.'),fillingBakeAt=html.indexOf('Filling cooling stage'),legacyAt=html.indexOf('Unassigned baking instructions');
  assert.ok(batterAt<batterMethodAt&&batterMethodAt<batterBakeAt&&batterBakeAt<fillingAt);assert.ok(fillingAt<fillingMethodAt&&fillingMethodAt<fillingBakeAt&&fillingBakeAt<legacyAt);
  for(const marker of ['Batter oven stage','Batter-only note','Filling cooling stage','Filling-only note','Old oven instructions','Unassigned retained note'])assert.equal(html.split(marker).length-1,1,marker);
  assert.match(html,/<dt>Core temperature<\/dt><dd>0 <span>°C<\/span><\/dd>/);assert.match(html,/<dt>Temperature<\/dt><dd>175 <span>°C<\/span><\/dd>/);assert.doesNotMatch(html,/SYNTHETIC|Version 4|Fan setting/);
 }
 assert.deepEqual(record,before);
});

test('production print scaling changes ingredients while retaining component baking and notes',async()=>{
 const {doc,v,group}=sample();v.baking=[details({name:'Constant oven stage',group_id:group.id,notes:'Keep the same temperature and time',core:0})];const record={id:'print-sample',version_id:'print-version',version:1,code:'SYNTHETIC',status:'draft',updated_at:'2026-10-20',document:doc,links:[]},before=structuredClone(record);
 const prepared=await preparePrintRecords([record],{production:{variant_id:v.id,factor:'3',mode:'multiplier'},kitchen:true,api:()=>{throw Error('No external recipes are needed.');}});
 assert.equal(prepared.length,1);const scaled=prepared[0].document.variants[0];assert.equal(scaled.groups[0].ingredients[0].quantity,'300');assert.deepEqual(scaled.baking,v.baking);
 const html=printBook(prepared,{layout:'kitchen',process:true,packaging:true,showMetadata:false});assert.equal(html.split('Constant oven stage').length-1,1);assert.match(html,/<dd>165 <span>°C/);assert.match(html,/<dd>160 <span>°C/);assert.match(html,/<dd>11 <span>minutes/);assert.match(html,/Keep the same temperature and time/);assert.deepEqual(record,before);
});
