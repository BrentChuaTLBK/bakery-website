import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {staffFixture} from './recipe-staff-fixture.mjs';

export default async function({db,check}){
 const f=await staffFixture(db),{api,raw,clock,people,owner,angie,edna,third,vanilla,matcha,chocolate,research,document,policy,overview,save,calendar,override,h}=f;
 const deny=async(action,payload={},user=angie,reason)=>{
  const result=await raw(action,payload,user);assert.equal(result.error,true,`${action} must be denied`);assert.equal(result.code,'42501');if(reason)assert.equal(result.reason,reason);return result;
 };
 await check('Kitchen access uses inclusive 10am and exclusive 7pm boundaries on all seven Manila days',async()=>{
  for(const [time,allowed] of [['09:59',false],['10:00',true],['14:00',true],['18:59',true],['19:00',false]]){
   await clock(`2026-10-01 ${time}`);assert.equal((await policy()).allowed,allowed,time);
   if(allowed)assert.equal((await api('get',{id:vanilla.id},angie)).id,vanilla.id);else await deny('get',{id:vanilla.id},angie,'outside_hours');
  }
  for(const day of ['2026-10-03','2026-10-04']){await clock(`${day} 14:00`);assert.equal((await policy()).allowed,true,'Saturday and Sunday are working days');}
  await clock('2026-10-01 14:00');
 })();
 await check('Kitchen payload, search, count, categories and current versions contain only authorized data',async()=>{
  const list=await api('list',{},angie);assert.equal(list.total,2);assert.deepEqual(list.rows.map(r=>r.name),['Matcha Basque','Vanilla Basque']);
  assert.equal((await api('list',{query:'Chocolate'},angie)).total,0);
  assert.equal((await api('list',{query:'CONFIDENTIAL_ADMIN_NOTE'},angie)).total,0);
  assert.equal((await api('bootstrap',{},angie)).categories.length,1);
  await deny('get',{id:chocolate.id},angie,'recipe_denied');
  for(const r of [f.draft,f.archived])await deny('get',{id:r.id,version_id:r.version_id},edna,'recipe_denied');
  const result=await api('get',{id:vanilla.id},angie),body=JSON.stringify(result);
  for(const text of ['cost_snapshot','private_notes','CONFIDENTIAL','supplier','profit','margin','additional_costs','created_by','reason']){
   // The authorization envelope has a non-confidential reason code.
   assert.equal(JSON.stringify({...result,access:undefined}).includes(text),false,text);
  }
  assert.ok(body.includes('Philadelphia'));assert.equal(result.version_id,vanilla.version_id);
  await save(angie,{show_brands:false});assert.equal(JSON.stringify(await api('get',{id:vanilla.id},angie)).includes('Philadelphia'),false);await save(angie,{show_brands:true});
 })();
 await check('direct export, print, CSV, editing, costing, backup and admin actions deny Kitchen Staff and retain audit rows',async()=>{
  for(const action of ['export_authorize','export','export_data','print','pdf','csv','download','ingredient_csv','recipe_pdf','print_recipe','copy_recipe'])await deny(action,{id:vanilla.id},angie,'export_denied');
  for(const action of ['costing','costing_overview','resources','prices','tests','versions','drafts','create','save','autosave','reserve_file','save_access','save_rd_access','staff_overview','staff_calendar','staff_activity','component_plan'])await deny(action,{id:vanilla.id,users:[angie],dates:['2026-10-05'],action:'block'},angie,'action_denied');
  assert.ok(Number((await db.query("select count(*) n from tlb.recipe_staff_events where user_id=$1 and action='export_attempt'",[angie])).rows[0].n)>=11);
  await assert.rejects(()=>h.as(angie,()=>db.query("select public.recipe_backup_api('status','{}')")),/owner|Authorized/);
  assert.equal((await api('export_authorize')).allowed,true);assert.equal((await api('get',{id:vanilla.id})).document.private_notes,'CONFIDENTIAL_ADMIN_NOTE');
 })();
 await check('calendar A/B/C/D creates exactly the selected staff-date pairs and leaves others unchanged',async()=>{
  await calendar([angie],['2026-10-05']);let data=await overview();assert.equal(data.dates.filter(d=>d.date==='2026-10-05').length,1);
  await calendar([angie,edna],['2026-10-05']);data=await overview();assert.equal(data.dates.filter(d=>d.date==='2026-10-05').length,2);
  await calendar([angie],['2026-10-05','2026-10-08','2026-10-12']);data=await overview();assert.equal(data.dates.filter(d=>d.user_id===angie).length,3);
  const dates=Array.from({length:6},(_,i)=>`2026-10-${10+i}`);const result=await calendar(people,dates);assert.equal(result.changes,30);
  const rows=(await db.query("select user_id,access_date::text from tlb.recipe_staff_dates where user_id=any($1::uuid[]) and access_date=any($2::date[]) and blocked",[people,dates])).rows;
  assert.equal(rows.length,30);assert.equal(new Set(rows.map(r=>`${r.user_id}:${r.access_date}`)).size,30);
 })();
 await check('calendar E/F mixed state and restore affect only selected staff; G/H resume normal hours',async()=>{
  await calendar([angie],['2026-10-05'],'restore');const data=await overview();assert.equal(data.dates.some(d=>d.user_id===angie&&d.date==='2026-10-05'),false);assert.equal(data.dates.some(d=>d.user_id===edna&&d.date==='2026-10-05'),true);
  await clock('2026-10-05 14:00');assert.equal((await policy(angie)).allowed,true);assert.equal((await policy(edna)).reason,'date_blocked');await deny('get',{id:vanilla.id},edna,'date_blocked');
  await clock('2026-10-06 14:00');assert.equal((await policy(edna)).allowed,true);
 })();
 await check('temporary allows/blocks expire automatically; account block has highest priority',async()=>{
  await clock('2026-10-06 18:55');await override([angie],'allow','2026-10-06T19:00','2026-10-06T23:00');
  await clock('2026-10-06 21:00');assert.equal((await policy()).reason,'temporary_allow');assert.equal((await api('get',{id:vanilla.id},angie)).id,vanilla.id);
  await clock('2026-10-06 23:00');assert.equal((await policy()).allowed,false);
  await clock('2026-10-07 13:00');await override([angie],'block','2026-10-07T14:00','2026-10-07T17:00');await override([angie],'allow','2026-10-07T13:00','2026-10-07T18:00');
  await clock('2026-10-07 15:00');assert.equal((await policy()).reason,'temporary_block');
  await clock('2026-10-07 17:00');assert.equal((await policy()).allowed,true);
  await api('staff_set_mode',{users:[angie],mode:'blocked'});assert.equal((await policy()).reason,'account_blocked');await deny('get',{id:vanilla.id},angie,'account_blocked');
  await api('staff_set_mode',{users:[angie],mode:'scheduled'});assert.equal((await policy()).reason,'temporary_allow');
 })();
 await check('always allowed bypasses hours but calendar and temporary blocks remain authoritative',async()=>{
  await clock('2026-10-08 23:00');await api('staff_set_mode',{users:[edna],mode:'always'});assert.equal((await policy(edna)).allowed,true);
  await calendar([edna],['2026-10-08']);assert.equal((await policy(edna)).reason,'date_blocked');
  await override([edna],'allow','2026-10-08T22:00','2026-10-08T23:59');assert.equal((await policy(edna)).reason,'temporary_allow');
  await override([edna],'block','2026-10-08T22:30','2026-10-08T23:30');assert.equal((await policy(edna)).reason,'temporary_block');
  await api('staff_set_mode',{users:[edna],mode:'scheduled'});
 })();
 await check('staff-specific and default hours are versioned, validated, and do not change Owner access',async()=>{
  await clock('2026-10-09 09:15');const data=await overview(),hours=data.hours.map(d=>({...d,start:'09:00',end:'18:00'}));
  await save(edna,{hours});assert.equal((await policy(edna)).allowed,true);assert.equal((await policy()).allowed,false);
  await api('staff_save_defaults',{revision:(await overview()).revision,hours});assert.equal((await policy()).allowed,true);
  await assert.rejects(()=>api('staff_save_defaults',{revision:data.revision,hours}),/changed/);
  for(const invalid of [hours.slice(0,6),hours.map(d=>({...d,day:1})),hours.map(d=>({...d,start:'19:00',end:'10:00'}))])await assert.rejects(async()=>api('staff_save_defaults',{revision:(await overview()).revision,hours:invalid}),/hours/);
  await clock('2026-10-09 23:00');assert.equal((await api('access_check')).access.allowed,true);assert.equal((await api('get',{id:vanilla.id})).id,vanilla.id);
  await api('staff_save_defaults',{revision:(await overview()).revision,hours:data.hours});await save(edna,{hours:null});
 })();
 await check('Final/R&D share time and recipe scope; the global R&D grant remains explicit and read-only',async()=>{
  await clock('2026-10-16 14:00');await deny('list',{rd:true},angie,'rd_denied');
  await save(angie,{can_view_rd:true,scope_mode:'recipes',scope_ids:[vanilla.id,matcha.id,research.id]});
  assert.equal((await api('list',{},angie)).total,2);assert.deepEqual((await api('list',{rd:true},angie)).rows.map(r=>r.id),[research.id]);
  const rd=await api('get',{id:research.id,rd:true},angie);assert.equal(rd.status,'testing');assert.equal(rd.document.private_notes,undefined);await deny('tests',{id:research.id},angie,'action_denied');
  await deny('get',{id:research.id},angie,'recipe_denied');
  await calendar([angie],['2026-10-16']);for(const rd of [false,true])await deny('list',{rd},angie,'date_blocked');
  await calendar([angie],['2026-10-16'],'restore');await clock('2026-10-16 19:00');await deny('get',{id:research.id,rd:true},angie,'outside_hours');
  await clock('2026-10-16 14:00');await save(angie,{can_view_rd:false,scope_ids:[vanilla.id,matcha.id]});await deny('get',{id:research.id,rd:true},angie,'rd_denied');
 })();
 await check('category scope includes child categories but does not leak unauthorized category names or recipes',async()=>{
  await clock('2026-10-17 14:00');await save(angie,{scope_mode:'categories',scope_ids:[f.cheesecake.id]});
  const child=await api('save_category',{name:'Kitchen scope child',parent_id:f.cheesecake.id});const nested=await api('create',{document:document('Nested cheesecake',child.id),status:'final'});
  assert.equal((await api('get',{id:nested.id},angie)).id,nested.id);await deny('get',{id:chocolate.id},angie,'recipe_denied');
  await assert.rejects(()=>save(angie,{scope_ids:[randomUUID()]}),/category/);
  await save(angie,{scope_mode:'recipes',scope_ids:[vanilla.id,matcha.id]});await assert.rejects(()=>save(angie,{scope_ids:[randomUUID()]}),/recipe/);
 })();
 await check('historic versions require an authorized current parent component context and drafts cannot be dependencies',async()=>{
  const comp=await api('create',{document:document('Approved filling'),status:'final'});
  const next=await api('save',{id:comp.id,revision:comp.revision,document:{...comp.document,name:'New approved filling'},status:'final'});
  const d=document('Production cake with filling');d.variants[0].components=[{id:'filling',version_id:comp.version_id,variant_id:comp.document.variants[0].id,quantity:'1',unit:'cake',mode:'pinned'}];
  const parent=await api('create',{document:d,status:'final'});await save(angie,{scope_ids:[vanilla.id,parent.id]});
  await deny('get',{id:comp.id,version_id:comp.version_id},angie,'recipe_denied');
  const child=await api('get',{id:comp.id,version_id:comp.version_id,root_id:parent.id,root_version:parent.version_id},angie);assert.equal(child.version_id,comp.version_id);
  await deny('get',{id:chocolate.id,version_id:chocolate.version_id,root_id:parent.id,root_version:parent.version_id},angie,'recipe_denied');
  await deny('get',{id:comp.id,version_id:next.version_id,root_id:parent.id,root_version:parent.version_id},angie,'recipe_denied');
  await api('set_status',{id:parent.id,revision:parent.revision,status:'hidden'});await deny('get',{id:comp.id,version_id:comp.version_id,root_id:parent.id,root_version:parent.version_id},angie,'recipe_denied');
  await save(angie,{scope_ids:[vanilla.id,matcha.id]});
  const old=vanilla.version_id,newer=await api('save',{id:vanilla.id,revision:vanilla.revision,document:vanilla.document,status:'final'});Object.assign(vanilla,newer);
  await deny('get',{id:vanilla.id,version_id:old},angie,'recipe_denied');assert.equal((await api('get',{id:vanilla.id},angie)).version_id,newer.version_id);
 })();
 await check('media authorization permits only scoped images while raw Storage signing and all documents stay denied',async()=>{
  const photo=async(name,type)=>{const file=await api('reserve_file',{filename:name,mime_type:type,size_bytes:16,sha256:'0'.repeat(64)});await db.query("insert into storage.objects(bucket_id,name,metadata) values('recipe-files',$1,$2::jsonb)",[file.path,JSON.stringify({size:16,mimetype:type})]);await api('confirm_file',{id:file.id});return file;};
  const image=await photo('kitchen.png','image/png'),pdf=await photo('recipe.pdf','application/pdf'),privateImage=await photo('private.png','image/png');
  const d=structuredClone(vanilla.document);d.files=[{...image,visibility:'kitchen'},{...pdf,visibility:'kitchen'},{...privateImage,visibility:'private'}];d.photos=[{id:'photo',file_id:image.id,caption:'Approved photo'}];
  Object.assign(vanilla,await api('save',{id:vanilla.id,revision:vanilla.revision,document:d,status:'final'}));
  const read=await api('get',{id:vanilla.id},angie);assert.deepEqual(read.files.map(f=>f.id),[image.id]);assert.equal(read.files[0].path,undefined);
  const context={recipe_id:vanilla.id,version_id:vanilla.version_id};assert.equal((await api('media_authorize',{...context,file_id:image.id},angie)).path,image.path);
  for(const file of [pdf,privateImage])await deny('media_authorize',{...context,file_id:file.id},angie,'recipe_denied');
  assert.equal((await h.as(angie,()=>db.query('select public.recipe_file_access($1,false) allowed',[image.path]))).rows[0].allowed,false);
  assert.equal((await h.as(owner,()=>db.query('select public.recipe_file_access($1,false) allowed',[image.path]))).rows[0].allowed,true);
  await clock('2026-10-17 19:00');await deny('media_authorize',{...context,file_id:image.id},angie,'outside_hours');await clock('2026-10-17 14:00');
 })();
 await check('trusted Manila dates switch exactly at midnight, month/year boundaries, independent of request time/timezone',async()=>{
  await api('staff_set_mode',{users:[angie],mode:'always'});
  for(const [before,after,date] of [['2026-10-04 23:59:59','2026-10-05 00:00:00','2026-10-05'],['2026-10-31 23:59:59','2026-11-01 00:00:00','2026-11-01'],['2026-12-31 23:59:59','2027-01-01 00:00:00','2027-01-01']]){
   await calendar([angie],[date]);await clock(before);assert.equal((await policy()).allowed,true);assert.ok((await policy()).lease_ms<=1000);
   await clock(after);assert.equal((await policy()).reason,'date_blocked');assert.equal((await policy()).business_date,date);
   await db.exec("set timezone='America/Los_Angeles'");assert.equal((await policy()).business_date,date);await db.exec("set timezone='UTC'");
   await deny('get',{id:vanilla.id,now:'2026-10-01T14:00:00+08:00',timezone:'UTC',allowed:true,role:'owner'},angie,'date_blocked');
  }
  await clock('2026-10-18 14:00');await api('staff_set_mode',{users:[angie],mode:'scheduled'});
 })();
 await check('leases end at work-hour/override boundaries and blocked reads/scaling never rely on a prior grant',async()=>{
  await clock('2026-10-18 18:59:59');const first=await api('get',{id:vanilla.id},angie);assert.ok(first.access.lease_ms<=1000);
  await clock('2026-10-18 19:00');await deny('access_check',{id:vanilla.id,version_id:vanilla.version_id},angie,'outside_hours');await deny('scale',{id:vanilla.id},angie,'outside_hours');
  await clock('2026-10-19 13:59:59');await override([angie],'block','2026-10-19T14:00','2026-10-19T17:00');assert.ok((await policy()).lease_ms<=1000);
  await clock('2026-10-19 14:00');await deny('get',{id:vanilla.id},angie,'temporary_block');
  await clock('2026-10-20 14:00');await api('staff_set_mode',{users:[angie],mode:'blocked'});await deny('scale',{id:vanilla.id},angie,'account_blocked');await api('staff_set_mode',{users:[angie],mode:'scheduled'});
 })();
 await check('bulk failure rolls back all pairs, retries are idempotent, and safe undo rejects conflicting edits',async()=>{
  const dates=['2026-11-10','2026-11-11'],request_id=randomUUID();const before=(await db.query('select count(*) n from tlb.recipe_staff_dates')).rows[0].n;
  await assert.rejects(()=>calendar([angie,randomUUID()],dates),/account/);assert.equal((await db.query('select count(*) n from tlb.recipe_staff_dates')).rows[0].n,before);
  await db.exec("create function tlb.recipe_test_bulk_failure() returns trigger language plpgsql as $$begin if new.access_date='2026-11-11' then raise exception 'Injected transactional failure';end if;return new;end$$; create trigger recipe_test_bulk_failure before insert or update on tlb.recipe_staff_dates for each row execute function tlb.recipe_test_bulk_failure()");
  await assert.rejects(()=>calendar([angie,edna],dates,'block',request_id),/Injected/);assert.equal((await db.query('select count(*) n from tlb.recipe_staff_dates')).rows[0].n,before);assert.equal((await db.query('select count(*) n from tlb.recipe_staff_batches where id=$1',[request_id])).rows[0].n,0);
  await db.exec('drop trigger recipe_test_bulk_failure on tlb.recipe_staff_dates; drop function tlb.recipe_test_bulk_failure()');
  const batch=await calendar([angie,edna],dates,'block',request_id);assert.equal((await calendar([edna,angie],dates,'block',request_id)).replayed,true);
  await assert.rejects(()=>calendar([angie],dates,'block',request_id),/request ID/);
  await api('staff_undo',{batch_id:batch.batch_id});assert.equal((await db.query('select count(*) n from tlb.recipe_staff_dates where access_date=any($1::date[])',[dates])).rows[0].n,0);
  const audit=(await db.query("select user_id,actor from tlb.recipe_staff_events where action='calendar_undone' and details->>'batch_id'=$1",[batch.batch_id])).rows[0];assert.equal(audit.user_id,null);assert.equal(audit.actor,owner);
  await assert.rejects(()=>api('staff_undo',{batch_id:batch.batch_id}),/no longer/);
  await clock('2026-10-20 14:01');const first=await calendar([angie,edna],dates);await clock('2026-10-20 14:02');await calendar([edna],[dates[0]],'restore');
  await assert.rejects(()=>api('staff_undo',{batch_id:first.batch_id}),/most recent|newer/);
 })();
 await check('account role changes take effect on the next API call without renewing the JWT',async()=>{
  await db.query("insert into tlb.staff(user_id,role) values($1,'owner') on conflict(user_id) do update set role='owner'",[edna]);
  assert.equal((await api('access_check',{},edna)).role,'owner');assert.equal((await api('export_authorize',{},edna)).allowed,true);
  await db.query('delete from tlb.staff where user_id=$1',[edna]);assert.equal((await api('access_check',{},edna)).role,'kitchen');await deny('csv',{id:vanilla.id},edna,'export_denied');
 })();
 await check('Undo preserves another admin’s later changes and refuses expired undo requests',async()=>{
  const secondOwner=randomUUID();await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[secondOwner,`second-owner-${secondOwner}@example.test`]);await db.query("insert into tlb.staff(user_id,role) values($1,'owner')",[secondOwner]);
  await clock('2026-10-21 14:00');const first=await calendar([angie,edna],['2026-12-01']);
  await api('staff_calendar',{users:[edna],dates:['2026-12-01'],action:'restore',request_id:randomUUID()},secondOwner);
  await assert.rejects(()=>api('staff_undo',{batch_id:first.batch_id}),/newer change/);
  const rows=(await db.query("select user_id,blocked from tlb.recipe_staff_dates where access_date='2026-12-01'")).rows;assert.equal(rows.find(r=>r.user_id===angie).blocked,true);assert.equal(rows.find(r=>r.user_id===edna).blocked,false);
  const expiring=await calendar([angie],['2026-12-02']);await clock('2026-10-21 14:31');await assert.rejects(()=>api('staff_undo',{batch_id:expiring.batch_id}),/no longer/);
 })();
 await check('routine after-hours heartbeats are logged without suspicious flags, while deliberate denied reads are flagged',async()=>{
  await clock('2026-10-22 20:00');
  for(let i=0;i<8;i++){await raw('bootstrap',{},third);await deny('access_check',{},third,'outside_hours');}
  let activity=await api('staff_activity',{user_id:third});assert.equal(activity.flags.some(f=>f.user_id===third),false);
  for(let i=0;i<5;i++)await deny('get',{id:vanilla.id},third,'outside_hours');
  activity=await api('staff_activity',{user_id:third});assert.equal(activity.flags.find(f=>f.user_id===third).denied_requests,5);
  assert.ok(activity.rows.some(e=>e.details.request==='access_check'&&e.occurrences===8));assert.ok(activity.rows.some(e=>e.details.request==='get'&&e.occurrences===5));
 })();
 await check('twenty staff across ten dates are changed in one transactional API request',async()=>{
  await clock('2026-10-23 14:00');const users=Array.from({length:20},()=>randomUUID());
  for(const id of users){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`bulk-${id}@example.test`]);await api('save_access',{user_id:id,permission:'kitchen'});}
  const dates=Array.from({length:10},(_,i)=>`2026-12-${String(i+10).padStart(2,'0')}`),started=performance.now();const result=await calendar(users,dates);
  assert.equal(result.changes,200);assert.equal(Number((await db.query('select count(*) n from tlb.recipe_staff_dates where change_id=$1 and blocked',[result.batch_id])).rows[0].n),200);
  console.log(`Bulk calendar timing: 200 Staff-Date blocks in ${Math.round(performance.now()-started)} ms (isolated database).`);
  await api('staff_undo',{batch_id:result.batch_id});assert.equal(Number((await db.query('select count(*) n from tlb.recipe_staff_dates where change_id=$1',[result.batch_id])).rows[0].n),0);
 })();
 await check('new private tables and helper functions reject anonymous, authenticated and service direct access',async()=>{
  const helpers=(await db.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tlb' and (p.proname like 'recipe_staff_%' or p.proname='recipe_api_before_staff_security')")).rows;
  for(const role of ['anon','authenticated','service_role'])for(const helper of helpers)assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,helper.signature])).rows[0].allowed,false,`${role} ${helper.signature}`);
  const tables=(await db.query("select tablename from pg_tables where schemaname='tlb' and tablename like 'recipe_staff_%'")).rows;
  for(const {tablename} of tables){assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',[`tlb.${tablename}`])).rows[0].relrowsecurity,true);for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_table_privilege($1,$2,\'select\') allowed',[role,`tlb.${tablename}`])).rows[0].allowed,false);}
  await assert.rejects(()=>h.as(null,()=>db.query("select public.recipe_api('bootstrap','{}')")),/permission denied/);
  const grants=(await h.as(angie,()=>db.query("select current_setting('response.headers',true) headers from (select public.recipe_api('access_check','{}')) call"))).rows[0];assert.ok(grants.headers.includes('no-store'));
 })();
 await check('the complete required production scenario passes with server-side checks and useful owner-only activity',async()=>{
  await clock('2026-10-02 14:00');await save(angie,{mode:'scheduled',hours:null,can_view_rd:false,scope_mode:'recipes',scope_ids:[vanilla.id,matcha.id]});
  await calendar([angie],['2026-10-05']);
  for(const r of [vanilla,matcha])assert.equal((await api('get',{id:r.id},angie)).id,r.id);
  for(const [a,p] of [['get',{id:chocolate.id}],['costing',{id:vanilla.id}],['resources',{kind:'supplier'}],['pdf',{}],['csv',{}]])await deny(a,p);
  await clock('2026-10-05 14:00');await deny('get',{id:vanilla.id},angie,'date_blocked');await calendar([angie],['2026-10-05'],'restore');assert.equal((await api('get',{id:vanilla.id},angie)).id,vanilla.id);
  await clock('2026-10-05 19:00');await deny('get',{id:vanilla.id},angie,'outside_hours');await override([angie],'allow','2026-10-05T19:00','2026-10-05T22:00');
  await clock('2026-10-05 20:00');assert.equal((await api('get',{id:matcha.id},angie)).id,matcha.id);await deny('get',{id:chocolate.id},angie,'recipe_denied');
  await clock('2026-10-05 22:00');await deny('get',{id:vanilla.id},angie,'outside_hours');await api('staff_set_mode',{users:[angie],mode:'blocked'});await deny('get',{id:vanilla.id},angie,'account_blocked');
  await api('staff_set_mode',{users:[angie],mode:'scheduled'});await clock('2026-10-06 14:00');assert.equal((await api('get',{id:vanilla.id},angie)).id,vanilla.id);
  const activity=await api('staff_activity',{user_id:angie});assert.ok(activity.rows.some(e=>e.action==='recipe_opened'));assert.ok(activity.rows.some(e=>e.action==='account_mode_changed'));assert.ok(activity.rows.every(e=>!JSON.stringify(e).includes('CONFIDENTIAL_ADMIN_NOTE')));await deny('staff_activity',{},angie,'action_denied');
  assert.equal((await api('export_authorize')).allowed,true);assert.equal((await api('get',{id:research.id})).document.private_notes,'CONFIDENTIAL_ADMIN_NOTE');
 })();
 // Do not leave test-only time behavior in place for subsequent contract suites.
 await db.exec("create or replace function tlb.recipe_staff_now() returns timestamptz language sql volatile security invoker set search_path='' as $$select clock_timestamp()$$; drop table public.recipe_test_clock");
}
