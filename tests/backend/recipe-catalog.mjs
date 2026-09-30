import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
export default async function({db,check}){
 const h=await makeHarness(db),{owner,staff,customer,stranger}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 await api('save_access',{user_id:staff,permission:'chef'});await api('save_access',{user_id:customer,permission:'kitchen'});
 const get=async(id,kind,deleted=false)=>(await api('resources',{kind,deleted,include_inactive:true})).rows.find(r=>r.id===id);
 const supplier=await api('save_resource',{kind:'supplier',name:'Preferred shop',data:{}}),alternative=await api('save_resource',{kind:'supplier',name:'Other shop',data:{}});
 const ingredient=await api('save_resource',{kind:'ingredient',name:'Catalog flour',data:{default_unit:'g',preferred_supplier_id:supplier.id},suppliers:[{supplier_id:supplier.id,price:{amount:'60',quantity:'1000',unit:'g'}},{supplier_id:alternative.id,price:{amount:'90',quantity:'1000',unit:'g'}}]});
 const recipe=await api('create',{status:'production',document:{name:'Catalog history cookie',variants:[{id:'base',name:'Standard',yield:{quantity:'10',unit:'cookies'},groups:[{id:'mix',name:'Mix',ingredients:[{id:'flour',ingredient_id:ingredient.id,name:'Flour',quantity:'100',unit:'g'}]}],methods:[{name:'Mix',steps:[{id:'mix',instruction:'Mix.'}]}]}]}});
 const versionBefore=await api('get',{id:recipe.id});
 await check('only the owner can delete, restore or list deleted catalog records',async()=>{
  for(const user of [null,stranger,staff,customer])for(const action of ['delete_resource','restore_resource','delete_category','restore_category'])await assert.rejects(()=>api(action,{id:ingredient.id,revision:1},user),/permission denied|Authorized recipe|owner|editing/i);
  for(const user of [staff,customer])await assert.rejects(()=>api('resources',{kind:'ingredient',deleted:true},user),/owner|editing/i);
  await assert.rejects(()=>h.as(staff,()=>db.query("select tlb.recipe_api_before_catalog_deletion('delete_resource','{}')")),/permission denied/);
 })();
 await check('delete and restore each resource kind without losing records or historical quotes',async()=>{
  for(const kind of ['ingredient','supplier','equipment','packaging']){
   const item=await api('save_resource',{kind,name:'Delete '+kind,data:{notes:'Keep details',photos:kind==='packaging'?[]:undefined},...(kind==='packaging'?{price:{amount:'200',quantity:'10',unit:'pc'}}:{})});
   await assert.rejects(()=>api('delete_resource',{id:item.id,revision:0}),/changed/);
   await api('delete_resource',{id:item.id,revision:item.revision});assert.equal(await get(item.id,kind),undefined);
   const deleted=await get(item.id,kind,true);assert.ok(deleted.deleted_at);assert.equal(deleted.data.notes,'Keep details');
   await assert.rejects(()=>api('save_resource',{...item,name:'Stale change'}),/deleted/);
   await assert.rejects(()=>api('restore_resource',{id:item.id,revision:item.revision}),/changed/);
   await api('restore_resource',{id:item.id,revision:deleted.revision});assert.equal((await get(item.id,kind)).data.notes,'Keep details');
   if(kind==='packaging')assert.equal((await api('prices',{id:item.id})).length,1);
  }
 })();
 await check('deleting preferred supplier falls back for new costing and preserves production snapshots',async()=>{
  await api('delete_resource',{id:supplier.id,revision:supplier.revision});
  const row=await get(ingredient.id,'ingredient');assert.equal(row.price.supplier_id,alternative.id);assert.equal(row.suppliers.length,1);
  assert.deepEqual(await api('get',{id:recipe.id}),versionBefore);
  assert.equal((await api('prices',{id:ingredient.id})).length,2);
  await assert.rejects(()=>api('save_resource',{kind:'packaging',name:'Bad supplier',data:{supplier_id:supplier.id}}),/Supplier not found or deleted/);
  const deleted=await get(supplier.id,'supplier',true);await api('restore_resource',{id:supplier.id,revision:deleted.revision});assert.equal((await get(ingredient.id,'ingredient')).price.supplier_id,supplier.id);
 })();
 await check('deleted ingredients remain readable in existing production versions',async()=>{
  const item=await get(ingredient.id,'ingredient');await api('delete_resource',{id:item.id,revision:item.revision});
  assert.deepEqual(await api('get',{id:recipe.id}),versionBefore);
  await assert.rejects(()=>api('record_purchase',{request_id:randomUUID(),resource_id:item.id,kind:'ingredient',name:item.name,supplier_name:'Preferred shop',amount:'10',quantity:'100',unit:'g'}),/deleted/);
  await api('record_purchase',{request_id:randomUUID(),kind:'ingredient',name:item.name,supplier_name:'Preferred shop',amount:'10',quantity:'100',unit:'g'});
  const rows=(await api('resources',{kind:'ingredient',query:item.name})).rows;assert.equal(rows.length,1);assert.notEqual(rows[0].id,item.id);
 })();
 await check('category deletion preserves references and enforces parent/child restoration order',async()=>{
  const parent=await api('save_category',{name:'Delete category'}),child=await api('save_category',{name:'Child category',parent_id:parent.id});
  const cats=async()=> (await api('bootstrap')).categories;
  await assert.rejects(()=>api('delete_category',{id:parent.id,revision:1}),/subcategories/);
  await api('delete_category',{id:child.id,revision:1});await api('delete_category',{id:parent.id,revision:1});
  await assert.rejects(()=>api('save_category',{id:parent.id,name:'Stale category'}),/deleted/);
  await assert.rejects(()=>api('save_category',{name:'New child',parent_id:parent.id}),/available parent/);
  await assert.rejects(()=>api('restore_category',{id:child.id,revision:2}),/parent category/);
  await api('restore_category',{id:parent.id,revision:2});await api('restore_category',{id:child.id,revision:2});
  const saved=(await cats()).find(c=>c.id===child.id);assert.equal(saved.deleted_at,null);assert.equal(saved.parent_id,parent.id);
  await api('save_category',{id:child.id,revision:saved.revision,name:'Edited child',parent_id:parent.id});
  await assert.rejects(()=>api('delete_category',{id:child.id,revision:saved.revision}),/changed/);
 })();
 await check('deletion applies before pagination and is retained in the audit trail',async()=>{
  const hidden=await api('save_resource',{kind:'equipment',name:'AAA deleted',data:{}});await api('delete_resource',{id:hidden.id,revision:hidden.revision});
  const first=(await api('resources',{kind:'equipment',limit:1,include_inactive:true})).rows;assert.equal(first.length,1);assert.notEqual(first[0].id,hidden.id);
  assert.ok(await h.scalar("select count(*)::int from tlb.recipe_audit where action='resource_deleted' and details->>'resource_id'=$1",[hidden.id]));
 })();
}
