import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makeHarness} from './helpers.mjs';
export default async function({db,check}){
 const h=await makeHarness(db),{owner,customer,unverified,staff,stranger}=h.ids;
 const api=(action,payload={},user=owner)=>h.as(user,async()=>(await db.query('select public.recipe_api($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result);
 let invitation;
 await check('only an owner can invite accounts and owner privileges cannot be overwritten',async()=>{
  for(const user of [null,customer,staff])await assert.rejects(()=>api('invite_access',{email:'new@example.test',permission:'kitchen'},user),/permission denied|owner|Authorized recipe/i);
  await assert.rejects(()=>api('invite_access',{email:'owner@example.test',permission:'kitchen'}),/owner access/);
  await assert.rejects(()=>api('invite_access',{email:'new@example.test',permission:'owner'}),/Chef or Kitchen/);
  await assert.rejects(()=>api('invite_access',{email:'bad\naddress',permission:'kitchen'}),/valid email/);
 })();
 await check('a verified recipe-only account receives access without shop administration privileges',async()=>{
  const result=await api('invite_access',{email:' CUSTOMER@example.test ',permission:'chef'});assert.equal(result.pending,false);assert.equal(result.email_status,'pending');
  assert.equal((await api('bootstrap',{},customer)).role,'chef');assert.equal(await h.scalar('select count(*)::int from tlb.staff where user_id=$1',[customer]),0);
  await assert.rejects(()=>h.api('admin_bootstrap',{},customer),/staff|owner|authorized|permission/i);
  await assert.rejects(()=>api('access',{},customer),/owner/);
  await assert.rejects(()=>api('invite_access',{email:'other@example.test',permission:'kitchen'},customer),/owner/);
 })();
 await check('pending invitations are idempotent, verified-email-bound, and privately listed',async()=>{
  invitation=await api('invite_access',{email:'unverified@example.test',permission:'kitchen'});assert.equal(invitation.pending,true);
  await api('invite_access',{email:'UNVERIFIED@example.test',permission:'kitchen'});
  assert.equal(await h.scalar("select count(*)::int from tlb.outbox where to_email='unverified@example.test'"),1);
  await assert.rejects(()=>api('bootstrap',{},unverified),/Authorized recipe/);await assert.rejects(()=>api('bootstrap',{},stranger),/Authorized recipe/);
  assert.ok((await api('access')).some(p=>p.invitation_id===invitation.invitation_id));
  await assert.rejects(()=>h.as(customer,()=>db.query('select * from tlb.recipe_invitations')),/permission denied/);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[unverified]);
  assert.equal((await api('bootstrap',{},unverified)).role,'kitchen');assert.equal(await h.scalar('select count(*)::int from tlb.staff where user_id=$1',[unverified]),0);
  await api('save_access',{user_id:unverified,permission:''});await assert.rejects(()=>api('bootstrap',{},unverified),/Authorized recipe/);
 })();
 await check('expired, revoked and changed-role invitations cannot send stale access emails',async()=>{
  const pending=await api('invite_access',{email:'pending@example.test',permission:'kitchen'});
  const claimed=await h.service('claim_emails',{limit:20});const row=claimed.find(r=>r.to_email==='pending@example.test');assert.ok(row);
  const prepared=await h.service('prepare_email',{id:row.id,lease_token:row.lease_token});assert.equal(prepared.payload.event_type,'recipe_access_invitation');
  await api('remove_invitation',{invitation_id:pending.invitation_id});assert.equal((await h.service('prepare_email',{id:row.id,lease_token:row.lease_token})).skip,true);
  await api('invite_access',{email:'expired@example.test',permission:'kitchen'});await db.query("update tlb.recipe_invitations set expires_at=now()-interval '1 second' where email='expired@example.test'");
  const id=randomUUID();await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'expired@example.test',now())",[id]);await assert.rejects(()=>api('bootstrap',{},id),/Authorized recipe/);
  await assert.rejects(()=>api('invite_access',{email:'expired@example.test',permission:'kitchen',resend:true}),/one minute/);
  await db.query("update tlb.recipe_invitations set last_emailed_at=now()-interval '2 minutes' where email='expired@example.test'");
  assert.equal((await api('invite_access',{email:'expired@example.test',permission:'kitchen',resend:true})).pending,false);
  assert.equal((await api('bootstrap',{},id)).role,'kitchen');
 })();
 await check('packaging supplier is saved without pricing and invalid supplier references are rejected',async()=>{
  const supplier=await api('save_resource',{kind:'supplier',name:'Box supplier',data:{}});
  const box=await api('save_resource',{kind:'packaging',name:'Cake box',data:{supplier_id:supplier.id,photos:[]}});
  assert.equal(box.data.supplier_id,supplier.id);assert.equal(await h.scalar('select count(*)::int from tlb.recipe_prices where resource_id=$1',[box.id]),0);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_supplier_items where resource_id=$1 and supplier_id=$2',[box.id,supplier.id]),1);
  await assert.rejects(()=>api('save_resource',{kind:'packaging',name:'Invalid box',data:{supplier_id:box.id}}),/Supplier not found/);
 })();
 await check('alternative quotes use lowest compatible unit cost with an explicit preferred-supplier override',async()=>{
  const a=await api('save_resource',{kind:'supplier',name:'Supplier A',data:{}}),b=await api('save_resource',{kind:'supplier',name:'Supplier B',data:{}}),c=await api('save_resource',{kind:'supplier',name:'Incompatible supplier',data:{}});
  let item=await api('save_resource',{kind:'ingredient',name:'Compared flour',data:{default_unit:'g'},suppliers:[{supplier_id:a.id,price:{amount:'300',quantity:'1',unit:'kg'}},{supplier_id:b.id,price:{amount:'170',quantity:'500',unit:'g'}},{supplier_id:c.id,price:{amount:'1',quantity:'1',unit:'box'}}]});
  const current=()=>api('resources',{kind:'ingredient',query:'Compared flour'}).then(r=>r.rows[0]);
  assert.equal((await current()).price.supplier_id,a.id);assert.equal((await current()).suppliers.length,3);
  const doc={name:'Cost snapshot test',variants:[{id:'base',name:'Standard',yield:{quantity:'1',unit:'batch'},groups:[{id:'g',name:'Dough',ingredients:[{id:'flour',ingredient_id:item.id,name:'Flour',quantity:'100',unit:'g'}]}],methods:[]}]};
  const recipe=await api('create',{document:doc,status:'production'});assert.equal(Number(recipe.cost_snapshot.variants[0].total),30);
  item=await api('save_resource',{id:item.id,revision:item.revision,kind:'ingredient',name:item.name,data:{default_unit:'g',preferred_supplier_id:b.id}});assert.equal((await current()).price.supplier_id,b.id);
  assert.equal(Number((await api('cost_preview',{document:doc})).snapshot.variants[0].total),34);assert.equal(Number((await api('get',{id:recipe.id})).cost_snapshot.variants[0].total),30);
  item=await api('save_resource',{id:item.id,revision:item.revision,kind:'ingredient',name:item.name,data:{default_unit:'g',preferred_supplier_id:c.id}});assert.equal((await current()).price,null);
  assert.equal((await api('cost_preview',{document:doc})).snapshot.variants[0].complete,false);
  item=await api('save_resource',{id:item.id,revision:item.revision,kind:'ingredient',name:item.name,data:{default_unit:'g'},suppliers:[{supplier_id:a.id,price:{amount:'400',quantity:'1',unit:'kg'}},{supplier_id:b.id,price:{amount:'170',quantity:'500',unit:'g'}},{supplier_id:c.id,price:{amount:'1',quantity:'1',unit:'box'}}]});assert.equal((await current()).price.supplier_id,b.id);
  assert.equal((await api('prices',{id:item.id})).length,4);
  await assert.rejects(()=>api('save_resource',{id:item.id,revision:item.revision,kind:'ingredient',name:item.name,data:{},suppliers:[{supplier_id:a.id},{supplier_id:a.id}]}),/only once/);
 })();
 await check('one purchase creates missing ingredient/supplier records atomically and retries cannot duplicate it',async()=>{
  const payload={request_id:randomUUID(),kind:'ingredient',name:'Purchase sugar',brand:'Brand A',supplier_name:'New Supplier',amount:'150',quantity:'2',unit:'kg',preferred:true};
  const first=await api('record_purchase',payload),again=await api('record_purchase',payload);assert.deepEqual(first,again);
  assert.equal((await api('prices',{id:first.resource_id})).length,1);const item=(await api('resources',{kind:'ingredient',query:'Purchase sugar'})).rows[0];assert.equal(item.data.brand,'Brand A');assert.equal(item.data.preferred_supplier_id,first.supplier_id);
  const next=await api('record_purchase',{...payload,request_id:randomUUID(),supplier_name:' NEW SUPPLIER ',amount:'160'});assert.equal(next.resource_id,first.resource_id);assert.equal(next.supplier_id,first.supplier_id);assert.equal((await api('prices',{id:first.resource_id})).length,2);
  await assert.rejects(()=>api('record_purchase',{...payload,amount:'170'}),/already saved with different/);
  const count=await h.scalar('select count(*)::int from tlb.recipe_resources');await assert.rejects(()=>api('record_purchase',{...payload,request_id:randomUUID(),name:'Bad purchase',supplier_name:'Must not persist',quantity:'0'}),/positive purchase quantity/);assert.equal(await h.scalar('select count(*)::int from tlb.recipe_resources'),count);
  await assert.rejects(()=>api('record_purchase',{...payload,request_id:randomUUID(),resource_id:first.resource_id,brand:'Brand B'}),/different brand/);
  await assert.rejects(()=>api('record_purchase',{...payload,request_id:randomUUID()},stranger),/Authorized recipe/);
 })();
 await check('packaging photos require completed private image uploads and retain canonical file paths',async()=>{
  const file=await api('reserve_file',{filename:'box.png',mime_type:'image/png',size_bytes:2,sha256:'a'.repeat(64)});
  const payload={kind:'packaging',name:'Photo box',data:{photos:[{file_id:file.id,path:'https://untrusted.example/box.png',caption:'Box lid'}]}};
  await assert.rejects(()=>api('save_resource',payload),/Finish uploading/);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:2,mimetype:'image/png'})]);await api('confirm_file',{id:file.id});
  const box=await api('save_resource',payload);assert.equal(box.data.photos[0].path,file.path);assert.equal(box.data.photos[0].caption,'Box lid');
  assert.equal(await h.as(stranger,()=>h.scalar('select public.recipe_file_access($1,false)',[file.path])),false);
  const edited=await api('save_resource',{...payload,id:box.id,revision:box.revision,data:{photos:[]}});assert.deepEqual(edited.data.photos,[]);
  assert.equal(await h.scalar('select count(*)::int from tlb.recipe_files where id=$1',[file.id]),1);
 })();
}
