import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyClass,photoRef} from '../../assets/ordering/academy-model.js';
export default async function({db,check,state}){
 const {ids}=state.harness,id=randomUUID(),asset=randomUUID();let row;
 const api=async(action,payload={},user=ids.owner)=>db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);return (await tx.query('select public.academy_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;});
 await db.query("insert into storage.objects(bucket_id,name,owner) values('academy-photos',$1,$2)",[asset+'.webp',ids.owner]);
 await api('register_asset',{id:asset,name:'album-capacity.webp',width:800,height:600});
 const doc={...emptyClass('Large camp album'),allow_photo_placeholders:true,batches:[{id:randomUUID(),label:'Batch 1',description:'Keep this batch description',start_date:'2026-05-01',end_date:'2026-05-03',student_count:102,cover:null,photos:Array.from({length:552},()=>photoRef(asset))}]};
 await check('Academy saves a 552-photo batch as a private draft without changing published class content',async()=>{
  row=await api('save_class',{id,revision:0,content:{...doc,batches:[]}});row=await api('publish_class',{id,revision:row.revision});
  row=await api('save_class',{id,revision:row.revision,content:doc});assert.equal(row.draft.batches[0].photos.length,552);assert.equal(row.published.batches.length,0);
  assert.equal((await api('class',{slug:doc.slug},null)).content.batches.length,0);assert.equal((await api('assets',{ids:[asset]},null)).length,0);
  assert.equal(row.draft.batches[0].description,doc.batches[0].description);assert.equal(row.draft.batches[0].student_count,102);
 })();
 await check('Academy accepts 2,000 photos per batch or creation and rejects 2,001 without losing the draft',async()=>{
  const photos=Array.from({length:2000},()=>photoRef(asset));const large={...doc,batches:[{...doc.batches[0],photos}],creations:[{id:randomUUID(),name:'Student creations',description:'',photos}]};
  row=await api('save_class',{id,revision:row.revision,content:large});assert.equal(row.draft.batches[0].photos.length,2000);assert.equal(row.draft.creations[0].photos.length,2000);
  for(const section of ['batches','creations']){const oversized=structuredClone(large);oversized[section][0].photos.push(photoRef(asset));await assert.rejects(api('save_class',{id,revision:row.revision,content:oversized}),/up to 2,000 photos/);}
  assert.deepEqual((await api('preview',{id})).content,{...row.draft,id});
 })();
 await check('Academy separates invalid photo lists from capacity errors and retains the total class size limit',async()=>{
  for(const section of ['batches','creations'])for(const value of [null,{},'photos',undefined]){
   const invalid=structuredClone(row.draft);if(value===undefined)delete invalid[section][0].photos;else invalid[section][0].photos=value;
   await assert.rejects(api('save_class',{id,revision:row.revision,content:invalid}),/Album photos must be a list/);
  }
  const oversized=structuredClone(row.draft);for(const photo of oversized.batches[0].photos)photo.caption='a'.repeat(1000);
  await assert.rejects(api('save_class',{id,revision:row.revision,content:oversized}),/under 2 MB/);
  await assert.rejects(api('save_class',{id,revision:row.revision,content:doc},ids.staff),/owner|Owner|permission/);
  await api('delete_class',{id,revision:row.revision});
 })();
}
