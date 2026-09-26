import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {emptyClass,photoRef} from '../../assets/ordering/academy-model.js';
export default async function({db,check,state}){
 const {ids}=state.harness;
 const api=async(action,payload={},user=ids.owner)=>db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);return (await tx.query('select public.academy_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;});
 const assetId=randomUUID(),replacement=randomUUID(),id=randomUUID(),doc=emptyClass('Sample Academy class');let row;
 await check('Academy starts with three private drafts and only the owner may manage or preview',async()=>{
  const data=await api('admin');assert.equal(data.classes.length,3);assert.equal(data.classes.find(c=>c.draft.slug==='2nd-summer-baking-camp').draft.student_total,102);
  assert.ok(data.classes.every(c=>c.draft.allow_photo_placeholders===true));
  assert.deepEqual(data.classes.map(c=>c.draft.category_label).sort(),['Baking camp','Baking class','Decorating class']);
  assert.equal((await api('catalog',{},null)).classes.length,0);assert.deepEqual((await api('catalog',{},null)).settings,{});
  for(const user of [null,ids.customer,ids.staff])for(const action of ['admin','preview','save_class','publish_class','delete_class'])await assert.rejects(api(action,{id},user),/owner|Owner|Sign in|permission|staff/i);
 })();
 await check('Academy placeholder publishing requires explicit boolean opt-in and preserves private draft changes',async()=>{
  const placeholderId=randomUUID(),placeholder=emptyClass('Approved placeholder class');
  assert.equal(placeholder.allow_photo_placeholders,false);
  let saved=await api('save_class',{id:placeholderId,revision:0,content:placeholder});
  await assert.rejects(api('publish_class',{id:placeholderId,revision:saved.revision}),/thumbnail and hero/);
  for(const invalid of ['true','false',1,0,null,{},[]])await assert.rejects(api('save_class',{id:placeholderId,revision:saved.revision,content:{...placeholder,allow_photo_placeholders:invalid}}),/Photo placeholders/);
  placeholder.allow_photo_placeholders=true;
  saved=await api('save_class',{id:placeholderId,revision:saved.revision,content:placeholder});
  assert.equal((await api('class',{slug:placeholder.slug},null)).content,null);
  saved=await api('publish_class',{id:placeholderId,revision:saved.revision});
  const published=(await api('class',{slug:placeholder.slug},null)).content;
  assert.equal(published.allow_photo_placeholders,true);assert.equal(published.hero,null);assert.equal(published.thumbnail,null);
  assert.equal((await api('catalog',{},null)).classes.find(c=>c.id===placeholderId).content.allow_photo_placeholders,true);
  saved=await api('save_class',{id:placeholderId,revision:saved.revision,content:{...placeholder,allow_photo_placeholders:false,description:'Private placeholder draft'}});
  assert.equal((await api('preview',{id:placeholderId})).content.allow_photo_placeholders,false);
  assert.deepEqual((await api('class',{slug:placeholder.slug},null)).content,published);
  assert.equal((await api('catalog',{},null)).classes.find(c=>c.id===placeholderId).content.description,'');
  await assert.rejects(api('publish_class',{id:placeholderId,revision:saved.revision}),/thumbnail and hero/);
  assert.deepEqual((await api('class',{slug:placeholder.slug},null)).content,published);
  await api('delete_class',{id:placeholderId,revision:saved.revision});
 })();
 await check('Academy uploads are owner-only and unpublished media is private',async()=>{
  await db.exec('grant select,insert on storage.objects to authenticated;');
  for(const user of [ids.customer,ids.staff])await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await tx.exec('set local role authenticated');await tx.query("insert into storage.objects(bucket_id,name,owner) values('academy-photos',$1,$2)",[assetId+'.webp',user]);}),/policy|permission/i);
  for(const aid of [assetId,replacement]){
   await db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.owner]);await tx.exec('set local role authenticated');await tx.query("insert into storage.objects(bucket_id,name,owner) values('academy-photos',$1,$2)",[aid+'.webp',ids.owner]);});
   await api('register_asset',{id:aid,name:'sample.png',width:800,height:600});
  }
  assert.equal((await api('assets',{ids:[assetId]},null)).length,0);assert.equal((await api('assets',{ids:[assetId]},ids.staff)).length,0);assert.equal((await api('assets',{ids:[assetId]})).length,1);
 })();
 await check('Academy draft, publish, edit, republish and unpublish preserve correct snapshots and media access',async()=>{
  row=await api('save_class',{id,revision:0,content:doc});await assert.rejects(api('publish_class',{id,revision:row.revision}),/thumbnail and hero/);
  doc.hero=photoRef(assetId);doc.thumbnail=photoRef(assetId);doc.description='Published description';const batch=randomUUID();doc.batches=[{id:batch,label:'Sample session',description:'',photos:[photoRef(assetId)],cover:photoRef(assetId),start_date:'',end_date:'',student_count:null}];doc.creations=[{id:randomUUID(),name:'Sample creation',description:'',photos:[{...photoRef(assetId),batch_id:batch}]}];
  row=await api('save_class',{id,revision:row.revision,content:doc});await assert.rejects(api('save_class',{id,revision:row.revision-1,content:doc}),/changed/);
  row=await api('publish_class',{id,revision:row.revision});assert.equal((await api('class',{slug:doc.slug},null)).content.description,'Published description');assert.equal((await api('assets',{ids:[assetId]},null)).length,1);
  doc.description='Private new description';doc.hero=photoRef(replacement);row=await api('save_class',{id,revision:row.revision,content:doc});assert.equal((await api('class',{slug:doc.slug},null)).content.description,'Published description');assert.equal((await api('assets',{ids:[replacement]},null)).length,0);
  await assert.rejects(api('save_class',{id,revision:row.revision,content:{...doc,slug:'changed-url'}}),/URLs stay fixed/);
  row=await api('publish_class',{id,revision:row.revision});assert.equal((await api('class',{slug:doc.slug},null)).content.description,'Private new description');assert.equal((await api('assets',{ids:[replacement]},null)).length,1);
  row=await api('unpublish_class',{id,revision:row.revision});assert.equal((await api('class',{slug:doc.slug},null)).content,null);assert.equal((await api('assets',{ids:[replacement,assetId]},null)).length,0);
 })();
 await check('Academy rejects unsafe embeds, missing media and invalid focal positions; landing changes stay drafts',async()=>{
  await assert.rejects(api('save_class',{id,revision:row.revision,content:{...doc,videos:[{id:randomUUID(),url:'https://evil.test/embed',batch_id:''}]}}),/Instagram/);
  await assert.rejects(api('save_class',{id,revision:row.revision,content:{...doc,hero:{...doc.hero,focal_x:120}}}),/focal/);
  await assert.rejects(api('save_class',{id,revision:row.revision,content:{...doc,hero:photoRef(randomUUID())}}),/uploaded/);
  const data=await api('admin');let cfg=await api('save_settings',{revision:data.settings.revision,content:{...data.settings.draft,heading:'Draft heading',featured_id:id,class_order:[id]}});assert.deepEqual((await api('catalog',{},null)).settings,{});cfg=await api('publish_settings',{revision:cfg.revision});assert.equal((await api('catalog',{},null)).settings.heading,'Draft heading');
  await api('delete_class',{id,revision:row.revision});assert.equal((await api('admin')).classes.some(c=>c.id===id),false);
 })();
}
