import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export default async function({db,check,state}) {
  const h=state.harness;
  for(const kind of ['party','dessert']) {
    const endpoint=kind==='party'?'party_packages_api':'dessert_bar_packages_api';
    const api=(action,payload={},user=h.ids.owner)=>h.as(user,async()=>(await db.query(`select public.${endpoint}($1,$2::jsonb) result`,[action,JSON.stringify(payload)])).rows[0].result);
    let before=await api('admin_list');
    const cats=[{id:randomUUID(),name:'50 pax'},{id:randomUUID(),name:'100 pax'},{id:randomUUID(),name:'Private draft category'}];
    await check(`${kind} categories: unauthorized and invalid saves leave all content unchanged`,async()=>{
      for(const user of [null,h.ids.customer,h.ids.staff,h.ids.unverified]) await assert.rejects(api('save_categories',{categories:cats,expected:before.categories},user),/verified|owner/i);
      const table=kind==='party'?'party_package_categories':'dessert_bar_package_categories';
      await assert.rejects(h.as(h.ids.owner,()=>db.query(`select * from tlb.${table}`)),/permission denied/);
      await assert.rejects(h.as(h.ids.owner,()=>db.query("select tlb.save_package_categories($1,'{}')",[kind])),/permission denied/);
      for(const categories of [null,{},[{id:randomUUID(),name:''}],[cats[0],{id:randomUUID(),name:' 50 PAX '}],[cats[0],{...cats[0],name:'Repeated ID'}],[{id:'invalid',name:'A'}],Array.from({length:31},(_,i)=>({id:randomUUID(),name:String(i)}))]) await assert.rejects(api('save_categories',{categories,expected:before.categories}));
      assert.deepEqual(await api('admin_list'),before);
    })();
    let first,second;
    await check(`${kind} categories: new categories, assignment and public visibility`,async()=>{
      await api('save_categories',{categories:cats,expected:before.categories});
      const fixture={id:randomUUID(),revision:0,name:'Categorized party',subtitle:'Custom capacity',price_cents:900000,badge:'',features:[{label:'All details stay visible',detail:'Vanilla & chocolate'}],published:true,sort_order:5,category_id:cats[0].id};
      first=await api('save',{package:fixture,operation_id:randomUUID()});
      second=await api('save',{package:{...fixture,id:randomUUID(),category_id:cats[2].id,published:false},operation_id:randomUUID()});
      const publicResult=await api('browse',{},null);
      assert.deepEqual(publicResult.categories,[cats[0]]);
      assert.equal(publicResult.items.find(p=>p.id===first.id).category_id,cats[0].id);
      assert(!publicResult.items.some(p=>p.id===second.id));
      await assert.rejects(api('save',{package:{...first,category_id:randomUUID()},operation_id:randomUUID()}),/category/i);
      const other=kind==='party'?'dessert_bar_package_categories':'party_package_categories';
      const foreign=(await db.query(`select id from tlb.${other} limit 1`)).rows[0];
      if(foreign)await assert.rejects(api('save',{package:{...first,category_id:foreign.id},operation_id:randomUUID()}),/category/i);
    })();
    await check(`${kind} categories: renaming and rearranging keep package membership and retry safely`,async()=>{
      const wanted=[cats[2],cats[1],{...cats[0],name:'Small celebrations'}];
      before=await api('admin_list');
      const saved=await api('save_categories',{categories:wanted,expected:cats});
      assert.deepEqual(saved.categories,wanted);
      assert.deepEqual(saved.items,before.items);
      assert.deepEqual(await api('save_categories',{categories:wanted,expected:cats}),saved);
      await assert.rejects(api('save_categories',{categories:cats,expected:cats}),/changed.*refresh/i);
      assert.deepEqual((await api('browse',{},null)).categories,[wanted[2]]);
    })();
    await check(`${kind} categories: removing a category preserves packages and rejects stale membership`,async()=>{
      before=await api('admin_list');
      const saved=await api('save_categories',{categories:before.categories.filter(c=>c.id!==cats[0].id),expected:before.categories});
      const next=saved.items.find(p=>p.id===first.id);
      assert.equal(next.category_id,null);assert.equal(next.revision,first.revision+1);
      for(const key of ['price_cents','name','features','published','sort_order'])assert.deepEqual(next[key],first[key]);
      assert.equal(saved.items.length,before.items.length);
      await assert.rejects(api('save',{package:first,operation_id:randomUUID()}),/category/i);
      const olderClient={...second};delete olderClient.category_id;
      const updated=await api('save',{package:olderClient,operation_id:randomUUID()});assert.equal(updated.category_id,cats[2].id);
      const unassigned=await api('save',{package:{...updated,category_id:null},operation_id:randomUUID()});assert.equal(unassigned.category_id,null);
      assert.deepEqual((await api('browse',{},null)).categories,[]);
    })();
  }
}
