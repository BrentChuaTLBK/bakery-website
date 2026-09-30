import assert from 'node:assert/strict';
import {blankRecipe} from '../../assets/ordering/recipe-model.js';
import {addRecipePackaging} from '../../assets/ordering/recipe-packaging.js';
export default async function({db,check,state}){
 const h=state.recipeHarness,{owner,customer}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 let packaging,saved;
 await check('linked packaging costs are captured while kitchen references exclude every pricing field',async()=>{
  packaging=await api('save_resource',{kind:'packaging',name:'QA linked cake box',data:{default_unit:'pc',dimensions:'10 × 10 inches'},price:{amount:'300',quantity:'10',unit:'pc'}});
  const d=blankRecipe();d.name='QA packaging reference';d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'1',unit:'g',cost_snapshot:{amount:'0',quantity:'1',unit:'g'}}];d.variants[0].methods[0].steps[0].instruction='Mix.';addRecipePackaging(d.variants[0],packaging);d.variants[0].additional_costs[0].quantity='2';d.variants[0].additional_costs.push({name:'Private manual charge',amount:'5'});d.variants[0].packaging.items=[{resource_name:'Untrusted derived value',amount:'999',supplier_id:'PRIVATE'}];
  saved=await api('create',{document:d,status:'production'});assert.equal(Number(saved.cost_snapshot.variants[0].total),65);
  const kitchen=await api('get',{id:saved.id},customer),v=kitchen.document.variants[0];assert.equal(v.packaging.items.length,1);assert.equal(v.packaging.items[0].resource_name,packaging.name);assert.equal(v.packaging.items[0].quantity,'2');assert.equal(v.additional_costs,undefined);assert.equal(v.packaging.items[0].cost_snapshot,undefined);assert.equal(v.packaging.items[0].amount,undefined);assert.doesNotMatch(JSON.stringify(v),/Untrusted derived|Private manual|supplier_id|cost_snapshot/);
 })();
 await check('packaging price updates affect a new draft while approved packaging and costs stay historical',async()=>{
  await api('save_resource',{id:packaging.id,revision:packaging.revision,kind:'packaging',name:packaging.name,data:packaging.data,price:{amount:'400',quantity:'10',unit:'pc'}});
  const next=await api('save',{id:saved.id,revision:saved.revision,document:saved.document,status:'draft'});assert.equal(Number(next.cost_snapshot.variants[0].total),85);assert.equal(Number((await api('get',{id:saved.id,version_id:saved.version_id})).cost_snapshot.variants[0].total),65);assert.equal((await api('get',{id:saved.id},customer)).version_id,saved.version_id);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.recipe_kitchen_document(jsonb)','execute')"),false);
 })();
 const upload=async name=>{const file=await api('reserve_file',{filename:name,mime_type:'image/png',size_bytes:100,sha256:'a'.repeat(64)});await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:100,mimetype:'image/png'})]);await api('confirm_file',{id:file.id});return file;};
 const access=(file,user=customer,write=false)=>h.as(user,async()=>(await db.query('select public.recipe_file_access($1,$2) allowed',[file.path,write])).rows[0].allowed);
 let catalogPhoto,customPhoto,nextPhoto,photoResource,withPhotos;
 await check('packaging photos are taken from the catalog, linked to the recipe, and available only to authorized kitchen viewers',async()=>{
  catalogPhoto=await upload('catalog-box.png');customPhoto=await upload('custom-product-box.png');nextPhoto=await upload('unrelated-photo.png');
  photoResource=await api('save_resource',{kind:'packaging',name:'QA photographed box',data:{type:'Cake box',dimensions:'12 inches',notes:'Store flat',default_unit:'pc',photos:[{file_id:catalogPhoto.id,caption:'Catalog box'}]},price:{amount:'40',quantity:'1',unit:'pc'}});
  const d=blankRecipe();d.name='QA inherited packaging photos';d.variants[0].groups[0].ingredients=[{id:'flour',name:'Flour',quantity:'1',unit:'g'}];d.variants[0].methods[0].steps[0].instruction='Mix.';addRecipePackaging(d.variants[0],photoResource);
  d.variants[0].additional_costs[0].resource_photos=[{file_id:nextPhoto.id,path:'FORGED',caption:'FORGED'}];d.files=[{...catalogPhoto,visibility:'private'}];
  withPhotos=await api('create',{document:d,status:'production'});const item=withPhotos.document.variants[0].additional_costs[0];assert.equal(item.resource_photos[0].file_id,catalogPhoto.id);assert.equal(item.resource_type,'Cake box');assert.equal(item.resource_notes,'Store flat');assert.equal(withPhotos.files.find(f=>f.id===catalogPhoto.id).visibility,'kitchen');
  const kitchen=await api('get',{id:withPhotos.id},customer);assert.equal(kitchen.files[0].id,catalogPhoto.id);assert.deepEqual(Object.keys(kitchen.document.variants[0].packaging.items[0].resource_photos[0]).sort(),['caption','file_id']);assert.doesNotMatch(JSON.stringify(kitchen.document),/FORGED|supplier_id|cost_snapshot|recorded_at/);
  assert.equal(await access(catalogPhoto),true);assert.equal(await access(nextPhoto),false);assert.equal(await access(catalogPhoto,customer,true),false);await assert.rejects(()=>access(catalogPhoto,null),/permission denied/);
 })();
 await check('a recipe photo override and catalog changes preserve approved photos, prices, and other packaging records',async()=>{
  const d=structuredClone(withPhotos.document);d.variants[0].packaging.photos=[{file_id:customPhoto.id,caption:'Finished product in box'}];d.files.push({...customPhoto,visibility:'kitchen'});
  photoResource=await api('save_resource',{id:photoResource.id,revision:photoResource.revision,kind:'packaging',name:'QA revised box',data:{...photoResource.data,dimensions:'14 inches',photos:[{file_id:nextPhoto.id,caption:'New catalog box'}]}});
  const draft=await api('save',{id:withPhotos.id,revision:withPhotos.revision,document:d,status:'draft'});assert.equal(draft.document.variants[0].additional_costs[0].resource_photos[0].file_id,nextPhoto.id);assert.equal(draft.document.variants[0].packaging.photos[0].file_id,customPhoto.id);
  const old=await api('get',{id:withPhotos.id,version_id:withPhotos.version_id});assert.equal(old.document.variants[0].additional_costs[0].resource_name,'QA photographed box');assert.equal(old.document.variants[0].additional_costs[0].resource_photos[0].file_id,catalogPhoto.id);assert.deepEqual(old.cost_snapshot,withPhotos.cost_snapshot);assert.equal((await api('get',{id:withPhotos.id},customer)).version_id,withPhotos.version_id);
  assert.equal(await access(customPhoto),false);assert.equal(await access(nextPhoto),false);assert.equal(await access(catalogPhoto),true);
  const resource=(await api('resources',{kind:'packaging',query:'QA revised box'})).rows[0];assert.equal(resource.data.photos[0].file_id,nextPhoto.id);assert.notEqual(resource.data.photos[0].file_id,customPhoto.id);
  const published=await api('save',{id:draft.id,revision:draft.revision,document:draft.document,status:'production'});assert.equal((await api('get',{id:published.id},customer)).document.variants[0].packaging.photos[0].file_id,customPhoto.id);assert.equal(await access(customPhoto),true);
 })();
 await check('older linked recipes inherit packaging photos without rewriting their stored versions or exposing unrelated files',async()=>{
  const legacyPhoto=await upload('legacy-catalog.png'),legacyResource=await api('save_resource',{kind:'packaging',name:'QA legacy photographed box',data:{default_unit:'pc',photos:[{file_id:legacyPhoto.id,caption:'Legacy catalog'}]}});
  const d=structuredClone(withPhotos.document);d.name='QA legacy packaging link';d.files=[];d.variants[0].additional_costs=[];addRecipePackaging(d.variants[0],legacyResource);const old=await api('create',{document:d,status:'production'});
  const legacy=structuredClone(old.document);delete legacy.variants[0].additional_costs[0].resource_photos;legacy.files=[];
  const legacyVersion=(await db.query("insert into tlb.recipe_versions(recipe_id,number,status,document,cost_snapshot,created_by) values($1,2,'production',$2::jsonb,$3::jsonb,$4) returning id",[old.id,JSON.stringify(legacy),JSON.stringify(old.cost_snapshot),owner])).rows[0].id;
  await db.query('update tlb.recipes set current_version_id=$1,production_version_id=$1 where id=$2',[legacyVersion,old.id]);
  const kitchen=await api('get',{id:old.id},customer);assert.equal(kitchen.document.variants[0].packaging.items[0].resource_photos[0].file_id,legacyPhoto.id);assert.equal(kitchen.files[0].id,legacyPhoto.id);assert.equal(await access(legacyPhoto),true);
  assert.deepEqual((await db.query('select document from tlb.recipe_versions where id=$1',[legacyVersion])).rows[0].document,legacy);
  assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.recipe_packaging_document(jsonb,boolean)','execute')"),false);
 })();
}
