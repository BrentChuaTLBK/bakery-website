import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
 const h=state.harness;
 for(const kind of ['party','dessert']) {
  const functionName=kind==='party'?'party_packages_api':'dessert_bar_packages_api';
  const api=(action,payload={},user=h.ids.owner)=>h.as(user,async()=>(await db.query(`select public.${functionName}($1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result);
  const fixture={id:randomUUID(),revision:0,name:'Ordering fixture',subtitle:'Keep details',price_cents:543210,badge:'New',features:[{label:'Flavor choice',detail:'Chocolate & vanilla'}],published:false,sort_order:900};
  await api('save',{package:fixture,operation_id:randomUUID()});
  await api('save',{package:{...fixture,id:randomUUID(),name:'Second ordering fixture',published:true,sort_order:901},operation_id:randomUUID()});
  let before=await api('admin_list'),snapshot=before.items.map(p=>({id:p.id,revision:p.revision})),wanted=before.items.map(p=>p.id).reverse();
  await check(`${kind} package ordering: only verified owners may reorder`,async()=>{
   for(const user of [null,h.ids.customer,h.ids.staff,h.ids.unverified])await assert.rejects(api('reorder',{ids:wanted,expected:snapshot},user),/verified|owner/i);
   assert.deepEqual(await api('admin_list'),before);
  })();
  await check(`${kind} package ordering: incomplete, repeated and foreign IDs cannot partially save`,async()=>{
   for(const ids of [[],wanted.slice(1),[...wanted,wanted[0]],[...wanted.slice(1),randomUUID()],{},[null]])await assert.rejects(api('reorder',{ids,expected:snapshot}));
   assert.deepEqual(await api('admin_list'),before);
  })();
  await check(`${kind} package ordering: preserves package details, hidden rows and public ordering`,async()=>{
   const result=await api('reorder',{ids:wanted,expected:snapshot});assert.deepEqual(result.items.map(p=>p.id),wanted);
   for(const [i,p] of result.items.entries()){const old=before.items.find(x=>x.id===p.id);assert.equal(p.sort_order,i+1);for(const key of ['name','subtitle','price_cents','features','badge','published'])assert.deepEqual(p[key],old[key]);}
   assert.deepEqual((await api('browse',{},null)).items.map(p=>p.id),result.items.filter(p=>p.published).map(p=>p.id));
   assert.deepEqual(await api('reorder',{ids:wanted,expected:snapshot}),result,'Lost-response retry changes no revisions');
  })();
  await check(`${kind} package ordering: concurrent content edits and new packages invalidate stale moves`,async()=>{
   before=await api('admin_list');snapshot=before.items.map(p=>({id:p.id,revision:p.revision}));wanted=before.items.map(p=>p.id).reverse();
   await api('save',{package:{...before.items[0],name:'Newer content'},operation_id:randomUUID()});
   const changed=await api('admin_list');await assert.rejects(api('reorder',{ids:wanted,expected:snapshot}),/changed.*refresh/i);assert.deepEqual(await api('admin_list'),changed);
   await api('save',{package:{...fixture,id:randomUUID(),revision:0,name:'Added in another window'},operation_id:randomUUID()});
   await assert.rejects(api('reorder',{ids:wanted,expected:changed.items.map(p=>({id:p.id,revision:p.revision}))}),/changed.*refresh/i);
  })();
 }
}
