begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Abort the migration if a previous function changed instead of silently
-- skipping an authorization or projection hook. This helper is dropped below.
create function tlb.academy_comparison_patch(definition text,anchor text,replacement text) returns text
language plpgsql immutable security invoker set search_path='' as $$
begin
 if strpos(definition,anchor)=0 then raise exception 'Review Academy function before applying comparison hook: %',anchor;end if;
 return replace(definition,anchor,replacement);
end $$;
revoke all on function tlb.academy_comparison_patch(text,text,text) from public,anon,authenticated,service_role;

-- Retirement retains the context of previous student work and conversations.
alter table tlb.academy_modules add column visible boolean not null default true, add column deleted_at timestamptz;
alter table tlb.academy_class_recipes add column visible boolean not null default true, add column removed boolean not null default false;
alter table tlb.academy_announcements add column important boolean not null default false;
alter table tlb.academy_submissions add column cancelled_at timestamptz;
alter table tlb.academy_messages add column cancelled_at timestamptz;
alter table tlb.academy_message_threads add column submission_id uuid unique references tlb.academy_submissions(id);
alter table tlb.academy_portal_media add column abandoned_at timestamptz, add column sort_order integer not null default 0;
alter table tlb.academy_portal_media drop constraint academy_portal_media_purpose_check;
alter table tlb.academy_portal_media add constraint academy_portal_media_purpose_check check(purpose in ('submission','message','class','module','recipe','announcement','upcoming','instructor','welcome'));
do $$ declare d text;begin
 select pg_get_constraintdef(oid) into d from pg_constraint where conrelid='tlb.academy_portal_media'::regclass and conname='academy_media_purpose_relations';
 alter table tlb.academy_portal_media drop constraint academy_media_purpose_relations;
 execute 'alter table tlb.academy_portal_media add constraint academy_media_purpose_relations '||tlb.academy_comparison_patch(d,$q$purpose = 'instructor'::text$q$,$q$purpose = ANY (ARRAY['instructor'::text, 'welcome'::text])$q$);
end $$;

create table tlb.academy_welcome_settings (
 id boolean primary key default true check(id),media_id uuid references tlb.academy_portal_media(id),photo_alt text not null default '',revision bigint not null default 1
);
insert into tlb.academy_welcome_settings(id) values(true);
create table tlb.academy_submission_reads (
 submission_id uuid not null references tlb.academy_submissions(id),user_id uuid not null references auth.users(id),seen_at timestamptz not null default now(),primary key(submission_id,user_id)
);
create table tlb.academy_moderation_undo (
 token uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),before_state jsonb not null,after_state jsonb not null,created_at timestamptz not null default now(),used_at timestamptz
);
do $$ declare t text;begin
 foreach t in array array['academy_welcome_settings','academy_submission_reads','academy_moderation_undo'] loop
  execute format('alter table tlb.%I enable row level security',t);
  execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('academy-welcome','academy-welcome',true,5242880,array['image/webp']);
-- No browser write policy: the existing validating upload service owns writes.

create function tlb.academy_recipe_visible(p_class uuid,p_recipe uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from tlb.academy_class_recipes cr left join tlb.academy_modules m on m.id=cr.module_id
 where cr.class_id=p_class and cr.recipe_id=p_recipe and not cr.removed and cr.visible and (cr.module_id is null or (m.visible and m.deleted_at is null)))
$$;
revoke all on function tlb.academy_recipe_visible(uuid,uuid) from public,anon,authenticated,service_role;

-- Reuse the established access checks, adding retirement/visibility boundaries.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.academy_portal_media_readable(text)'::regprocedure);
 d:=tlb.academy_comparison_patch(d,'m.path=p_path and m.uploaded','m.path=p_path and m.uploaded and m.abandoned_at is null and m.purpose<>''welcome''');
 d:=tlb.academy_comparison_patch(d,$q$m.purpose='module' and tlb.academy_enrolled(m.class_id)$q$,$q$m.purpose='module' and tlb.academy_enrolled(m.class_id) and exists(select 1 from tlb.academy_modules mm where mm.id=m.module_id and mm.visible and mm.deleted_at is null)$q$);
 d:=tlb.academy_comparison_patch(d,'r.recipe_id=m.recipe_id and tlb.academy_class_access(r.class_id)','r.recipe_id=m.recipe_id and tlb.academy_class_access(r.class_id) and (tlb.academy_owner() or tlb.academy_teaches(r.class_id) or tlb.academy_recipe_visible(r.class_id,r.recipe_id))');execute d;
 d:=pg_get_functiondef('public.academy_portal_upload_check(uuid)'::regprocedure);
 d:=tlb.academy_comparison_patch(d,'m.user_id=auth.uid()','m.user_id=auth.uid() and m.abandoned_at is null');
 d:=tlb.academy_comparison_patch(d,'not s.submitted and s.user_id','not s.submitted and s.cancelled_at is null and s.user_id');
 d:=tlb.academy_comparison_patch(d,'not x.submitted and x.sender_id','not x.submitted and x.cancelled_at is null and x.sender_id');
 d:=tlb.academy_comparison_patch(d,'return to_jsonb(m);',$q$return to_jsonb(m)||jsonb_build_object('bucket',case m.purpose when 'welcome' then 'academy-welcome' else 'academy-student-media' end);$q$);execute d;
 d:=pg_get_functiondef('public.academy_portal_confirm_upload(uuid,uuid,text)'::regprocedure);
 d:=tlb.academy_comparison_patch(d,'m.user_id=p_user and','m.user_id=p_user and m.abandoned_at is null and');
 d:=tlb.academy_comparison_patch(d,'not s.submitted and s.user_id','not s.submitted and s.cancelled_at is null and s.user_id');
 d:=tlb.academy_comparison_patch(d,'not x.submitted and x.sender_id','not x.submitted and x.cancelled_at is null and x.sender_id');
 d:=tlb.academy_comparison_patch(d,$q$bucket_id='academy-student-media' and name=m.path$q$,$q$bucket_id=case m.purpose when 'welcome' then 'academy-welcome' else 'academy-student-media' end and name=m.path$q$);
 d:=tlb.academy_comparison_patch(d,$q$m.mime_type='image/webp' or$q$, $q$(m.mime_type='image/webp' and m.purpose<>'welcome') or$q$);execute d;
 d:=pg_get_functiondef('tlb.academy_class_card(uuid)'::regprocedure);
 d:=tlb.academy_comparison_patch(d,'m.class_id=c.id)', 'm.class_id=c.id and m.deleted_at is null and (tlb.academy_owner() or tlb.academy_teaches(c.id) or m.visible))');
 d:=tlb.academy_comparison_patch(d,'where cr.class_id=c.id and tlb.academy_enrolled(c.id)','where cr.class_id=c.id and tlb.academy_enrolled(c.id) and tlb.academy_recipe_visible(c.id,cr.recipe_id)');execute d;
 d:=pg_get_functiondef('tlb.academy_portal_base(text,jsonb)'::regprocedure);
 d:=tlb.academy_comparison_patch(d,'s.user_id=u and not s.submitted and','s.user_id=u and not s.submitted and s.cancelled_at is null and');
 d:=tlb.academy_comparison_patch(d,'m.sender_id=u and not m.submitted and','m.sender_id=u and not m.submitted and m.cancelled_at is null and');
 d:=tlb.academy_comparison_patch(d,'n.id,n.title,n.summary,n.thumbnail_id,n.publish_at','n.id,n.title,n.summary,n.thumbnail_id,n.publish_at,n.important');
 d:=tlb.academy_comparison_patch(d,$q$status=p_payload->>'status',publish_at=$q$,$q$important=case when p_payload ? 'important' then (p_payload->>'important')::boolean else important end,status=p_payload->>'status',publish_at=$q$);
 d:=tlb.academy_comparison_patch(d,'where x.class_id=id)', 'where x.class_id=id and x.deleted_at is null and (owner or tlb.academy_teaches(id) or x.visible))');
 d:=tlb.academy_comparison_patch(d,$q$'module_id',cr.module_id)$q$,$q$'module_id',cr.module_id,'visible',cr.visible,'sort_order',cr.sort_order)$q$);
 d:=tlb.academy_comparison_patch(d,'where cr.class_id=id)', 'where cr.class_id=id and not cr.removed and (owner or tlb.academy_teaches(id) or tlb.academy_recipe_visible(id,cr.recipe_id)))');
 d:=tlb.academy_comparison_patch(d,'where cr.class_id=cid and cr.recipe_id=id)', 'where cr.class_id=cid and cr.recipe_id=id and not cr.removed and (owner or tlb.academy_teaches(cid) or tlb.academy_recipe_visible(cid,id)))');
 d:=tlb.academy_comparison_patch(d,'where p.recipe_id=x.id and p.uploaded)', 'where p.recipe_id=x.id and p.uploaded and p.abandoned_at is null)');
 d:=tlb.academy_comparison_patch(d,'where class_id=cid)', 'where class_id=cid and deleted_at is null)');
 d:=tlb.academy_comparison_patch(d,'where class_id=cid and tlb.academy_modules.id=x.value::uuid)', 'where class_id=cid and deleted_at is null and tlb.academy_modules.id=x.value::uuid)');
 execute d;
end $$;

-- Selected accounts supplement typed addresses; consent and confirmed email
-- remain required at preview, send, and the existing delivery-time recheck.
create or replace function tlb.academy_recipients(p jsonb) returns table(user_id uuid,email text,unsubscribe_token text) language sql stable security invoker set search_path='' as $$
 select au.id,au.email,n.unsubscribe_token from auth.users au left join tlb.academy_newsletter_preferences n on n.user_id=au.id
 where au.email_confirmed_at is not null and nullif(au.email,'') is not null and (p->>'kind'='operational' or n.academy) and (
 (p->>'audience'='subscribers' and n.academy) or
 (p->>'audience'='selected' and (lower(au.email) in(select lower(btrim(value)) from jsonb_array_elements_text(coalesce(p->'emails','[]'))) or au.id in(select value::uuid from jsonb_array_elements_text(coalesce(p->'user_ids','[]'))))) or
 (p->>'audience' in ('students','class','instructor') and exists(select 1 from tlb.academy_enrollments e join tlb.academy_curricula c on c.id=e.class_id where e.user_id=au.id and e.status='active' and c.status='active'
 and (p->>'audience'<>'class' or e.class_id=nullif(p->>'class_id','')::uuid) and (p->>'audience'<>'instructor' or c.instructor_id=nullif(p->>'instructor_id','')::uuid))))
$$;

alter function public.academy_portal_api(text,jsonb) rename to academy_portal_before_comparisons;
alter function public.academy_portal_before_comparisons(text,jsonb) set schema tlb;
revoke all on function tlb.academy_portal_before_comparisons(text,jsonb) from public,anon,authenticated,service_role;

create function tlb.academy_comparison_api(p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 u uuid:=auth.uid(); owner boolean:=tlb.academy_owner(); target uuid:=nullif(p_payload->>'id','')::uuid; cid uuid:=nullif(p_payload->>'class_id','')::uuid;
 mid uuid:=nullif(p_payload->>'module_id','')::uuid; rid uuid:=nullif(p_payload->>'recipe_id','')::uuid; x record; y record;
 result jsonb; items jsonb; before_rows jsonb; after_rows jsonb; token uuid; n integer:=0; existed integer:=0; position integer:=0;
 size integer:=coalesce((p_payload->>'limit')::integer,25); cursor_id uuid:=case when p_action in ('accounts_page','admin_submissions_page') then nullif(p_payload->>'cursor','')::uuid end; search_text text:=btrim(coalesce(p_payload->>'query',''));
 s tlb.academy_submissions; m tlb.academy_portal_media; rec tlb.academy_student_recipes; setting tlb.academy_welcome_settings; undo_row tlb.academy_moderation_undo;
begin
 if p_action in ('public_welcome','welcome_config') then
  if p_action='welcome_config' then perform tlb.academy_assert(owner);end if;
  select w.* into setting from tlb.academy_welcome_settings w where w.id;
  return jsonb_build_object('photo_path',(select a.path from tlb.academy_portal_media a where a.id=setting.media_id and a.purpose='welcome' and a.uploaded and a.abandoned_at is null),'photo_alt',setting.photo_alt,'revision',setting.revision)||case when owner and p_action='welcome_config' then jsonb_build_object('media_id',setting.media_id) else '{}'::jsonb end;
 end if;
 if p_action='save_welcome_config' then
  perform tlb.academy_assert(owner);select * into setting from tlb.academy_welcome_settings where id for update;
  perform tlb.require(setting.revision=(p_payload->>'revision')::bigint,'Welcome photo changed. Reload before saving.');
  target:=case when p_payload ? 'media_id' then nullif(p_payload->>'media_id','')::uuid else setting.media_id end;
  if target is not null then
   perform tlb.academy_assert(exists(select 1 from tlb.academy_portal_media a where a.id=target and a.user_id=u and a.purpose='welcome' and a.uploaded and a.abandoned_at is null));
   perform tlb.require(length(btrim(p_payload->>'photo_alt')) between 1 and 300,'Describe the welcome photo.');
  end if;
  update tlb.academy_welcome_settings set media_id=target,photo_alt=case when target is null then '' else btrim(p_payload->>'photo_alt') end,revision=revision+1 where id;
  perform tlb.academy_log('welcome_photo_saved',target);return tlb.academy_comparison_api('welcome_config','{}');
 end if;
 if p_action='reserve_media' and p_payload->>'purpose'='welcome' then
  perform tlb.academy_assert(owner);perform tlb.require(coalesce(p_payload->>'mime_type','image/webp')='image/webp','Convert the welcome photo to WebP first.');
  result:=tlb.academy_portal_before_comparisons(p_action,p_payload);return result||jsonb_build_object('bucket','academy-welcome');
 end if;
 if p_action='cancel_draft' then
  perform tlb.require(p_payload->>'kind' in ('submission','message'),'Choose a draft type.');
  if p_payload->>'kind'='submission' then
   select * into s from tlb.academy_submissions where id=target for update;perform tlb.academy_assert(s.user_id=u and not s.submitted);
   update tlb.academy_submissions set cancelled_at=coalesce(cancelled_at,now()),moderation='removed' where id=target;
   update tlb.academy_portal_media set abandoned_at=coalesce(abandoned_at,now()) where submission_id=target;
  else
   select * into x from tlb.academy_messages where id=target for update;perform tlb.academy_assert(x.sender_id=u and not x.submitted);
   update tlb.academy_messages set cancelled_at=coalesce(cancelled_at,now()) where id=target;
   update tlb.academy_portal_media set abandoned_at=coalesce(abandoned_at,now()) where message_id=target;
  end if;return jsonb_build_object('cancelled',true);
 end if;
 if p_action='submit_work' or (p_action='reserve_media' and p_payload->>'purpose'='submission') then
  perform tlb.academy_assert(exists(select 1 from tlb.academy_submissions a where a.id=case p_action when 'submit_work' then target else (p_payload->>'submission_id')::uuid end and a.cancelled_at is null));
 end if;
 if p_action='send_message' or (p_action='reserve_media' and p_payload->>'purpose'='message') then
  perform tlb.academy_assert(exists(select 1 from tlb.academy_messages a where a.id=case p_action when 'send_message' then target else (p_payload->>'message_id')::uuid end and a.cancelled_at is null));
 end if;
 if p_action in ('start_thread','draft_submission') then
  if mid is not null then perform tlb.academy_assert(exists(select 1 from tlb.academy_modules a where a.id=mid and a.class_id=cid and a.visible and a.deleted_at is null));end if;
  if rid is not null then perform tlb.academy_assert(tlb.academy_recipe_visible(cid,rid));end if;
 end if;
 if p_action='accounts_page' then
  perform tlb.academy_assert(owner);perform tlb.require(size between 1 and 50 and length(search_text)<=160,'Choose a valid account search.');
  with matched as materialized (
   select au.id,au.email,tlb.academy_display_name(au.id) as name,coalesce(nullif(au.raw_user_meta_data->>'phone',''),nullif(to_jsonb(au)->>'phone',''),(select o.data#>>'{buyer,phone}' from tlb.orders o where o.user_id=au.id and nullif(o.data#>>'{buyer,phone}','') is not null order by o.created_at desc limit 1),'') as phone,
   (select count(*) from tlb.academy_enrollments e where e.user_id=au.id and e.status='active') as classes,
   (select coalesce(jsonb_agg(e.class_id order by e.class_id),'[]') from tlb.academy_enrollments e where e.user_id=au.id and e.status='active') as class_ids,
   exists(select 1 from tlb.staff st where st.user_id=au.id) as admin_account
   from auth.users au where (cid is null or exists(select 1 from tlb.academy_enrollments e where e.user_id=au.id and e.class_id=cid and e.status='active'))
  ), filtered as materialized(select * from matched a where (cid is not null or length(search_text)>=2) and (search_text='' or strpos(lower(coalesce(a.email,'')),lower(search_text))>0 or strpos(lower(a.name),lower(search_text))>0 or strpos(lower(a.phone),lower(search_text))>0)), page as(select * from filtered where cursor_id is null or id>cursor_id order by id limit size)
  select jsonb_build_object('accounts',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from page p),'total',(select count(*) from filtered),'next_cursor',case when exists(select 1 from filtered where id>(select id from page order by id desc limit 1)) then (select id from page order by id desc limit 1) end) into result;
  return result;
 end if;
 if p_action='assign_classes' then
  perform tlb.academy_assert(owner);perform tlb.require(jsonb_typeof(p_payload->'user_ids')='array' and jsonb_array_length(p_payload->'user_ids') between 1 and 200 and jsonb_typeof(p_payload->'class_ids')='array' and jsonb_array_length(p_payload->'class_ids') between 1 and 50,'Choose 1–200 accounts and 1–50 classes.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements_text(p_payload->'user_ids') a where not exists(select 1 from auth.users au where au.id=a.value::uuid)),'One of these accounts no longer exists.');
  perform 1 from tlb.academy_curricula a where a.id in(select value::uuid from jsonb_array_elements_text(p_payload->'class_ids')) order by a.id for share;
  perform tlb.require(not exists(select 1 from jsonb_array_elements_text(p_payload->'class_ids') a where not exists(select 1 from tlb.academy_curricula c where c.id=a.value::uuid and c.status='active')),'Choose active classes.');
  items:='[]';for x in select distinct value::uuid id from jsonb_array_elements_text(p_payload->'user_ids') order by id loop
   for y in select distinct value::uuid id from jsonb_array_elements_text(p_payload->'class_ids') order by id loop
    insert into tlb.academy_enrollments(user_id,class_id,assigned_by) values(x.id,y.id,u) on conflict(user_id,class_id) where status='active' do nothing;
    if found then n:=n+1;items:=items||jsonb_build_object('user_id',x.id,'class_id',y.id,'assigned',true);perform tlb.academy_log('class_assigned',x.id,jsonb_build_object('class_id',y.id));else existed:=existed+1;items:=items||jsonb_build_object('user_id',x.id,'class_id',y.id,'assigned',false);end if;
   end loop;
  end loop;return jsonb_build_object('assigned',n,'existing',existed,'reviewed',n+existed,'outcomes',items);
 end if;
 if p_action in ('set_module_visibility','delete_module','set_recipe_visibility','unlink_recipe','assign_recipe','reorder_recipes') then
  perform tlb.academy_assert(owner);perform 1 from tlb.academy_curricula where id=cid for update;perform tlb.academy_assert(found);
  if p_action in ('set_module_visibility','delete_module') then
   perform tlb.academy_assert(exists(select 1 from tlb.academy_modules where id=target and class_id=cid and deleted_at is null));
   if p_action='set_module_visibility' then perform tlb.require(jsonb_typeof(p_payload->'visible')='boolean','Choose visibility.');update tlb.academy_modules set visible=(p_payload->>'visible')::boolean where id=target;
   else update tlb.academy_modules set deleted_at=now(),visible=false where id=target;update tlb.academy_class_recipes set removed=true,visible=false where class_id=cid and module_id=target;end if;
  elsif p_action='assign_recipe' then
   if mid is not null then perform tlb.academy_assert(exists(select 1 from tlb.academy_modules where id=mid and class_id=cid and deleted_at is null));end if;
   insert into tlb.academy_class_recipes(class_id,recipe_id,module_id,sort_order) values(cid,rid,mid,(select coalesce(max(sort_order)+1,0) from tlb.academy_class_recipes where class_id=cid and module_id is not distinct from mid and not removed)) on conflict(class_id,recipe_id) do update set module_id=excluded.module_id,sort_order=excluded.sort_order,removed=false,visible=true;
  elsif p_action='reorder_recipes' then
   perform tlb.require(jsonb_typeof(p_payload->'ids')='array' and jsonb_array_length(p_payload->'ids')=(select count(*) from tlb.academy_class_recipes where class_id=cid and module_id is not distinct from mid and not removed) and jsonb_array_length(p_payload->'ids')=(select count(distinct value) from jsonb_array_elements_text(p_payload->'ids')) and not exists(select 1 from jsonb_array_elements_text(p_payload->'ids') a where not exists(select 1 from tlb.academy_class_recipes cr where cr.class_id=cid and cr.module_id is not distinct from mid and not cr.removed and cr.recipe_id=a.value::uuid)),'Reload the recipe list before reordering.');
   for x in select value::uuid id from jsonb_array_elements_text(p_payload->'ids') loop update tlb.academy_class_recipes set sort_order=position where class_id=cid and recipe_id=x.id;position:=position+1;end loop;
  else
   perform tlb.academy_assert(exists(select 1 from tlb.academy_class_recipes where class_id=cid and recipe_id=rid and not removed));
   if p_action='unlink_recipe' then update tlb.academy_class_recipes set removed=true,visible=false where class_id=cid and recipe_id=rid;
   else perform tlb.require(jsonb_typeof(p_payload->'visible')='boolean','Choose visibility.');update tlb.academy_class_recipes set visible=(p_payload->>'visible')::boolean where class_id=cid and recipe_id=rid;end if;
  end if;perform tlb.academy_log(p_action,coalesce(target,rid,cid));return jsonb_build_object('saved',true);
 end if;
 if p_action='duplicate_recipe' then
  perform tlb.academy_assert(owner);select * into rec from tlb.academy_student_recipes where id=target;perform tlb.academy_assert(rec.id is not null);
  insert into tlb.academy_student_recipes(title,document,source_version_id) values(coalesce(nullif(btrim(p_payload->>'title'),''),left(rec.title,171)||' (copy)'),rec.document,rec.source_version_id) returning * into rec;
  insert into tlb.academy_student_recipe_versions(recipe_id,version,title,document,saved_by) values(rec.id,1,rec.title,rec.document,u);
  perform tlb.academy_log('recipe_duplicated',rec.id,jsonb_build_object('source_recipe_id',target));return to_jsonb(rec);
 end if;
 if p_action in ('admin_recipes','admin_recipe') then
  perform tlb.academy_assert(owner);
  select coalesce(jsonb_agg((case p_action when 'admin_recipes' then jsonb_build_object('id',r.id,'title',r.title,'revision',r.revision) else to_jsonb(r) end)||jsonb_build_object('source',(select jsonb_build_object('version_id',v.id,'name',pr.name,'number',v.number) from tlb.recipe_versions v join tlb.recipes pr on pr.id=v.recipe_id where v.id=r.source_version_id),'used_in',(select coalesce(jsonb_agg(jsonb_build_object('class_id',c.id,'class_name',c.name,'module_id',cr.module_id,'module_name',mo.name,'visible',cr.visible and coalesce(mo.visible,true)) order by c.name),'[]') from tlb.academy_class_recipes cr join tlb.academy_curricula c on c.id=cr.class_id left join tlb.academy_modules mo on mo.id=cr.module_id where cr.recipe_id=r.id and not cr.removed),'media',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'path',a.path) order by a.sort_order,a.created_at,a.id),'[]') from tlb.academy_portal_media a where a.recipe_id=r.id and a.uploaded and a.abandoned_at is null)) order by r.title,r.id),'[]') into items from tlb.academy_student_recipes r where p_action='admin_recipes' or r.id=target;
  if p_action='admin_recipes' then return items;end if;
  return (items->0)||jsonb_build_object('versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.version desc),'[]') from tlb.academy_student_recipe_versions v where v.recipe_id=target));
 end if;
 if p_action='admin_media' then
  perform tlb.academy_assert(owner);
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'sort_order',a.sort_order,'is_cover',case a.purpose
   when 'class' then exists(select 1 from tlb.academy_curricula c where c.id=a.class_id and c.thumbnail_id=a.id)
   when 'module' then exists(select 1 from tlb.academy_modules mo where mo.id=a.module_id and mo.photo_ids[1]=a.id)
   when 'recipe' then a.id=(select aa.id from tlb.academy_portal_media aa where aa.recipe_id=a.recipe_id and aa.uploaded and aa.abandoned_at is null order by aa.sort_order,aa.created_at,aa.id limit 1)
   when 'announcement' then exists(select 1 from tlb.academy_announcements an where an.id=a.announcement_id and an.thumbnail_id=a.id)
   when 'upcoming' then exists(select 1 from tlb.academy_upcoming_classes up where up.id=a.upcoming_id and up.thumbnail_id=a.id) else false end) order by a.sort_order,a.created_at,a.id)
   from tlb.academy_portal_media a where a.uploaded and a.abandoned_at is null and a.purpose=p_payload->>'purpose'
   and (cid is null or a.class_id=cid) and (mid is null or a.module_id=mid) and (rid is null or a.recipe_id=rid)
   and (nullif(p_payload->>'announcement_id','') is null or a.announcement_id=(p_payload->>'announcement_id')::uuid)
   and (nullif(p_payload->>'upcoming_id','') is null or a.upcoming_id=(p_payload->>'upcoming_id')::uuid)),'[]');
 end if;
 if p_action in ('set_media_cover','remove_admin_media') then
  perform tlb.academy_assert(owner);select * into m from tlb.academy_portal_media where id=target for update;
  perform tlb.academy_assert(m.uploaded and m.abandoned_at is null and m.purpose in ('class','module','recipe','announcement','upcoming','instructor'));
  if p_action='remove_admin_media' then
   update tlb.academy_portal_media set abandoned_at=now() where id=target;
   update tlb.academy_curricula set thumbnail_id=null where thumbnail_id=target;
   update tlb.academy_modules set photo_ids=array_remove(photo_ids,target) where target=any(photo_ids);
   update tlb.academy_announcements set thumbnail_id=null where thumbnail_id=target;
   update tlb.academy_upcoming_classes set thumbnail_id=null where thumbnail_id=target;
   update tlb.academy_instructors set photo_id=null where photo_id=target;
  elsif m.purpose='module' then
   update tlb.academy_modules set photo_ids=array_prepend(target,array_remove(photo_ids,target)) where id=m.module_id;
   update tlb.academy_portal_media set sort_order=(select coalesce(min(a.sort_order),0)-1 from tlb.academy_portal_media a where a.module_id=m.module_id) where id=target;
  elsif m.purpose='recipe' then
   update tlb.academy_portal_media set sort_order=(select coalesce(min(a.sort_order),0)-1 from tlb.academy_portal_media a where a.recipe_id=m.recipe_id) where id=target;
  elsif m.purpose='instructor' then
   perform tlb.academy_assert(exists(select 1 from tlb.academy_instructors i where i.photo_id=target));
  else
   perform tlb.academy_portal_before_comparisons('attach_media',jsonb_build_object('id',target));
  end if;perform tlb.academy_log(p_action,target);return jsonb_build_object('saved',true);
 end if;
 if p_action='reorder_media' then
  perform tlb.academy_assert(owner);perform tlb.require(p_payload->>'purpose' in ('class','module','recipe','announcement','upcoming'),'Choose a photo album.');
  perform tlb.require(case p_payload->>'purpose' when 'class' then cid is not null when 'module' then mid is not null when 'recipe' then rid is not null when 'announcement' then nullif(p_payload->>'announcement_id','') is not null when 'upcoming' then nullif(p_payload->>'upcoming_id','') is not null else false end,'Choose one photo album.');
  perform pg_advisory_xact_lock(hashtextextended('academy-media:'||(p_payload-'ids')::text,0));
  items:=tlb.academy_comparison_api('admin_media',p_payload);
  perform tlb.require(jsonb_typeof(p_payload->'ids')='array' and jsonb_array_length(p_payload->'ids')=jsonb_array_length(items) and jsonb_array_length(p_payload->'ids')=(select count(distinct value) from jsonb_array_elements_text(p_payload->'ids')) and not exists(select 1 from jsonb_array_elements_text(p_payload->'ids') a where not exists(select 1 from jsonb_array_elements(items) b where b->>'id'=a.value)),'Reload this album before reordering.');
  for x in select value::uuid id from jsonb_array_elements_text(p_payload->'ids') loop update tlb.academy_portal_media set sort_order=position where id=x.id;position:=position+1;end loop;
  if p_payload->>'purpose'='module' then update tlb.academy_modules set photo_ids=array(select value::uuid from jsonb_array_elements_text(p_payload->'ids')) where id=mid;end if;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='attach_media' then perform tlb.academy_assert(exists(select 1 from tlb.academy_portal_media a where a.id=target and a.abandoned_at is null));end if;
 if p_action='admin_submissions_page' then
  perform tlb.academy_assert(owner or exists(select 1 from tlb.academy_instructors i where i.user_id=u and i.active));
  perform tlb.require(size between 1 and 50 and length(search_text)<=160,'Choose a valid submission search.');
  perform tlb.require(coalesce(p_payload->>'visibility','') in ('','gallery','instructor') and coalesce(p_payload->>'status','') in ('','pending','approved','hidden','archived','removed'),'Choose a submission filter.');
  with matched as materialized (
   select q.*,c.name class_name,tlb.academy_display_name(q.user_id) account_name,
   case when exists(select 1 from tlb.academy_instructors ai where ai.user_id=q.user_id and ai.active) then 'instructor' when tlb.role_for(q.user_id)='owner' then 'owner' else 'student' end as actor_role,
   exists(select 1 from tlb.academy_submission_reads sr where sr.submission_id=q.id and sr.user_id=u) as seen,
   (select t.id from tlb.academy_message_threads t where t.submission_id=q.id) as feedback_thread_id,
   (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'path',a.path) order by a.sort_order,a.created_at,a.id),'[]') from tlb.academy_portal_media a where a.submission_id=q.id and a.uploaded and a.abandoned_at is null) as media
   from tlb.academy_submissions q join tlb.academy_curricula c on c.id=q.class_id
   where q.submitted and (owner or tlb.academy_teaches(q.class_id)) and (cid is null or q.class_id=cid)
   and (coalesce(p_payload->>'status','')='' or q.moderation=p_payload->>'status')
   and (coalesce(p_payload->>'visibility','')='' or q.visibility=p_payload->>'visibility')
   and (search_text='' or strpos(lower(q.title),lower(search_text))>0 or strpos(lower(tlb.academy_display_name(q.user_id)),lower(search_text))>0)
  ), page as(select * from matched where cursor_id is null or id>cursor_id order by id limit size)
  select jsonb_build_object('submissions',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from page p),'total',(select count(*) from matched),'next_cursor',case when exists(select 1 from matched where id>(select id from page order by id desc limit 1)) then (select id from page order by id desc limit 1) end) into result;
  return result;
 end if;
 if p_action in ('moderate','reviewed_bulk_approve') then
  if p_action='moderate' then
   perform tlb.require(p_payload->>'status' in ('approved','hidden','archived','removed'),'Choose a moderation action.');items:=jsonb_build_array(target);
  else
   perform tlb.require(jsonb_typeof(p_payload->'ids')='array' and jsonb_array_length(p_payload->'ids') between 1 and 50 and jsonb_typeof(p_payload->'reviewed_ids')='array','Select up to 50 reviewed submissions.');
   items:=p_payload->'ids';perform tlb.require(not exists(select 1 from jsonb_array_elements_text(items) a where not exists(select 1 from jsonb_array_elements_text(p_payload->'reviewed_ids') b where b.value=a.value)),'Review every selected submission before approving.');
  end if;
  before_rows:='[]';after_rows:='[]';
  for x in select distinct value::uuid id from jsonb_array_elements_text(items) order by id loop
   select * into s from tlb.academy_submissions where id=x.id for update;
   perform tlb.academy_assert(s.submitted and (owner or tlb.academy_teaches(s.class_id)));
   perform tlb.require(s.visibility='gallery','Private submissions cannot be published to the gallery.');
   if p_action='reviewed_bulk_approve' then perform tlb.require(s.moderation='pending','This review changed. Reload before approving.');end if;
   before_rows:=before_rows||jsonb_build_object('id',s.id,'moderation',s.moderation,'moderated_by',s.moderated_by,'moderated_at',s.moderated_at,'published_at',s.published_at);
   update tlb.academy_submissions set moderation=case p_action when 'reviewed_bulk_approve' then 'approved' else p_payload->>'status' end,moderated_by=u,moderated_at=clock_timestamp(),published_at=case when p_action='reviewed_bulk_approve' or p_payload->>'status'='approved' then coalesce(published_at,now()) else published_at end where id=s.id returning * into s;
   after_rows:=after_rows||jsonb_build_object('id',s.id,'moderation',s.moderation,'moderated_by',s.moderated_by,'moderated_at',s.moderated_at,'published_at',s.published_at);
   perform tlb.academy_log('gallery_'||s.moderation,s.id);n:=n+1;
  end loop;
  insert into tlb.academy_moderation_undo(actor_id,before_state,after_state) values(u,before_rows,after_rows) returning academy_moderation_undo.token into token;
  return jsonb_build_object('saved',true,'approved',n,'undo_token',token);
 end if;
 if p_action='undo_moderation' then
  select * into undo_row from tlb.academy_moderation_undo mu where mu.token=(p_payload->>'undo_token')::uuid for update;
  perform tlb.academy_assert(undo_row.actor_id=u);perform tlb.require(undo_row.used_at is null and undo_row.created_at>now()-interval '15 minutes','This undo has expired or was already used.');
  for x in select value v from jsonb_array_elements(undo_row.after_state) order by value->>'id' loop
   select * into s from tlb.academy_submissions where id=(x.v->>'id')::uuid for update;
   perform tlb.academy_assert(s.submitted and s.visibility='gallery' and (owner or tlb.academy_teaches(s.class_id)));
   perform tlb.require(jsonb_build_object('id',s.id,'moderation',s.moderation,'moderated_by',s.moderated_by,'moderated_at',s.moderated_at,'published_at',s.published_at)=x.v,'This submission changed after your action. Reload before reviewing it.');
  end loop;
  for x in select value v from jsonb_array_elements(undo_row.before_state) loop
   update tlb.academy_submissions set moderation=x.v->>'moderation',moderated_by=nullif(x.v->>'moderated_by','')::uuid,moderated_at=nullif(x.v->>'moderated_at','')::timestamptz,published_at=nullif(x.v->>'published_at','')::timestamptz where id=(x.v->>'id')::uuid;
   perform tlb.academy_log('moderation_undone',(x.v->>'id')::uuid);
  end loop;
  update tlb.academy_moderation_undo set used_at=now() where tlb.academy_moderation_undo.token=undo_row.token;return jsonb_build_object('saved',true);
 end if;
 if p_action='instructor_attention' then
  perform tlb.academy_assert(owner or exists(select 1 from tlb.academy_instructors i where i.user_id=u and i.active));
  return jsonb_build_object('needs_reply',(select count(*) from tlb.academy_message_threads t join lateral(select a.sender_id from tlb.academy_messages a where a.thread_id=t.id and a.submitted order by a.created_at desc,a.id desc limit 1) latest on true where (owner or tlb.academy_teaches(t.class_id)) and not t.resolved and latest.sender_id=t.user_id),
  'pending_gallery',(select count(*) from tlb.academy_submissions a where a.submitted and a.visibility='gallery' and a.moderation='pending' and (owner or tlb.academy_teaches(a.class_id))),
  'private_unseen',(select count(*) from tlb.academy_submissions a where a.submitted and a.visibility='instructor' and a.moderation<>'removed' and (owner or tlb.academy_teaches(a.class_id)) and not exists(select 1 from tlb.academy_submission_reads sr where sr.submission_id=a.id and sr.user_id=u)));
 end if;
 if p_action in ('mark_submission_seen','submission_feedback') then
  select * into s from tlb.academy_submissions where id=target for update;
  perform tlb.academy_assert(s.submitted and s.moderation<>'removed' and (owner or tlb.academy_teaches(s.class_id)));
  insert into tlb.academy_submission_reads(submission_id,user_id) values(target,u) on conflict(submission_id,user_id) do update set seen_at=now();
  if p_action='mark_submission_seen' then return jsonb_build_object('saved',true);end if;
  perform tlb.require(length(btrim(p_payload->>'body')) between 1 and 10000,'Write feedback of up to 10,000 characters.');
  perform tlb.require(exists(select 1 from tlb.academy_enrollments e join tlb.academy_curricula c on c.id=e.class_id where e.class_id=s.class_id and e.user_id=s.user_id and e.status='active' and c.status='active'),'This account no longer has access to the class.');
  select t.id into rid from tlb.academy_message_threads t where t.submission_id=s.id;
  if rid is null then
   insert into tlb.academy_message_threads(user_id,class_id,instructor_id,module_id,recipe_id,subject,type,submission_id)
   select s.user_id,s.class_id,c.instructor_id,s.module_id,s.recipe_id,left('Feedback: '||s.title,160),'message',s.id from tlb.academy_curricula c where c.id=s.class_id returning id into rid;
  end if;
  insert into tlb.academy_messages(thread_id,sender_id,body,submitted) values(rid,u,btrim(p_payload->>'body'),true) returning id into mid;
  update tlb.academy_message_threads set last_activity=now(),resolved=false where id=rid;
  insert into tlb.outbox(event_key,event_type,to_email,subject,payload) select 'academy:reply:'||mid,'academy_notification',email,'New reply from your TLB Academy instructor',jsonb_build_object('event_type','academy_notification','title','Your instructor replied','class_id',s.class_id,'recipient_id',s.user_id,'student_reply',true,'preview','Private feedback on your student work is waiting in your Academy inbox.','url','https://thelittlebakerkitchen.com/academy/dashboard#thread/'||rid) from auth.users where id=s.user_id;
  perform tlb.academy_log('submission_feedback',s.id,jsonb_build_object('thread_id',rid));return jsonb_build_object('thread_id',rid,'id',mid,'sent',true);
 end if;
 if p_action='save_announcement' then
  if p_payload ? 'important' then perform tlb.require(jsonb_typeof(p_payload->'important')='boolean','Choose whether this announcement is important.');end if;
  return tlb.academy_portal_before_comparisons(p_action,p_payload);
 end if;
 if p_action='recipe' then
  result:=tlb.academy_portal_before_comparisons(p_action,p_payload);
  return result||jsonb_build_object('media',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'path',a.path) order by a.sort_order,a.created_at,a.id),'[]') from tlb.academy_portal_media a where a.recipe_id=target and a.uploaded and a.abandoned_at is null));
 end if;
 if p_action='broadcast_preview' then
  result:=tlb.academy_portal_before_comparisons(p_action,p_payload);
  with candidates as materialized (
   select au.id user_id,au.email,tlb.academy_display_name(au.id) name,au.email_confirmed_at,n.academy
   from auth.users au left join tlb.academy_newsletter_preferences n on n.user_id=au.id
   where (p_payload->>'audience'='subscribers' and n.academy) or
   (p_payload->>'audience'='selected' and (lower(au.email) in(select lower(btrim(value)) from jsonb_array_elements_text(coalesce(p_payload->'emails','[]'))) or au.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'user_ids','[]'))))) or
   (p_payload->>'audience' in ('students','class','instructor') and exists(select 1 from tlb.academy_enrollments e join tlb.academy_curricula c on c.id=e.class_id where e.user_id=au.id and e.status='active' and c.status='active' and (p_payload->>'audience'<>'class' or e.class_id=cid) and (p_payload->>'audience'<>'instructor' or c.instructor_id=nullif(p_payload->>'instructor_id','')::uuid)))
  ), eligible as materialized(select * from tlb.academy_recipients(p_payload)), excluded as (
   select c.user_id,c.email,c.name,case when nullif(c.email,'') is null then 'No email address' when c.email_confirmed_at is null then 'Email not confirmed' when p_payload->>'kind'='marketing' and c.academy is distinct from true then 'Not subscribed to Academy newsletter' else 'Not eligible' end reason from candidates c where not exists(select 1 from eligible e where e.user_id=c.user_id)
   union all select null::uuid,lower(btrim(a.value)),null::text,'Account not found' from (select distinct value from jsonb_array_elements_text(coalesce(p_payload->'emails','[]'))) a where p_payload->>'audience'='selected' and not exists(select 1 from auth.users au where lower(au.email)=lower(btrim(a.value)))
   union all select a.value::uuid,null::text,null::text,'Account not found' from (select distinct value from jsonb_array_elements_text(coalesce(p_payload->'user_ids','[]'))) a where p_payload->>'audience'='selected' and not exists(select 1 from auth.users au where au.id=a.value::uuid)
  ) select result||jsonb_build_object('audience',p_payload->>'audience','intended_count',(select count(*) from eligible)+(select count(*) from excluded),'matched',(select coalesce(jsonb_agg(jsonb_build_object('user_id',e.user_id,'email',e.email,'name',tlb.academy_display_name(e.user_id)) order by e.email,e.user_id),'[]') from eligible e),'excluded',(select coalesce(jsonb_agg(to_jsonb(e) order by e.email,e.user_id),'[]') from excluded e)) into result;
  return result;
 end if;
 if p_action='broadcast_send' and p_payload ? 'reviewed_user_ids' then
  perform tlb.academy_assert(owner);perform tlb.require(jsonb_typeof(p_payload->'reviewed_user_ids')='array','Review the recipients before sending.');
  perform tlb.require(not exists(select 1 from tlb.academy_recipients(p_payload) e where not exists(select 1 from jsonb_array_elements_text(p_payload->'reviewed_user_ids') a where a.value::uuid=e.user_id)) and not exists(select 1 from jsonb_array_elements_text(p_payload->'reviewed_user_ids') a where not exists(select 1 from tlb.academy_recipients(p_payload) e where e.user_id=a.value::uuid)),'The eligible recipients changed. Review the list again before sending.');
 end if;
 return tlb.academy_portal_before_comparisons(p_action,p_payload);
end $$;
revoke all on function tlb.academy_comparison_api(text,jsonb) from public,anon,authenticated,service_role;

create function public.academy_portal_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare k uuid; cached tlb.academy_action_requests; hashed text; result jsonb;
begin
 perform tlb.require(jsonb_typeof(p_payload)='object' and octet_length(p_payload::text)<1000000,'Request is too large.');
 if p_action='public_welcome' then return tlb.academy_comparison_api(p_action,'{}');end if;
 perform tlb.academy_assert(auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid()));
 if p_action in ('duplicate_recipe','submission_feedback') or (p_action in ('reserve_media','save_welcome_config') and p_payload ? 'idempotency_key') then
  if p_action in ('duplicate_recipe','save_welcome_config') then perform tlb.academy_assert(tlb.academy_owner());
  elsif p_action='reserve_media' then
   if p_payload->>'purpose'='submission' then perform tlb.academy_assert(exists(select 1 from tlb.academy_submissions s where s.id=(p_payload->>'submission_id')::uuid and s.user_id=auth.uid() and not s.submitted and s.cancelled_at is null and tlb.academy_enrolled(s.class_id)));
   elsif p_payload->>'purpose'='message' then perform tlb.academy_assert(exists(select 1 from tlb.academy_messages m where m.id=(p_payload->>'message_id')::uuid and m.sender_id=auth.uid() and not m.submitted and m.cancelled_at is null and tlb.academy_thread_access(m.thread_id)));
   else perform tlb.academy_assert(tlb.academy_owner());end if;
  else perform tlb.academy_assert(exists(select 1 from tlb.academy_submissions s where s.id=(p_payload->>'id')::uuid and s.submitted and s.moderation<>'removed' and (tlb.academy_owner() or tlb.academy_teaches(s.class_id))));end if;
  k:=nullif(p_payload->>'idempotency_key','')::uuid;perform tlb.require(k is not null,'Start this action again before saving.');
  perform pg_advisory_xact_lock(hashtextextended('academy-action:'||auth.uid()||':'||p_action||':'||k,0));hashed:=encode(extensions.digest((p_payload-'idempotency_key')::text,'sha256'),'hex');
  select * into cached from tlb.academy_action_requests where user_id=auth.uid() and action=p_action and key=k;
  if found then
   perform tlb.require(cached.request_hash=hashed,'This retry has different content. Start again.');
   if p_action='reserve_media' then perform public.academy_portal_upload_check((cached.response->>'id')::uuid);end if;
   return cached.response;
  end if;
  result:=tlb.academy_comparison_api(p_action,p_payload);
  insert into tlb.academy_action_requests(user_id,action,key,request_hash,response) values(auth.uid(),p_action,k,hashed,result);return result;
 end if;
 return tlb.academy_comparison_api(p_action,p_payload);
end $$;
revoke all on function public.academy_portal_api(text,jsonb) from public,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to anon,authenticated;
do $$ declare d text;begin
 d:=pg_get_functiondef('tlb.academy_backup_tables()'::regprocedure);
 perform tlb.require(strpos(d,'''academy_email_templates''')>0,'Review Academy backup tables before extending metadata.');
 execute tlb.academy_comparison_patch(d,'''academy_email_templates''','''academy_email_templates'',''academy_welcome_settings'',''academy_submission_reads''');
end $$;
drop function tlb.academy_comparison_patch(text,text,text);
commit;
