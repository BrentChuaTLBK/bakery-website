begin;
set local lock_timeout='3s';

-- The existing public Academy albums remain separate from protected curricula.
-- Every identity below references the existing TLB Auth/customer/admin account.
create table tlb.academy_instructors (
 user_id uuid primary key references tlb.staff(user_id), display_name text not null check(length(btrim(display_name)) between 1 and 120),
 title text not null default '', bio text not null default '', photo_id uuid,
 notification_email text, notifications boolean not null default true, active boolean not null default true,
 updated_at timestamptz not null default now()
);
create table tlb.academy_curricula (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 160),
 description text not null default '', instructor_id uuid references tlb.academy_instructors(user_id),
 public_class_id uuid references tlb.academy_classes(id), thumbnail_id uuid,
 notes text not null default '', products text[] not null default '{}',
 status text not null default 'draft' check(status in ('draft','active','hidden','archived')),
 sharing_enabled boolean not null default true, gallery_enabled boolean not null default true,
 require_approval boolean not null default true, revision bigint not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(status<>'active' or instructor_id is not null)
);
create index academy_curricula_instructor on tlb.academy_curricula(instructor_id,status);
create unique index academy_curricula_public on tlb.academy_curricula(public_class_id) where public_class_id is not null;
create table tlb.academy_modules (
 id uuid primary key default gen_random_uuid(), class_id uuid not null references tlb.academy_curricula(id),
 name text not null check(length(btrim(name)) between 1 and 160), description text not null default '',
 products text[] not null default '{}', notes text not null default '', tips text not null default '',
 photo_ids uuid[] not null default '{}', sort_order integer not null default 0,
 unique(class_id,id)
);
create index academy_modules_order on tlb.academy_modules(class_id,sort_order,id);
create table tlb.academy_enrollments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 class_id uuid not null references tlb.academy_curricula(id), assigned_at timestamptz not null default now(),
 assigned_by uuid not null references auth.users(id), removed_at timestamptz, removed_by uuid references auth.users(id),
 status text not null default 'active' check(status in ('active','revoked')),
 check((status='active' and removed_at is null and removed_by is null) or (status='revoked' and removed_at is not null and removed_by is not null))
);
create unique index academy_enrollment_active on tlb.academy_enrollments(user_id,class_id) where status='active';
create index academy_enrollment_class on tlb.academy_enrollments(class_id,status,user_id);
create index academy_enrollment_history on tlb.academy_enrollments(user_id,assigned_at desc);
create table tlb.academy_student_recipes (
 id uuid primary key default gen_random_uuid(), title text not null check(length(btrim(title)) between 1 and 180),
 document jsonb not null default '{}', revision bigint not null default 1,
 source_version_id uuid references tlb.recipe_versions(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index academy_recipe_source on tlb.academy_student_recipes(source_version_id);
create table tlb.academy_student_recipe_versions (
 recipe_id uuid not null references tlb.academy_student_recipes(id), version bigint not null,
 title text not null, document jsonb not null, saved_by uuid not null references auth.users(id), saved_at timestamptz not null default now(),
 primary key(recipe_id,version)
);
create table tlb.academy_class_recipes (
 class_id uuid not null references tlb.academy_curricula(id), recipe_id uuid not null references tlb.academy_student_recipes(id),
 module_id uuid, sort_order integer not null default 0, primary key(class_id,recipe_id),
 foreign key(class_id,module_id) references tlb.academy_modules(class_id,id)
);
create index academy_class_recipe_reverse on tlb.academy_class_recipes(recipe_id,class_id);
create index academy_class_recipe_module on tlb.academy_class_recipes(module_id);
create table tlb.academy_announcements (
 id uuid primary key default gen_random_uuid(), title text not null, summary text not null default '', content text not null default '',
 thumbnail_id uuid, cta text not null default '', cta_url text not null default '', publish_at timestamptz not null default now(),
 status text not null default 'draft' check(status in ('draft','published','hidden','archived')), revision bigint not null default 1
);
create index academy_announcement_feed on tlb.academy_announcements(status,publish_at desc);
create table tlb.academy_announcement_reads (
 user_id uuid not null references auth.users(id), announcement_id uuid not null references tlb.academy_announcements(id),
 read_at timestamptz not null default now(), primary key(user_id,announcement_id)
);
create index academy_announcement_read_reverse on tlb.academy_announcement_reads(announcement_id);
create table tlb.academy_upcoming_classes (
 id uuid primary key default gen_random_uuid(), title text not null, description text not null default '', products text[] not null default '{}',
 schedule text not null default '', starts_at timestamptz, thumbnail_id uuid, cta text not null default 'Inquire about this class', inquiry_url text not null default '',
 status text not null default 'draft' check(status in ('draft','published','hidden','archived')), revision bigint not null default 1
);
create index academy_upcoming_feed on tlb.academy_upcoming_classes(status,starts_at);
create table tlb.academy_submissions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), class_id uuid not null references tlb.academy_curricula(id),
 module_id uuid, recipe_id uuid, title text not null check(length(btrim(title)) between 1 and 160), caption text not null default '',
 category text not null default 'Other', visibility text not null check(visibility in ('gallery','instructor')),
 moderation text not null default 'pending' check(moderation in ('pending','approved','hidden','archived','removed')),
 submitted boolean not null default false, show_name boolean not null default true,
 created_at timestamptz not null default now(), published_at timestamptz, moderated_by uuid references auth.users(id), moderated_at timestamptz,
 foreign key(class_id,module_id) references tlb.academy_modules(class_id,id),
 foreign key(class_id,recipe_id) references tlb.academy_class_recipes(class_id,recipe_id)
);
create index academy_submission_owner on tlb.academy_submissions(user_id,created_at desc);
create index academy_submission_review on tlb.academy_submissions(class_id,moderation,created_at desc);
create index academy_gallery_feed on tlb.academy_submissions(published_at desc,id) where submitted and visibility='gallery' and moderation='approved';
create table tlb.academy_message_threads (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), class_id uuid not null references tlb.academy_curricula(id),
 instructor_id uuid not null references tlb.academy_instructors(user_id), module_id uuid, recipe_id uuid,
 subject text not null check(length(btrim(subject)) between 1 and 160), type text not null check(type in ('question','message')),
 resolved boolean not null default false, created_at timestamptz not null default now(), last_activity timestamptz not null default now(),
 foreign key(class_id,module_id) references tlb.academy_modules(class_id,id),
 foreign key(class_id,recipe_id) references tlb.academy_class_recipes(class_id,recipe_id)
);
create index academy_thread_owner on tlb.academy_message_threads(user_id,last_activity desc);
create index academy_thread_class on tlb.academy_message_threads(class_id,last_activity desc);
create index academy_thread_instructor on tlb.academy_message_threads(instructor_id,last_activity desc);
create table tlb.academy_messages (
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references tlb.academy_message_threads(id), sender_id uuid not null references auth.users(id),
 body text not null check(length(btrim(body)) between 1 and 10000), created_at timestamptz not null default now(), submitted boolean not null default false
);
create index academy_message_thread on tlb.academy_messages(thread_id,created_at,id);
create table tlb.academy_message_reads (
 thread_id uuid not null references tlb.academy_message_threads(id), user_id uuid not null references auth.users(id),
 read_at timestamptz not null default now(), primary key(thread_id,user_id)
);
create index academy_message_reader on tlb.academy_message_reads(user_id);
create table tlb.academy_portal_media (
 id uuid primary key default gen_random_uuid(), path text not null unique,
 user_id uuid not null references auth.users(id), class_id uuid references tlb.academy_curricula(id),
 submission_id uuid references tlb.academy_submissions(id), message_id uuid references tlb.academy_messages(id),
 announcement_id uuid references tlb.academy_announcements(id), upcoming_id uuid references tlb.academy_upcoming_classes(id), recipe_id uuid references tlb.academy_student_recipes(id),
 module_id uuid references tlb.academy_modules(id),
 purpose text not null check(purpose in ('submission','message','class','module','recipe','announcement','upcoming','instructor')),
 uploaded boolean not null default false, size_bytes integer not null check(size_bytes between 1 and 5242880),
 width integer not null check(width between 1 and 4096), height integer not null check(height between 1 and 4096),
 created_at timestamptz not null default now()
);
create index academy_media_submission on tlb.academy_portal_media(submission_id);
create index academy_media_message on tlb.academy_portal_media(message_id);
create index academy_media_class on tlb.academy_portal_media(class_id);
create index academy_media_recipe on tlb.academy_portal_media(recipe_id);
create index academy_media_announcement on tlb.academy_portal_media(announcement_id);
create index academy_media_upcoming on tlb.academy_portal_media(upcoming_id);
create index academy_media_module on tlb.academy_portal_media(module_id);
create index academy_media_owner on tlb.academy_portal_media(user_id,created_at);
create table tlb.academy_newsletter_preferences (
 user_id uuid primary key references auth.users(id), academy boolean not null default false, updated_at timestamptz not null default now(),
 consent_version text not null default 'academy-v1', unsubscribe_token text not null unique default encode(extensions.gen_random_bytes(32),'hex')
);
create table tlb.academy_audit (
 id bigint generated always as identity primary key, actor_id uuid not null references auth.users(id), action text not null, target_id uuid,
 detail jsonb not null default '{}', at timestamptz not null default now()
);
create index academy_audit_target on tlb.academy_audit(target_id,at desc);
create index academy_audit_actor on tlb.academy_audit(actor_id,at desc);
create table tlb.academy_broadcasts (
 id uuid primary key default gen_random_uuid(), subject text not null, body text not null,
 kind text not null check(kind in ('marketing','operational')), audience text not null,
 filter jsonb not null default '{}', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), recipients integer not null default 0
);

create function tlb.academy_owner() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(tlb.role_for(auth.uid())='owner',false)
$$;
create function tlb.academy_teaches(p_class uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from tlb.academy_curricula c join tlb.academy_instructors i on i.user_id=c.instructor_id where c.id=p_class and i.user_id=auth.uid() and i.active)
$$;
create function tlb.academy_enrolled(p_class uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from tlb.academy_enrollments e join tlb.academy_curricula c on c.id=e.class_id where e.user_id=auth.uid() and e.class_id=p_class and e.status='active' and c.status='active')
$$;
create function tlb.academy_class_access(p_class uuid) returns boolean language sql stable security definer set search_path='' as $$
 select tlb.academy_owner() or tlb.academy_teaches(p_class) or tlb.academy_enrolled(p_class)
$$;
create function tlb.academy_thread_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from tlb.academy_message_threads t where t.id=p_id and (tlb.academy_owner() or tlb.academy_teaches(t.class_id) or (t.user_id=auth.uid() and tlb.academy_enrolled(t.class_id))))
$$;
create function tlb.academy_display_name(p_user uuid,p_safe boolean default false) returns text language sql stable security definer set search_path='' as $$
 select case when p_safe then split_part(n,' ',1)||case when position(' ' in n)>0 then ' '||left(regexp_replace(n,'^.* ',''),1)||'.' else '' end else n end
 from(select coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),'TLB member') n from auth.users u where u.id=p_user) s
$$;
create function tlb.academy_log(p_action text,p_target uuid,p_detail jsonb default '{}') returns void language sql security invoker set search_path='' as $$
 insert into tlb.academy_audit(actor_id,action,target_id,detail) values(auth.uid(),p_action,p_target,p_detail)
$$;
create function tlb.academy_assert(p_ok boolean) returns void language plpgsql set search_path='' as $$
 begin if p_ok is distinct from true then raise exception 'This Academy content is not available to your account.' using errcode='42501';end if;end
$$;
create function tlb.academy_url(p_url text) returns text language plpgsql immutable set search_path='' as $$
 begin perform tlb.require(p_url='' or (p_url ~ '^https://[^[:space:]]+$' and p_url !~ '[<>"''\\]') or (p_url ~ '^/[^/\\]' and p_url !~ '[<>"''\\]'),'Use a secure website link.');return p_url;end
$$;

-- A field-by-field projection; never copy production documents wholesale.
create function tlb.academy_recipe_document(p_doc jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
 declare v jsonb;g jsonb;r jsonb;m jsonb;s jsonb;variants jsonb:='[]';groups jsonb;ingredients jsonb;methods jsonb;steps jsonb;baking jsonb;
 begin
 perform tlb.require(jsonb_typeof(p_doc)='object' and octet_length(p_doc::text)<500000,'Recipe is too large.');
 for v in select value from jsonb_array_elements(coalesce(p_doc->'variants','[]')) loop
 groups:='[]';methods:='[]';baking:='[]';
 for g in select value from jsonb_array_elements(coalesce(v->'groups','[]')) loop
 ingredients:='[]';for r in select value from jsonb_array_elements(coalesce(g->'ingredients','[]')) loop
 ingredients:=ingredients||jsonb_build_object('name',left(coalesce(r->>'name',''),200),'quantity',left(coalesce(r->>'quantity',''),60),'unit',left(coalesce(r->>'unit',''),40),'brand',left(coalesce(r->>'brand',''),120));end loop;
 groups:=groups||jsonb_build_object('name',left(coalesce(g->>'name',''),160),'ingredients',ingredients);end loop;
 for m in select value from jsonb_array_elements(coalesce(v->'methods','[]')) loop
 steps:='[]';for s in select value from jsonb_array_elements(coalesce(m->'steps','[]')) loop
 steps:=steps||jsonb_build_object('instruction',left(coalesce(s->>'instruction',''),10000),'temperature',left(coalesce(s->>'temperature',''),80),'timer_minutes',left(coalesce(s->>'timer_minutes',''),60),'equipment',left(coalesce(s->>'equipment',''),200));end loop;
 methods:=methods||jsonb_build_object('name',left(coalesce(m->>'name',''),160),'steps',steps);end loop;
 for s in select value from jsonb_array_elements(coalesce(v->'baking','[]')) loop
 baking:=baking||jsonb_build_object('name',left(coalesce(s->>'name',''),160),'top',left(coalesce(s->>'top',''),60),'bottom',left(coalesce(s->>'bottom',''),60),'fan',left(coalesce(s->>'fan',''),60),'minutes',left(coalesce(s->>'minutes',''),60),'core',left(coalesce(s->>'core',''),60));end loop;
 variants:=variants||jsonb_build_object('name',left(coalesce(v->>'name','Standard'),160),'yield',jsonb_build_object('quantity',left(coalesce(v#>>'{yield,quantity}',''),60),'unit',left(coalesce(v#>>'{yield,unit}',''),40),'pan_size',left(coalesce(v#>>'{yield,pan_size}',''),120)),'groups',groups,'methods',methods,'baking',baking,'equipment',coalesce((select jsonb_agg(left(case when jsonb_typeof(x)='string' then x#>>'{}' else x->>'name' end,200)) from jsonb_array_elements(coalesce(v->'equipment','[]'))x),'[]'));
 end loop;
 return jsonb_build_object('description',left(coalesce(p_doc->>'description',''),10000),'variants',variants,
 'notes',left(coalesce(p_doc->>'student_notes',''),10000),'tips',left(coalesce(p_doc->>'student_tips',''),10000));
 end $$;

create function public.academy_portal_media_readable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from tlb.academy_portal_media m where m.path=p_path and m.uploaded and (
 tlb.academy_owner() or
 (m.class_id is not null and tlb.academy_teaches(m.class_id) and (m.purpose not in ('submission','message') or exists(select 1 from tlb.academy_submissions s where s.id=m.submission_id and s.submitted) or exists(select 1 from tlb.academy_messages x where x.id=m.message_id and (x.submitted or x.sender_id=auth.uid())))) or
 (m.purpose='module' and tlb.academy_enrolled(m.class_id)) or
 (m.purpose='class' and tlb.academy_enrolled(m.class_id)) or
 (m.purpose='instructor' and exists(select 1 from tlb.academy_instructors i where i.photo_id=m.id and i.active)) or
 (m.purpose='recipe' and exists(select 1 from tlb.academy_class_recipes r where r.recipe_id=m.recipe_id and tlb.academy_class_access(r.class_id))) or
 (m.purpose='announcement' and exists(select 1 from tlb.academy_announcements a where a.id=m.announcement_id and a.status='published' and a.publish_at<=now())) or
 (m.purpose='upcoming' and exists(select 1 from tlb.academy_upcoming_classes u where u.id=m.upcoming_id and u.status='published')) or
 (m.purpose='submission' and exists(select 1 from tlb.academy_submissions s where s.id=m.submission_id and s.moderation<>'removed' and (
  (s.submitted and s.visibility='gallery' and s.moderation='approved') or (s.user_id=auth.uid() and tlb.academy_enrolled(s.class_id))))) or
 (m.purpose='message' and exists(select 1 from tlb.academy_messages x where x.id=m.message_id and tlb.academy_thread_access(x.thread_id) and (x.submitted or x.sender_id=auth.uid())))
 ))
$$;
revoke all on function public.academy_portal_media_readable(text) from public,anon;
grant execute on function public.academy_portal_media_readable(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('academy-student-media','academy-student-media',false,5242880,array['image/webp']);
create policy academy_portal_media_read on storage.objects for select to authenticated using(bucket_id='academy-student-media' and public.academy_portal_media_readable(name));
-- Uploads go through the validating Edge Function. No browser insert/update policy.

do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='tlb' and tablename=any(array['academy_instructors','academy_curricula','academy_modules','academy_enrollments','academy_student_recipes','academy_student_recipe_versions','academy_class_recipes','academy_announcements','academy_announcement_reads','academy_upcoming_classes','academy_submissions','academy_message_threads','academy_messages','academy_message_reads','academy_portal_media','academy_newsletter_preferences','academy_audit','academy_broadcasts']) loop
 execute format('alter table tlb.%I enable row level security',t.tablename);
 execute format('revoke all on tlb.%I from public,anon,authenticated',t.tablename);
 end loop;
end $$;
do $$ declare f record; begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tlb' and p.proname=any(array['academy_owner','academy_teaches','academy_enrolled','academy_class_access','academy_thread_access','academy_display_name','academy_log','academy_assert','academy_url','academy_recipe_document']) loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;

create function tlb.academy_class_card(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'thumbnail_id',c.thumbnail_id,'products',c.products,'instructor',i.display_name,'instructor_title',i.title,
 'module_count',(select count(*) from tlb.academy_modules m where m.class_id=c.id),
 'unread',(select count(*) from tlb.academy_messages m join tlb.academy_message_threads t on t.id=m.thread_id where t.class_id=c.id and t.user_id=auth.uid() and m.submitted and m.sender_id<>auth.uid() and m.created_at>coalesce((select read_at from tlb.academy_message_reads where thread_id=t.id and user_id=auth.uid()),'-infinity')))
 from tlb.academy_curricula c left join tlb.academy_instructors i on i.user_id=c.instructor_id where c.id=p_id
$$;
create function tlb.academy_gallery(p_class uuid default null,p_category text default null,p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(card order by published_at desc,id),'[]') from (
 select s.id,s.published_at,jsonb_build_object('id',s.id,'title',s.title,'caption',s.caption,'category',s.category,'class_name',c.name,'module_name',m.name,
 'recipe_title',r.title,'display_name',case when s.show_name then tlb.academy_display_name(s.user_id,true) else 'Academy member' end,'published_at',s.published_at,
 'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.path,'width',p.width,'height',p.height) order by p.created_at),'[]') from tlb.academy_portal_media p where p.submission_id=s.id and p.uploaded)) card
 from tlb.academy_submissions s join tlb.academy_curricula c on c.id=s.class_id left join tlb.academy_modules m on m.id=s.module_id left join tlb.academy_student_recipes r on r.id=s.recipe_id
 where s.submitted and s.visibility='gallery' and s.moderation='approved' and (p_class is null or s.class_id=p_class) and (p_category is null or s.category=p_category)
 order by s.published_at desc,s.id limit 24 offset greatest(0,least(p_offset,10000))) q
$$;
create function tlb.academy_notify(p_user uuid,p_class uuid,p_type text,p_preview text,p_target uuid,p_attachments boolean default false) returns void language plpgsql security invoker set search_path='' as $$
 declare c tlb.academy_curricula;i tlb.academy_instructors;recipient text;
 begin
 select * into c from tlb.academy_curricula where id=p_class;select * into i from tlb.academy_instructors where user_id=c.instructor_id;
 if i.user_id is null or not i.active or not i.notifications then return;end if;
 select coalesce(nullif(i.notification_email,''),email) into recipient from auth.users where id=i.user_id;
 insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('academy:'||p_type||':'||p_target,'academy_notification',recipient,'TLB Academy · '||p_type,
 jsonb_build_object('event_type','academy_notification','title',p_type,'account_name',tlb.academy_display_name(p_user),'class_name',c.name,'preview',left(p_preview,180),'attachments',p_attachments,'target_id',p_target,'class_id',p_class,'recipient_id',i.user_id,'url','https://thelittlebakerkitchen.com/academy/admin#inbox')) on conflict(event_key) do nothing;
 end $$;
alter table tlb.outbox drop constraint outbox_order_reference;
alter table tlb.outbox add constraint outbox_order_reference check (
 (event_type in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher','operational_alert','recipe_access_invitation','academy_notification','academy_broadcast','academy_invitation') and order_id is null)
 or (event_type not in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher','operational_alert','recipe_access_invitation','academy_notification','academy_broadcast','academy_invitation') and order_id is not null));

-- Recursively copy the selected saved component formulas without production pointers.
create function tlb.academy_import_document(p_version uuid,p_variant text default null,p_seen uuid[] default '{}') returns jsonb language plpgsql stable set search_path='' as $$
declare source jsonb; v jsonb; component jsonb; child jsonb; result jsonb; appended jsonb:='[]'; converted jsonb; idx integer:=0;
begin
 perform tlb.require(not p_version=any(p_seen) and cardinality(p_seen)<12,'Component links contain a cycle or exceed 12 levels.');
 select document into strict source from tlb.recipe_versions where id=p_version;
 if p_variant is not null then source:=jsonb_set(source,'{variants}',coalesce((select jsonb_agg(x) from jsonb_array_elements(source->'variants') x where x->>'id'=p_variant),'[]'));perform tlb.require(jsonb_array_length(source->'variants')=1,'A linked component size is missing.');end if;
 result:=tlb.academy_recipe_document(source);
 for v in select value from jsonb_array_elements(source->'variants') loop
  converted:=result->'variants'->idx;
  for component in select value from jsonb_array_elements(coalesce(v->'components','[]')) loop
   child:=tlb.academy_import_document((component->>'version_id')::uuid,component->>'variant_id',p_seen||p_version);
   converted:=jsonb_set(converted,'{groups}',(converted->'groups')||jsonb_build_object('name','Prepared components','ingredients',jsonb_build_array(jsonb_build_object('name',left(coalesce(component->>'name','Component'),200),'quantity',left(coalesce(component->>'quantity',''),60),'unit',left(coalesce(component->>'unit',''),40),'brand',''))));
   appended:=appended||coalesce((select jsonb_agg(jsonb_set(x,'{name}',to_jsonb(left(coalesce(component->>'name','Component')||' — '||coalesce(x->>'name','')||' (full formula; use '||coalesce(component->>'quantity','')||' '||coalesce(component->>'unit','')||' in '||coalesce(v->>'name','parent recipe')||')',160)))) from jsonb_array_elements(child->'variants') x),'[]');
  end loop;
  result:=jsonb_set(result,array['variants',idx::text],converted);idx:=idx+1;
 end loop;
 result:=jsonb_set(result,'{variants}',(result->'variants')||appended);
 perform tlb.require(octet_length(result::text)<500000,'Expanded recipe is too large.');return result;
end $$;
revoke all on function tlb.academy_import_document(uuid,text,uuid[]) from public,anon,authenticated,service_role;

create function public.academy_portal_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
 #variable_conflict use_variable
 declare u uuid:=auth.uid();id uuid:=nullif(p_payload->>'id','')::uuid;cid uuid:=nullif(p_payload->>'class_id','')::uuid;rid uuid;mid uuid;
 c tlb.academy_curricula;s tlb.academy_submissions;t tlb.academy_message_threads;m tlb.academy_messages;r tlb.academy_student_recipes;a tlb.academy_portal_media;
 doc jsonb;result jsonb;item jsonb;row record;counted integer:=0;owner boolean;instructor boolean;now_at timestamptz:=clock_timestamp();
 begin
 perform tlb.academy_assert(u is not null and exists(select 1 from auth.users where auth.users.id=u));
 perform tlb.require(jsonb_typeof(p_payload)='object' and octet_length(p_payload::text)<1000000,'Request is too large.');
 owner:=tlb.academy_owner();instructor:=exists(select 1 from tlb.academy_instructors where user_id=u and active);
 if p_action='dashboard' then
 return jsonb_build_object('name',tlb.academy_display_name(u),'admin',owner,'instructor',instructor,
 'classes',(select coalesce(jsonb_agg(tlb.academy_class_card(x.id) order by x.name),'[]') from tlb.academy_curricula x where tlb.academy_enrolled(x.id)),
 'announcements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.publish_at desc),'[]') from (select n.id,n.title,n.summary,n.thumbnail_id,n.publish_at,exists(select 1 from tlb.academy_announcement_reads ar where ar.user_id=u and ar.announcement_id=n.id) as read from tlb.academy_announcements n where n.status='published' and n.publish_at<=now() order by n.publish_at desc limit 30)x),
 'upcoming',(select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at nulls last),'[]') from(select * from tlb.academy_upcoming_classes where status='published' order by starts_at nulls last limit 30)x),
 'gallery',tlb.academy_gallery(),'academy_newsletter',coalesce((select academy from tlb.academy_newsletter_preferences where user_id=u),false));
 end if;
 if p_action='gallery' then return jsonb_build_object('posts',tlb.academy_gallery(cid,nullif(p_payload->>'category',''),coalesce((p_payload->>'offset')::int,0)),
 'classes',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name),'[]') from tlb.academy_curricula x where exists(select 1 from tlb.academy_submissions q where q.class_id=x.id and q.submitted and q.visibility='gallery' and q.moderation='approved')));end if;
 if p_action='announcement' then
 select to_jsonb(x) into result from tlb.academy_announcements x where x.id=id and x.status='published' and x.publish_at<=now();perform tlb.academy_assert(result is not null);
 insert into tlb.academy_announcement_reads(user_id,announcement_id) values(u,id) on conflict do nothing;return result;
 end if;
 if p_action='newsletter' then
 perform tlb.require(jsonb_typeof(p_payload->'academy')='boolean','Choose your Academy newsletter preference.');
 insert into tlb.academy_newsletter_preferences(user_id,academy) values(u,(p_payload->>'academy')::boolean) on conflict(user_id) do update set academy=excluded.academy,updated_at=now();
 return jsonb_build_object('academy',(p_payload->>'academy')::boolean);end if;
 if p_action='class' then
 perform tlb.academy_assert(tlb.academy_class_access(id));select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=id;
 return tlb.academy_class_card(id)||jsonb_build_object('notes',c.notes,'sharing_enabled',c.sharing_enabled,'gallery_enabled',c.gallery_enabled,'require_approval',c.require_approval,
 'modules',(select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.id),'[]') from tlb.academy_modules x where x.class_id=id),
 'recipes',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'module_id',cr.module_id) order by cr.sort_order,x.title),'[]') from tlb.academy_class_recipes cr join tlb.academy_student_recipes x on x.id=cr.recipe_id where cr.class_id=id),
 'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from(select q.id,q.title,q.visibility,q.moderation,q.submitted,q.created_at from tlb.academy_submissions q where q.class_id=id and q.user_id=u and q.moderation<>'removed' order by q.created_at desc limit 50)x));
 end if;
 if p_action='submission' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=id;
 perform tlb.academy_assert(s.moderation<>'removed' and ((s.user_id=u and tlb.academy_enrolled(s.class_id)) or owner or tlb.academy_teaches(s.class_id)));
 return jsonb_build_object('title',s.title,'caption',s.caption,'visibility',s.visibility,'moderation',s.moderation,'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id)),'[]') from tlb.academy_portal_media p where p.submission_id=id and p.uploaded));end if;
 if p_action='recipe' then
 perform tlb.academy_assert(tlb.academy_class_access(cid) and exists(select 1 from tlb.academy_class_recipes cr where cr.class_id=cid and cr.recipe_id=id));
 select jsonb_build_object('id',x.id,'title',x.title,'document',x.document,'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.path)),'[]') from tlb.academy_portal_media p where p.recipe_id=x.id and p.uploaded)) into result from tlb.academy_student_recipes x where x.id=id;return result;
 end if;
 if p_action='threads' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.last_activity desc) from(
 select q.id,q.class_id,q.subject,q.type,q.resolved,q.last_activity,cx.name as class_name,ix.display_name as instructor,
 (select count(*) from tlb.academy_messages mx where mx.thread_id=q.id and mx.submitted and mx.sender_id<>u and mx.created_at>coalesce((select read_at from tlb.academy_message_reads rr where rr.thread_id=q.id and rr.user_id=u),'-infinity')) as unread
 from tlb.academy_message_threads q join tlb.academy_curricula cx on cx.id=q.class_id left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id
 where tlb.academy_thread_access(q.id) and (cid is null or q.class_id=cid) order by q.last_activity desc limit 100)x),'[]');
 end if;
 if p_action='thread' then
 perform tlb.academy_assert(tlb.academy_thread_access(id));
 select to_jsonb(q)||jsonb_build_object('account_name',tlb.academy_display_name(q.user_id),'class_name',cx.name,'instructor',ix.display_name,
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',mx.id,'body',mx.body,'mine',mx.sender_id=u,'sender',case when mx.sender_id=q.user_id then tlb.academy_display_name(mx.sender_id) else coalesce((select display_name from tlb.academy_instructors where user_id=mx.sender_id),'Academy Admin') end,'created_at',mx.created_at,
 'media',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.path)),'[]') from tlb.academy_portal_media p where p.message_id=mx.id and p.uploaded)) order by mx.created_at,mx.id),'[]') from tlb.academy_messages mx where mx.thread_id=q.id and mx.submitted)) into result
 from tlb.academy_message_threads q join tlb.academy_curricula cx on cx.id=q.class_id left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id where q.id=id;
 insert into tlb.academy_message_reads(thread_id,user_id,read_at) values(id,u,now_at) on conflict(thread_id,user_id) do update set read_at=excluded.read_at;return result;
 end if;
 if p_action in ('start_thread','draft_reply') then
 perform tlb.require(length(btrim(p_payload->>'body')) between 1 and 10000,'Write a message of up to 10,000 characters.');
 if p_action='start_thread' then
 perform tlb.academy_assert(tlb.academy_enrolled(cid));select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=cid;
 perform tlb.academy_assert(exists(select 1 from tlb.academy_instructors where user_id=c.instructor_id and active));
 insert into tlb.academy_message_threads(user_id,class_id,instructor_id,module_id,recipe_id,subject,type) values(u,cid,c.instructor_id,nullif(p_payload->>'module_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,p_payload->>'subject',coalesce(p_payload->>'type','message')) returning * into t;
 else perform tlb.academy_assert(tlb.academy_thread_access(id));select * into strict t from tlb.academy_message_threads where tlb.academy_message_threads.id=id;end if;
 insert into tlb.academy_messages(thread_id,sender_id,body) values(t.id,u,p_payload->>'body') returning * into m;
 return jsonb_build_object('thread_id',t.id,'id',m.id,'class_id',t.class_id);end if;
 if p_action='send_message' then
 select * into m from tlb.academy_messages where tlb.academy_messages.id=id;perform tlb.academy_assert(m.sender_id=u and tlb.academy_thread_access(m.thread_id));
 select * into strict t from tlb.academy_message_threads where tlb.academy_message_threads.id=m.thread_id;
 if m.submitted then return jsonb_build_object('id',t.id,'sent',true);end if;
 perform tlb.require(not exists(select 1 from tlb.academy_portal_media x where x.message_id=id and not x.uploaded),'Finish or remove pending photo uploads before sending.');
 update tlb.academy_messages set submitted=true,created_at=now_at where tlb.academy_messages.id=id;
 update tlb.academy_message_threads set last_activity=now_at,resolved=false where tlb.academy_message_threads.id=t.id;
 if u=t.user_id then perform tlb.academy_notify(u,t.class_id,case t.type when 'question' then 'New question' else 'New message' end,m.body,m.id,exists(select 1 from tlb.academy_portal_media where message_id=m.id));
 else
 insert into tlb.outbox(event_key,event_type,to_email,subject,payload) select 'academy:reply:'||m.id,'academy_notification',email,'New reply from your TLB Academy instructor',jsonb_build_object('event_type','academy_notification','title','Your instructor replied','class_id',t.class_id,'recipient_id',t.user_id,'student_reply',true,'preview','A private reply is waiting in your Academy inbox.','url','https://thelittlebakerkitchen.com/academy/dashboard#thread/'||t.id) from auth.users where auth.users.id=t.user_id;
 end if;return jsonb_build_object('id',t.id,'sent',true);end if;
 if p_action='resolve_thread' then
 perform tlb.academy_assert(exists(select 1 from tlb.academy_message_threads where tlb.academy_message_threads.id=id and (owner or tlb.academy_teaches(class_id))));
 update tlb.academy_message_threads set resolved=coalesce((p_payload->>'resolved')::boolean,true) where tlb.academy_message_threads.id=id;return jsonb_build_object('saved',true);end if;
 if p_action='draft_submission' then
 perform tlb.academy_assert(tlb.academy_enrolled(cid));select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=cid;
 perform tlb.academy_assert(c.sharing_enabled and (p_payload->>'visibility'='instructor' or c.gallery_enabled));
 perform tlb.require(length(coalesce(p_payload->>'caption',''))<=5000,'Use a caption up to 5,000 characters.');
 insert into tlb.academy_submissions(user_id,class_id,module_id,recipe_id,title,caption,category,visibility,show_name) values(u,cid,nullif(p_payload->>'module_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,p_payload->>'title',coalesce(p_payload->>'caption',''),left(coalesce(p_payload->>'category','Other'),80),p_payload->>'visibility',coalesce((p_payload->>'show_name')::boolean,true)) returning * into s;return to_jsonb(s);end if;
 if p_action='submit_work' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=id;perform tlb.academy_assert(s.user_id=u and tlb.academy_enrolled(s.class_id));
 select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=s.class_id;perform tlb.academy_assert(c.sharing_enabled and (s.visibility='instructor' or c.gallery_enabled));
 if s.submitted then return to_jsonb(s);end if;
 perform tlb.require(exists(select 1 from tlb.academy_portal_media where submission_id=id and uploaded),'Add at least one photo.');
 perform tlb.require(not exists(select 1 from tlb.academy_portal_media where submission_id=id and not uploaded),'Finish or remove pending photo uploads before sharing.');
 update tlb.academy_submissions set submitted=true,moderation=case when s.visibility='gallery' and not c.require_approval then 'approved' else 'pending' end,published_at=case when s.visibility='gallery' and not c.require_approval then now() end where tlb.academy_submissions.id=id returning * into s;
 perform tlb.academy_notify(u,s.class_id,case s.visibility when 'instructor' then 'Private student submission' else 'Student work for review' end,s.caption,s.id,true);return to_jsonb(s);end if;
 if p_action='reserve_media' then
 id:=gen_random_uuid();
 if p_payload->>'purpose'='submission' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=(p_payload->>'submission_id')::uuid;
 perform tlb.academy_assert(s.user_id=u and not s.submitted and tlb.academy_enrolled(s.class_id));cid:=s.class_id;
 perform tlb.require((select count(*) from tlb.academy_portal_media where submission_id=s.id)<8,'Up to eight photos per submission.');
 elsif p_payload->>'purpose'='message' then
 select * into m from tlb.academy_messages where tlb.academy_messages.id=(p_payload->>'message_id')::uuid;
 perform tlb.academy_assert(m.sender_id=u and not m.submitted and tlb.academy_thread_access(m.thread_id));select class_id into cid from tlb.academy_message_threads where tlb.academy_message_threads.id=m.thread_id;
 perform tlb.require((select count(*) from tlb.academy_portal_media where message_id=m.id)<8,'Up to eight photos per message.');
 else perform tlb.academy_assert(owner);if p_payload->>'purpose'='module' then select class_id into strict cid from tlb.academy_modules where tlb.academy_modules.id=(p_payload->>'module_id')::uuid;end if;end if;
 insert into tlb.academy_portal_media(id,path,user_id,class_id,submission_id,message_id,announcement_id,upcoming_id,recipe_id,module_id,purpose,size_bytes,width,height)
 values(id,id||'.webp',u,cid,s.id,m.id,nullif(p_payload->>'announcement_id','')::uuid,nullif(p_payload->>'upcoming_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,nullif(p_payload->>'module_id','')::uuid,p_payload->>'purpose',(p_payload->>'size_bytes')::int,(p_payload->>'width')::int,(p_payload->>'height')::int) returning * into a;return to_jsonb(a);end if;
 if p_action='cancel_media' then
 select * into a from tlb.academy_portal_media where tlb.academy_portal_media.id=id;
 perform tlb.academy_assert(a.user_id=u and not a.uploaded);
 delete from tlb.academy_portal_media where tlb.academy_portal_media.id=id;return jsonb_build_object('removed',true);end if;
 if p_action='media' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'path',x.path)) from tlb.academy_portal_media x where x.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'ids','[]'))) and public.academy_portal_media_readable(x.path)),'[]');end if;

 -- Instructor access is scoped here before any administrative dataset is read.
 if p_action='admin_bootstrap' then
 perform tlb.academy_assert(owner or instructor);
 return jsonb_build_object('owner',owner,'instructor',instructor,'classes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') from tlb.academy_curricula x where owner or tlb.academy_teaches(x.id)),
 'instructors',(select coalesce(jsonb_agg(to_jsonb(i) order by i.display_name),'[]') from tlb.academy_instructors i where owner or i.user_id=u),
 'metrics',jsonb_build_object('active_classes',(select count(*) from tlb.academy_curricula x where x.status='active' and (owner or tlb.academy_teaches(x.id))),
 'archived_classes',(select count(*) from tlb.academy_curricula x where x.status='archived' and (owner or tlb.academy_teaches(x.id))),
 'active_instructors',(select count(*) from tlb.academy_instructors i where i.active and (owner or i.user_id=u)),
 'gallery_posts',(select count(*) from tlb.academy_submissions s where s.submitted and s.visibility='gallery' and s.moderation='approved' and (owner or tlb.academy_teaches(s.class_id))),
 'upcoming_classes',(select count(*) from tlb.academy_upcoming_classes where status='published'),
 'unread_messages',(select count(*) from tlb.academy_messages m join tlb.academy_message_threads t on t.id=m.thread_id where m.submitted and m.sender_id<>u and (owner or tlb.academy_teaches(t.class_id)) and m.created_at>coalesce((select read_at from tlb.academy_message_reads where thread_id=t.id and user_id=u),'-infinity')),
 'active_accounts',(select count(distinct e.user_id) from tlb.academy_enrollments e where e.status='active' and (owner or tlb.academy_teaches(e.class_id))),
 'accounts_with_history',(select count(distinct e.user_id) from tlb.academy_enrollments e where owner or tlb.academy_teaches(e.class_id)),
 'pending_gallery',(select count(*) from tlb.academy_submissions x where x.submitted and x.visibility='gallery' and x.moderation='pending' and (owner or tlb.academy_teaches(x.class_id))),
 'unanswered',(select count(*) from tlb.academy_message_threads q where not q.resolved and (owner or tlb.academy_teaches(q.class_id)) and not exists(select 1 from tlb.academy_messages mm where mm.thread_id=q.id and mm.submitted and mm.sender_id<>q.user_id)),
 'newsletter_subscribers',case when owner then(select count(*) from tlb.academy_newsletter_preferences where academy) else null end));end if;
 if p_action='admin_submissions' then
 perform tlb.academy_assert(owner or instructor);
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from(select q.*,cx.name as class_name,tlb.academy_display_name(q.user_id) as account_name,
 (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.path)),'[]') from tlb.academy_portal_media p where p.submission_id=q.id and p.uploaded) as media
 from tlb.academy_submissions q join tlb.academy_curricula cx on cx.id=q.class_id where q.submitted and (owner or tlb.academy_teaches(q.class_id)) and (cid is null or q.class_id=cid) and (nullif(p_payload->>'status','') is null or q.moderation=p_payload->>'status') order by q.created_at desc limit 100)x),'[]');end if;
 if p_action='moderate' then
 select * into s from tlb.academy_submissions where tlb.academy_submissions.id=id;perform tlb.academy_assert(s.submitted and (owner or tlb.academy_teaches(s.class_id)));
 perform tlb.require(s.visibility='gallery','Private submissions cannot be published to the gallery.');
 perform tlb.require(p_payload->>'status' in ('approved','hidden','archived','removed'),'Choose a moderation action.');
 update tlb.academy_submissions set moderation=p_payload->>'status',moderated_by=u,moderated_at=now(),published_at=case when p_payload->>'status'='approved' then coalesce(published_at,now()) else published_at end where tlb.academy_submissions.id=id;
 perform tlb.academy_log('gallery_'||(p_payload->>'status'),id);return jsonb_build_object('saved',true);end if;

 perform tlb.academy_assert(owner);
 if p_action='accounts' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.email) from(select au.id,au.email,tlb.academy_display_name(au.id) as name,coalesce(nullif(au.raw_user_meta_data->>'phone',''),nullif(to_jsonb(au)->>'phone',''),(select o.data#>>'{buyer,phone}' from tlb.orders o where o.user_id=au.id and nullif(o.data#>>'{buyer,phone}','') is not null order by o.created_at desc limit 1),'') as phone,
 (select count(*) from tlb.academy_enrollments e where e.user_id=au.id and e.status='active') as classes,
 exists(select 1 from tlb.staff st where st.user_id=au.id) as admin_account
 from auth.users au where length(btrim(coalesce(p_payload->>'query','')))>=2 and (au.email ilike '%'||(p_payload->>'query')||'%' or tlb.academy_display_name(au.id) ilike '%'||(p_payload->>'query')||'%' or coalesce(nullif(au.raw_user_meta_data->>'phone',''),nullif(to_jsonb(au)->>'phone',''),(select o.data#>>'{buyer,phone}' from tlb.orders o where o.user_id=au.id and nullif(o.data#>>'{buyer,phone}','') is not null order by o.created_at desc limit 1),'') ilike '%'||(p_payload->>'query')||'%') order by au.created_at desc limit 50)x),'[]');end if;
 if p_action='account' then
 return jsonb_build_object('id',id,'name',tlb.academy_display_name(id),'email',(select email from auth.users where auth.users.id=id),
 'phone',(select coalesce(nullif(au.raw_user_meta_data->>'phone',''),nullif(to_jsonb(au)->>'phone',''),(select o.data#>>'{buyer,phone}' from tlb.orders o where o.user_id=au.id and nullif(o.data#>>'{buyer,phone}','') is not null order by o.created_at desc limit 1),'') from auth.users au where au.id=id),
 'enrollments',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('class_name',cx.name,'instructor',ix.display_name) order by e.assigned_at desc),'[]') from tlb.academy_enrollments e join tlb.academy_curricula cx on cx.id=e.class_id left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id where e.user_id=id),
 'academy_newsletter',coalesce((select academy from tlb.academy_newsletter_preferences where user_id=id),false),
 'kitchen_newsletter',(select ns.status from tlb.newsletter_subscribers ns join auth.users au on lower(au.email)=ns.email where au.id=id),
 'submissions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select q.id,q.title,q.visibility,q.moderation,q.created_at from tlb.academy_submissions q where q.user_id=id order by q.created_at desc limit 100)x),
 'threads',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select q.id,q.subject,q.last_activity from tlb.academy_message_threads q where q.user_id=id order by q.last_activity desc limit 100)x));end if;
 if p_action='assign' then
 perform tlb.require(exists(select 1 from tlb.academy_curricula where tlb.academy_curricula.id=cid and status='active'),'Choose an active class.');
 perform tlb.require(jsonb_array_length(p_payload->'user_ids') between 1 and 200,'Select 1–200 accounts.');
 for rid in select value::uuid from jsonb_array_elements_text(p_payload->'user_ids') loop
 insert into tlb.academy_enrollments(user_id,class_id,assigned_by) values(rid,cid,u) on conflict(user_id,class_id) where status='active' do nothing;
 if found then counted:=counted+1;perform tlb.academy_log('class_assigned',rid,jsonb_build_object('class_id',cid));end if;
 end loop;return jsonb_build_object('assigned',counted);end if;
 if p_action='revoke' then
 update tlb.academy_enrollments set status='revoked',removed_by=u,removed_at=now() where tlb.academy_enrollments.id=id and status='active';
 if found then perform tlb.academy_log('class_revoked',id);end if;return jsonb_build_object('saved',true);end if;
 if p_action='save_instructor' then
 perform tlb.require(exists(select 1 from tlb.staff where user_id=id),'Choose an existing Admin account.');
 perform tlb.require(nullif(p_payload->>'notification_email','') is null or p_payload->>'notification_email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid notification email.');
 insert into tlb.academy_instructors(user_id,display_name,title,bio,notification_email,active,notifications) values(id,p_payload->>'display_name',coalesce(p_payload->>'title',''),coalesce(p_payload->>'bio',''),nullif(p_payload->>'notification_email',''),coalesce((p_payload->>'active')::boolean,true),coalesce((p_payload->>'notifications')::boolean,true))
 on conflict(user_id) do update set display_name=excluded.display_name,title=excluded.title,bio=excluded.bio,notification_email=excluded.notification_email,active=excluded.active,notifications=excluded.notifications,updated_at=now();
 perform tlb.academy_log('instructor_updated',id);return jsonb_build_object('saved',true);end if;
 if p_action='save_class' then
 if id is null then insert into tlb.academy_curricula(name) values(p_payload->>'name') returning * into c;id:=c.id;
 else select * into strict c from tlb.academy_curricula where tlb.academy_curricula.id=id for update;perform tlb.require(c.revision=(p_payload->>'revision')::bigint,'This class changed. Reload before saving.');end if;
 perform tlb.require(p_payload->>'status'<>'active' or exists(select 1 from tlb.academy_instructors where user_id=(p_payload->>'instructor_id')::uuid and active),'Assign an active instructor first.');
 update tlb.academy_curricula set name=p_payload->>'name',description=coalesce(p_payload->>'description',''),instructor_id=nullif(p_payload->>'instructor_id','')::uuid,
 status=coalesce(p_payload->>'status','draft'),notes=coalesce(p_payload->>'notes',''),products=array(select jsonb_array_elements_text(coalesce(p_payload->'products','[]'))),
 sharing_enabled=coalesce((p_payload->>'sharing_enabled')::boolean,true),gallery_enabled=coalesce((p_payload->>'gallery_enabled')::boolean,true),require_approval=coalesce((p_payload->>'require_approval')::boolean,true),
 revision=revision+1,updated_at=now() where tlb.academy_curricula.id=id returning * into c;
 perform tlb.academy_log('class_saved',id,jsonb_build_object('status',c.status,'instructor_id',c.instructor_id));return to_jsonb(c);end if;
 if p_action='save_module' then
 perform tlb.require(exists(select 1 from tlb.academy_curricula where tlb.academy_curricula.id=cid),'Choose a class.');
 if id is null then insert into tlb.academy_modules(class_id,name) values(cid,p_payload->>'name') returning tlb.academy_modules.id into id;end if;
 update tlb.academy_modules set name=p_payload->>'name',description=coalesce(p_payload->>'description',''),products=array(select jsonb_array_elements_text(coalesce(p_payload->'products','[]'))),notes=coalesce(p_payload->>'notes',''),tips=coalesce(p_payload->>'tips',''),sort_order=coalesce((p_payload->>'sort_order')::int,0) where tlb.academy_modules.id=id and class_id=cid;
 perform tlb.require(found,'Module was not found in this class.');perform tlb.academy_log('module_saved',id);return jsonb_build_object('id',id);end if;
 if p_action='reorder_modules' then
 for item in select value from jsonb_array_elements(p_payload->'ids') loop update tlb.academy_modules set sort_order=counted where tlb.academy_modules.id=(item#>>'{}')::uuid and class_id=cid;counted:=counted+1;end loop;return jsonb_build_object('saved',true);end if;
 if p_action='admin_recipes' then return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'revision',x.revision) order by x.title) from tlb.academy_student_recipes x),'[]');end if;
 if p_action='admin_recipe' then select to_jsonb(x)||jsonb_build_object('versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.version desc),'[]') from tlb.academy_student_recipe_versions v where v.recipe_id=x.id)) into result from tlb.academy_student_recipes x where x.id=id;return result;end if;
 if p_action='recipe_source_photos' then
 select source_version_id into rid from tlb.academy_student_recipes where tlb.academy_student_recipes.id=id;
 return coalesce((select jsonb_agg(jsonb_build_object('path',f.path,'name',f.filename)) from tlb.recipe_files f where f.uploaded and f.mime_type in ('image/jpeg','image/png','image/webp') and f.id in(
 select (p->>'file_id')::uuid from tlb.recipe_versions v cross join lateral jsonb_array_elements(coalesce(v.document->'photos','[]')||coalesce((select jsonb_agg(p) from jsonb_array_elements(v.document->'variants') x cross join lateral jsonb_array_elements(coalesce(x->'photos','[]')) p),'[]')) p where v.id=rid
 )),'[]');end if;
 if p_action='production_recipes' then
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select v.id as version_id,rp.name,v.number,v.status from tlb.recipe_versions v join tlb.recipes rp on rp.id=v.recipe_id where rp.deleted_at is null and rp.name ilike '%'||coalesce(p_payload->>'query','')||'%' order by rp.name,v.number desc limit 100)x),'[]');end if;
 if p_action in ('save_recipe','import_recipe') then
 if p_action='import_recipe' then
 rid:=(p_payload->>'version_id')::uuid;select document into strict doc from tlb.recipe_versions where tlb.recipe_versions.id=rid;
 insert into tlb.academy_student_recipes(title,document,source_version_id) values(coalesce(nullif(p_payload->>'title',''),doc->>'name'),tlb.academy_import_document(rid),rid) returning * into r;
 else
 doc:=tlb.academy_recipe_document(p_payload->'document');
 if id is null then insert into tlb.academy_student_recipes(title,document) values(p_payload->>'title',doc) returning * into r;
 else update tlb.academy_student_recipes set title=p_payload->>'title',document=doc,revision=revision+1,updated_at=now() where tlb.academy_student_recipes.id=id and revision=(p_payload->>'revision')::bigint returning * into r;perform tlb.require(found,'This recipe changed. Reload before saving.');end if;end if;
 insert into tlb.academy_student_recipe_versions(recipe_id,version,title,document,saved_by) values(r.id,r.revision,r.title,r.document,u);
 perform tlb.academy_log(p_action,r.id);return to_jsonb(r);end if;
 if p_action='assign_recipe' then
 insert into tlb.academy_class_recipes(class_id,recipe_id,module_id) values(cid,(p_payload->>'recipe_id')::uuid,nullif(p_payload->>'module_id','')::uuid) on conflict(class_id,recipe_id) do update set module_id=excluded.module_id;return jsonb_build_object('saved',true);end if;
 if p_action='unlink_recipe' then
 delete from tlb.academy_class_recipes cr where cr.class_id=cid and cr.recipe_id=(p_payload->>'recipe_id')::uuid;return jsonb_build_object('saved',true);end if;
 if p_action in ('admin_announcements','admin_upcoming','admin_broadcasts') then
 if p_action='admin_announcements' then return coalesce((select jsonb_agg(to_jsonb(x) order by x.publish_at desc) from tlb.academy_announcements x),'[]');
 elsif p_action='admin_upcoming' then return coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at nulls last) from tlb.academy_upcoming_classes x),'[]');
 else return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from(select * from tlb.academy_broadcasts order by created_at desc limit 100)x),'[]');end if;end if;
 if p_action='save_announcement' then
 if id is null then insert into tlb.academy_announcements(title) values(p_payload->>'title') returning tlb.academy_announcements.id into id;
 else perform tlb.require(exists(select 1 from tlb.academy_announcements x where x.id=id and x.revision=(p_payload->>'revision')::bigint),'Announcement changed. Reload before saving.');end if;
 update tlb.academy_announcements set title=p_payload->>'title',summary=coalesce(p_payload->>'summary',''),content=coalesce(p_payload->>'content',''),cta=coalesce(p_payload->>'cta',''),cta_url=tlb.academy_url(coalesce(p_payload->>'cta_url','')),status=p_payload->>'status',publish_at=coalesce(nullif(p_payload->>'publish_at','')::timestamptz,now()),revision=revision+1 where tlb.academy_announcements.id=id;
 perform tlb.academy_log('announcement_saved',id,jsonb_build_object('status',p_payload->>'status'));return jsonb_build_object('id',id);end if;
 if p_action='save_upcoming' then
 if id is null then insert into tlb.academy_upcoming_classes(title) values(p_payload->>'title') returning tlb.academy_upcoming_classes.id into id;
 else perform tlb.require(exists(select 1 from tlb.academy_upcoming_classes x where x.id=id and x.revision=(p_payload->>'revision')::bigint),'Upcoming class changed. Reload before saving.');end if;
 update tlb.academy_upcoming_classes set title=p_payload->>'title',description=coalesce(p_payload->>'description',''),products=array(select jsonb_array_elements_text(coalesce(p_payload->'products','[]'))),schedule=coalesce(p_payload->>'schedule',''),starts_at=nullif(p_payload->>'starts_at','')::timestamptz,cta=coalesce(p_payload->>'cta','Inquire about this class'),inquiry_url=tlb.academy_url(coalesce(p_payload->>'inquiry_url','')),status=p_payload->>'status',revision=revision+1 where tlb.academy_upcoming_classes.id=id;
 perform tlb.academy_log('upcoming_saved',id);return jsonb_build_object('id',id);end if;
 if p_action='attach_media' then
 select * into strict a from tlb.academy_portal_media where tlb.academy_portal_media.id=id and uploaded;
 if a.purpose='class' then update tlb.academy_curricula set thumbnail_id=a.id where tlb.academy_curricula.id=a.class_id;
 elsif a.purpose='module' then update tlb.academy_modules set photo_ids=array_append(array_remove(photo_ids,a.id),a.id) where tlb.academy_modules.id=a.module_id;
 elsif a.purpose='announcement' then update tlb.academy_announcements set thumbnail_id=a.id where tlb.academy_announcements.id=a.announcement_id;
 elsif a.purpose='upcoming' then update tlb.academy_upcoming_classes set thumbnail_id=a.id where tlb.academy_upcoming_classes.id=a.upcoming_id;
 elsif a.purpose='instructor' then update tlb.academy_instructors set photo_id=a.id where user_id=(p_payload->>'instructor_id')::uuid;end if;return jsonb_build_object('saved',true);end if;
 if p_action='invite' then
 perform tlb.require(p_payload->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid email.');
 id:=gen_random_uuid();insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('academy:invite:'||id,'academy_invitation',lower(btrim(p_payload->>'email')),'You are invited to TLB Academy',jsonb_build_object('event_type','academy_invitation','title','Welcome to TLB Academy','account_name',left(p_payload->>'name',120),'preview','Create your regular TLB account to access Academy updates and your assigned classes.','url','https://thelittlebakerkitchen.com/account.html?mode=signup&next=%2Facademy%2Fdashboard'));
 perform tlb.academy_log('account_invited',id);return jsonb_build_object('queued',true);end if;
 if p_action='analytics' then
 return jsonb_build_object('classes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.active_accounts desc),'[]') from(select cx.id,cx.name,cx.status,ix.display_name as instructor,(select count(*) from tlb.academy_enrollments e where e.class_id=cx.id and e.status='active') as active_accounts,(select count(*) from tlb.academy_enrollments e where e.class_id=cx.id) as historical_assignments from tlb.academy_curricula cx left join tlb.academy_instructors ix on ix.user_id=cx.instructor_id)x),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc),'[]') from(select a.*,tlb.academy_display_name(a.actor_id) as actor_name from tlb.academy_audit a order by at desc limit 100)x));end if;
 raise exception 'Unknown Academy action.' using errcode='22023';
 end $$;
revoke all on function public.academy_portal_api(text,jsonb) from public,anon,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to authenticated;
revoke all on function tlb.academy_class_card(uuid),tlb.academy_gallery(uuid,text,integer),tlb.academy_notify(uuid,uuid,text,text,uuid,boolean) from public,anon,authenticated;

alter table tlb.academy_portal_media add column sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$');
create function public.academy_portal_upload_check(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 declare m tlb.academy_portal_media;begin
 select * into m from tlb.academy_portal_media where id=p_id;
 perform tlb.academy_assert(m.user_id=auth.uid());
 if m.purpose='submission' then perform tlb.academy_assert(exists(select 1 from tlb.academy_submissions s where s.id=m.submission_id and not s.submitted and s.user_id=auth.uid() and tlb.academy_enrolled(s.class_id)));
 elsif m.purpose='message' then perform tlb.academy_assert(exists(select 1 from tlb.academy_messages x where x.id=m.message_id and not x.submitted and x.sender_id=auth.uid() and tlb.academy_thread_access(x.thread_id)));
 else perform tlb.academy_assert(tlb.academy_owner());end if;
 return to_jsonb(m);end $$;
revoke all on function public.academy_portal_upload_check(uuid) from public,anon,service_role;
grant execute on function public.academy_portal_upload_check(uuid) to authenticated;
create function public.academy_portal_confirm_upload(p_id uuid,p_user uuid,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
 declare m tlb.academy_portal_media;begin
 select * into strict m from tlb.academy_portal_media where id=p_id for update;
 perform tlb.academy_assert(m.user_id=p_user and p_sha256 ~ '^[a-f0-9]{64}$');
 perform tlb.academy_assert(tlb.role_for(p_user)='owner' or
 (m.purpose='submission' and exists(select 1 from tlb.academy_submissions s join tlb.academy_enrollments e on e.class_id=s.class_id and e.user_id=p_user join tlb.academy_curricula c on c.id=s.class_id where s.id=m.submission_id and not s.submitted and s.user_id=p_user and e.status='active' and c.status='active' and c.sharing_enabled)) or
 (m.purpose='message' and exists(select 1 from tlb.academy_messages x join tlb.academy_message_threads t on t.id=x.thread_id join tlb.academy_curricula c on c.id=t.class_id where x.id=m.message_id and not x.submitted and x.sender_id=p_user and
 ((t.user_id=p_user and c.status='active' and exists(select 1 from tlb.academy_enrollments e where e.user_id=p_user and e.class_id=c.id and e.status='active')) or (c.instructor_id=p_user and exists(select 1 from tlb.academy_instructors where user_id=p_user and active))))));
 perform tlb.require(not m.uploaded or m.sha256=p_sha256,'This photo already contains different data.');
 perform tlb.require(exists(select 1 from storage.objects where bucket_id='academy-student-media' and name=m.path),'Upload is missing.');
 update tlb.academy_portal_media set uploaded=true,sha256=p_sha256 where id=p_id;return jsonb_build_object('id',p_id,'uploaded',true);
 end $$;
revoke all on function public.academy_portal_confirm_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.academy_portal_confirm_upload(uuid,uuid,text) to service_role;

create function tlb.academy_recipients(p jsonb) returns table(user_id uuid,email text,unsubscribe_token text) language sql stable security invoker set search_path='' as $$
 select au.id,au.email,n.unsubscribe_token from auth.users au left join tlb.academy_newsletter_preferences n on n.user_id=au.id
 where au.email_confirmed_at is not null and (p->>'kind'='operational' or n.academy) and (
 (p->>'audience'='subscribers' and n.academy) or
 (p->>'audience'='selected' and lower(au.email) in(select lower(value) from jsonb_array_elements_text(coalesce(p->'emails','[]')))) or
 (p->>'audience' in ('students','class','instructor') and exists(select 1 from tlb.academy_enrollments e join tlb.academy_curricula c on c.id=e.class_id where e.user_id=au.id and e.status='active' and c.status='active'
  and (p->>'audience'<>'class' or e.class_id=nullif(p->>'class_id','')::uuid) and (p->>'audience'<>'instructor' or c.instructor_id=nullif(p->>'instructor_id','')::uuid)))
 )
$$;
alter table tlb.academy_broadcasts add column idempotency_key uuid unique;
alter function public.academy_portal_api(text,jsonb) rename to academy_portal_base;
alter function public.academy_portal_base(text,jsonb) set schema tlb;
revoke all on function tlb.academy_portal_base(text,jsonb) from public,anon,authenticated,service_role;
create function public.academy_portal_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
 declare b tlb.academy_broadcasts;r record;n integer;address text;
 begin
 if p_action='admin_media' then
 perform tlb.academy_assert(tlb.academy_owner());
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'path',m.path) order by m.created_at desc) from tlb.academy_portal_media m where m.uploaded and m.purpose=p_payload->>'purpose'
 and (nullif(p_payload->>'class_id','') is null or m.class_id=(p_payload->>'class_id')::uuid)
 and (nullif(p_payload->>'recipe_id','') is null or m.recipe_id=(p_payload->>'recipe_id')::uuid)
 and (nullif(p_payload->>'announcement_id','') is null or m.announcement_id=(p_payload->>'announcement_id')::uuid)
 and (nullif(p_payload->>'upcoming_id','') is null or m.upcoming_id=(p_payload->>'upcoming_id')::uuid)),'[]');end if;
 if p_action not in ('broadcast_preview','broadcast_send') then return tlb.academy_portal_base(p_action,p_payload);end if;
 perform tlb.academy_assert(tlb.academy_owner());
 perform tlb.require(p_payload->>'kind' in ('marketing','operational'),'Choose an email type.');
 perform tlb.require(p_payload->>'audience' in ('students','class','instructor','selected','subscribers'),'Choose recipients.');
 perform tlb.require(length(btrim(p_payload->>'subject')) between 1 and 160 and length(btrim(p_payload->>'body')) between 1 and 10000,'Add a subject and message.');
 perform tlb.require(p_payload->>'kind'<>'operational' or p_payload->>'audience'<>'subscribers','Subscriber broadcasts are marketing.');
 select count(*) into n from tlb.academy_recipients(p_payload);
 if p_action='broadcast_preview' then return jsonb_build_object('recipients',n);end if;
 perform tlb.require(n between 1 and 10000,'Choose 1–10,000 eligible recipients.');
 select data->>'pickup_address' into address from tlb.settings where id;
 perform tlb.require(p_payload->>'kind'<>'marketing' or length(btrim(address))>0,'Add your business address in TLB settings before sending marketing emails.');
 select * into b from tlb.academy_broadcasts where idempotency_key=(p_payload->>'idempotency_key')::uuid;if found then return to_jsonb(b);end if;
 insert into tlb.academy_broadcasts(subject,body,kind,audience,filter,created_by,recipients,idempotency_key) values(p_payload->>'subject',p_payload->>'body',p_payload->>'kind',p_payload->>'audience',p_payload-'subject'-'body',auth.uid(),n,(p_payload->>'idempotency_key')::uuid) returning * into b;
 for r in select * from tlb.academy_recipients(p_payload) loop
 insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('academy:broadcast:'||b.id||':'||r.user_id,'academy_broadcast',r.email,b.subject,
 jsonb_build_object('event_type','academy_broadcast','title',b.subject,'preview',b.body,'recipient_id',r.user_id,'broadcast_id',b.id,'marketing',b.kind='marketing','unsubscribe_token',case when b.kind='marketing' then r.unsubscribe_token end,'address',address,'url','https://thelittlebakerkitchen.com/academy/dashboard'));
 end loop;perform tlb.academy_log('broadcast_queued',b.id,jsonb_build_object('recipients',n,'kind',b.kind));return to_jsonb(b);
 end $$;
revoke all on function public.academy_portal_api(text,jsonb) from public,anon,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to authenticated;
revoke all on function tlb.academy_recipients(jsonb) from public,anon,authenticated,service_role;
create function public.academy_unsubscribe(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
 begin
 perform tlb.require(p_token ~ '^[a-f0-9]{64}$','Invalid preference link.');
 update tlb.academy_newsletter_preferences set academy=false,updated_at=now() where unsubscribe_token=p_token;
 return jsonb_build_object('unsubscribed',true);
 end $$;
revoke all on function public.academy_unsubscribe(text) from public;
grant execute on function public.academy_unsubscribe(text) to anon,authenticated,service_role;

-- Existing outbox leases/retries are retained. Consent and assignment are checked
-- again immediately before delivery, including messages queued before revocation.
create function tlb.academy_prepare_email(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare o tlb.outbox;allowed boolean:=true;recipient uuid;b tlb.academy_broadcasts;begin
 select * into o from tlb.outbox where id=(p_payload->>'id')::uuid for update;
 if o.event_type in ('academy_notification','academy_broadcast','academy_invitation') then
 perform tlb.require(o.status='sending' and o.lease_token=(p_payload->>'lease_token')::uuid and o.leased_until>now(),'Email lease expired.');
 recipient:=nullif(o.payload->>'recipient_id','')::uuid;
 if o.event_type='academy_broadcast' then
 select * into strict b from tlb.academy_broadcasts where id=(o.payload->>'broadcast_id')::uuid;
 allowed:=exists(select 1 from tlb.academy_recipients(b.filter) r where r.user_id=recipient and lower(r.email)=lower(o.to_email));
 elsif o.event_type='academy_notification' then
 if coalesce((o.payload->>'student_reply')::boolean,false) then
 allowed:=exists(select 1 from tlb.academy_enrollments e join tlb.academy_curricula c on c.id=e.class_id where e.user_id=recipient and e.class_id=(o.payload->>'class_id')::uuid and e.status='active' and c.status='active');
 else allowed:=exists(select 1 from tlb.academy_curricula c join tlb.academy_instructors i on i.user_id=c.instructor_id where c.id=(o.payload->>'class_id')::uuid and i.user_id=recipient and i.active and i.notifications);end if;
 end if;
 if not allowed then update tlb.outbox set status='skipped',last_error='Academy consent or access changed.',lease_token=null,leased_until=null where id=o.id;return jsonb_build_object('skip',true);end if;
 return to_jsonb(o);end if;return null;
 end $$;
revoke all on function tlb.academy_prepare_email(jsonb) from public,anon,authenticated,service_role;
-- Preserve the established gateway and its migration anchors. Add one narrow
-- Academy hook before its existing order/queue handling.
do $migration$
declare definition text:=replace(pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 hook text:=$hook$ if p_action='prepare_email' and exists(select 1 from tlb.outbox where id=(p_payload->>'id')::uuid and event_type in ('academy_notification','academy_broadcast','academy_invitation')) then return tlb.academy_prepare_email(p_payload);end if;
$hook$;
begin
 if position('perform pg_advisory_xact_lock(841721950318::bigint);' in definition)=0 then raise exception 'Review shop_service before adding Academy delivery';end if;
 execute replace(definition,'perform pg_advisory_xact_lock(841721950318::bigint);','perform pg_advisory_xact_lock(841721950318::bigint);'||chr(10)||hook);
end $migration$;
revoke all on function public.shop_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.shop_service(text,jsonb) to service_role;

create table tlb.academy_backup_connection (
 id boolean primary key default true check(id), enabled boolean not null default false,
 folder_id text not null default '1U_aOWdeTZU7P4M5IKsQR1UoKLjLoLCHG', service_account_email text,
 lease_token uuid, lease_until timestamptz, last_attempt_at timestamptz, last_success_at timestamptz,
 last_daily_at timestamptz,last_monthly_at timestamptz,last_error text,consecutive_failures integer not null default 0,
 current_job_id uuid, manual_requested boolean not null default false
);
insert into tlb.academy_backup_connection(id) values(true);
create table tlb.academy_backup_slots (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('daily','monthly','manual')),
 slot integer not null check(slot>0), drive_file_id text not null unique check(drive_file_id ~ '^[A-Za-z0-9_-]{15,150}$'),
 completed_at timestamptz, valid boolean not null default false, sha256 text, size_bytes bigint,
 record_count bigint,file_count bigint, unique(kind,slot),check(slot<=case kind when 'daily' then 30 when 'monthly' then 12 else 2 end)
);
create table tlb.academy_backup_jobs (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('daily','monthly','manual','download')),
 slot_id uuid references tlb.academy_backup_slots(id), source_slot_id uuid references tlb.academy_backup_slots(id),
 status text not null default 'running' check(status in ('running','success','failed','downloaded')),
 started_at timestamptz not null default now(), finished_at timestamptz,error text,record_count bigint not null default 0,file_count bigint not null default 0,
 completed_entries bigint not null default 0, created_by uuid references auth.users(id) on delete set null
);
alter table tlb.academy_backup_connection add foreign key(current_job_id) references tlb.academy_backup_jobs(id);
create index academy_backup_job_recent on tlb.academy_backup_jobs(started_at desc);
create index academy_backup_job_slot on tlb.academy_backup_jobs(slot_id);
create index academy_backup_job_source on tlb.academy_backup_jobs(source_slot_id);
create index academy_backup_job_author on tlb.academy_backup_jobs(created_by);
create table tlb.academy_backup_rows (
 sequence bigint generated always as identity primary key, job_id uuid not null references tlb.academy_backup_jobs(id) on delete cascade,
 table_key text not null, record_id text not null, data jsonb not null
);
create index academy_backup_row_page on tlb.academy_backup_rows(job_id,table_key,sequence);
create index academy_backup_row_lookup on tlb.academy_backup_rows(job_id,table_key,record_id);

create function tlb.academy_backup_tables() returns text[] language sql immutable set search_path='' as $$
 select array['academy_instructors','academy_curricula','academy_modules','academy_enrollments','academy_student_recipes','academy_student_recipe_versions','academy_class_recipes','academy_announcements','academy_announcement_reads','academy_upcoming_classes','academy_submissions','academy_portal_media','academy_message_threads','academy_messages','academy_message_reads','academy_newsletter_preferences','academy_audit','academy_broadcasts']
$$;
create function tlb.academy_backup_status() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',c.enabled,'folder_id',c.folder_id,'service_account_email',c.service_account_email,
 'last_attempt_at',c.last_attempt_at,'last_success_at',c.last_success_at,'last_daily_at',c.last_daily_at,'last_monthly_at',c.last_monthly_at,
 'last_error',c.last_error,'consecutive_failures',c.consecutive_failures,'busy',coalesce(c.lease_until>now(),false),'manual_requested',c.manual_requested,
 'schedule','Daily at 02:00 Asia/Manila; one monthly copy; checked every five minutes',
 'next_scheduled_at',case when c.last_daily_at is null or (c.last_daily_at at time zone 'Asia/Manila')::date<(now() at time zone 'Asia/Manila')::date
  then greatest(now(),((now() at time zone 'Asia/Manila')::date+time '02:00') at time zone 'Asia/Manila')
  else (((now() at time zone 'Asia/Manila')::date+1)+time '02:00') at time zone 'Asia/Manila' end,
 'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by kind,slot),'[]') from tlb.academy_backup_slots s),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j) order by started_at desc),'[]') from(select * from tlb.academy_backup_jobs order by started_at desc limit 20)j),
 'uploaded_file_bytes',(select coalesce(sum(size_bytes),0) from tlb.academy_portal_media where uploaded))
 from tlb.academy_backup_connection c where id
$$;
create function public.academy_backup_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform tlb.academy_assert(tlb.academy_owner());
 if p_action='status' then return tlb.academy_backup_status();end if;
 if p_action='request' then
  perform tlb.require(exists(select 1 from tlb.academy_backup_connection where id and enabled),'Connect the Drive backup before starting it.');
  update tlb.academy_backup_connection set manual_requested=true where id;return tlb.academy_backup_status();
 end if;
 if p_action='pause' then update tlb.academy_backup_connection set enabled=false where id;return tlb.academy_backup_status();end if;
 raise exception 'Unknown Academy backup action.';
end $$;
revoke all on function public.academy_backup_api(text,jsonb) from public,anon;
grant execute on function public.academy_backup_api(text,jsonb) to authenticated;

create function public.academy_backup_service(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c tlb.academy_backup_connection;s tlb.academy_backup_slots;source_slot tlb.academy_backup_slots;j tlb.academy_backup_jobs;
 token uuid;jid uuid;kind_name text;table_name text;statement text:='';expression text;snapshot_records bigint;snapshot_files bigint;slot_record jsonb;
begin
 if p_action='owner_access' then
  perform tlb.require(tlb.role_for((p_payload->>'user_id')::uuid)='owner','Recipe owner access required.');
  return jsonb_build_object('allowed',true,'connection',tlb.academy_backup_status());
 end if;
 if p_action='identify' then
  perform tlb.require(p_payload->>'email' ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$','Invalid service account identifier.');
  update tlb.academy_backup_connection set service_account_email=p_payload->>'email' where id;return jsonb_build_object('saved',true);
 end if;
 if p_action='connect' then
  select * into c from tlb.academy_backup_connection where id for update;
  perform tlb.require(c.lease_until is null or c.lease_until<now(),'A backup is running. Wait before changing its connection.');
  perform tlb.require(p_payload->>'folder_id'='1U_aOWdeTZU7P4M5IKsQR1UoKLjLoLCHG','Use the dedicated Academy backup folder.');
  for slot_record in select value from jsonb_array_elements(p_payload->'slots') loop
   perform tlb.require(not exists(select 1 from tlb.academy_backup_slots where kind=slot_record->>'kind' and slot=(slot_record->>'slot')::int and drive_file_id<>slot_record->>'drive_file_id'),'An existing backup slot points to another archive. Preserve or migrate it explicitly before reconnecting.');
   insert into tlb.academy_backup_slots(kind,slot,drive_file_id) values(slot_record->>'kind',(slot_record->>'slot')::int,slot_record->>'drive_file_id')
   on conflict(kind,slot) do update set drive_file_id=excluded.drive_file_id where tlb.academy_backup_slots.drive_file_id=excluded.drive_file_id;
  end loop;
  perform tlb.require((select count(*) from tlb.academy_backup_slots where kind='daily')>=30 and (select count(*) from tlb.academy_backup_slots where kind='monthly')>=12
   and (select count(*) from tlb.academy_backup_slots where kind='manual')>=2,'Provision 30 daily, 12 monthly and two manual archive files first.');
  update tlb.academy_backup_connection set enabled=true,folder_id=p_payload->>'folder_id' where id;return tlb.academy_backup_status();
 end if;
 if p_action='begin' then
  select * into c from tlb.academy_backup_connection where id for update;
  if c.lease_until>now() then return jsonb_build_object('skipped','busy');end if;
  if c.current_job_id is not null then
   update tlb.academy_backup_slots set valid=false where id in(select slot_id from tlb.academy_backup_jobs where id=c.current_job_id and status='running');
   update tlb.academy_backup_jobs set status='failed',error='interrupted',finished_at=now() where id=c.current_job_id and status='running';
   delete from tlb.academy_backup_rows where job_id=c.current_job_id;
  end if;
  kind_name:=p_payload->>'kind';
  if kind_name='download' then
   perform tlb.require(tlb.role_for((p_payload->>'user_id')::uuid)='owner','Owner access required.');
  else
   if not c.enabled then return jsonb_build_object('skipped','disconnected');end if;
   if kind_name='manual' or c.manual_requested then kind_name:='manual';
   elsif c.last_daily_at is null or ((c.last_daily_at at time zone 'Asia/Manila')::date<(now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::time>=time '02:00') then kind_name:='daily';
   elsif c.last_monthly_at is null or date_trunc('month',c.last_monthly_at at time zone 'Asia/Manila')<date_trunc('month',now() at time zone 'Asia/Manila') then kind_name:='monthly';
   else return jsonb_build_object('skipped','not_due');end if;
   select * into s from tlb.academy_backup_slots where kind=kind_name order by completed_at nulls first,slot limit 1 for update;
   perform tlb.require(s.id is not null,'No backup archive slot is available.');
   if kind_name='monthly' then
    select * into source_slot from tlb.academy_backup_slots where kind='daily' and valid order by completed_at desc limit 1;
    perform tlb.require(source_slot.id is not null,'A verified daily backup is required before the monthly copy.');
   end if;
  end if;
  token:=gen_random_uuid();jid:=gen_random_uuid();
  insert into tlb.academy_backup_jobs(id,kind,slot_id,source_slot_id,created_by) values(jid,kind_name,s.id,source_slot.id,nullif(p_payload->>'user_id','')::uuid);
  update tlb.academy_backup_connection set lease_token=token,lease_until=now()+interval '10 minutes',last_attempt_at=now(),current_job_id=jid,
   manual_requested=case when kind_name='manual' then false else manual_requested end where id;
  if kind_name<>'monthly' then
   -- All records are captured by ONE INSERT/SELECT statement, using one MVCC
   -- snapshot. Paging the staged rows cannot mix different formula versions.
   foreach table_name in array tlb.academy_backup_tables() loop
    expression:=case when table_name='academy_newsletter_preferences' then 'to_jsonb(t)-''unsubscribe_token''' else 'to_jsonb(t)' end;
    statement:=statement||case when statement='' then '' else ' union all ' end||format(
     'select %L::uuid,%L,coalesce(to_jsonb(t)->>''id'',to_jsonb(t)->>''user_id'',''''),%s from tlb.%I t',jid,table_name,expression,table_name);
   end loop;
   statement:=statement||format($actors$ union all select %L::uuid,'actors',u.id::text,jsonb_build_object('id',u.id,'email',u.email,'role',(select role from tlb.staff where user_id=u.id)) from auth.users u where u.id in(
    select user_id from tlb.academy_instructors union select user_id from tlb.academy_enrollments union select assigned_by from tlb.academy_enrollments union select removed_by from tlb.academy_enrollments union select user_id from tlb.academy_newsletter_preferences union select user_id from tlb.academy_submissions union select sender_id from tlb.academy_messages union select actor_id from tlb.academy_audit union select saved_by from tlb.academy_student_recipe_versions union select moderated_by from tlb.academy_submissions union select created_by from tlb.academy_broadcasts union select user_id from tlb.academy_message_threads union select instructor_id from tlb.academy_message_threads union select user_id from tlb.academy_message_reads union select user_id from tlb.academy_announcement_reads union select user_id from tlb.academy_portal_media
   )$actors$,jid);
   execute 'insert into tlb.academy_backup_rows(job_id,table_key,record_id,data) '||statement;
   select count(*),0::bigint into snapshot_records,snapshot_files from tlb.academy_backup_rows where job_id=jid;
  else snapshot_records:=source_slot.record_count;snapshot_files:=source_slot.file_count;end if;
  update tlb.academy_backup_jobs set record_count=snapshot_records,file_count=snapshot_files where id=jid;
  return jsonb_build_object('job_id',jid,'lease_token',token,'kind',kind_name,'drive_file_id',s.drive_file_id,'source_file_id',source_slot.drive_file_id,
   'source_sha256',source_slot.sha256,'source_bytes',source_slot.size_bytes,'generated_at',now(),'record_count',snapshot_records,'file_count',snapshot_files,'tables',to_jsonb(tlb.academy_backup_tables())||jsonb_build_array('actors'));
 end if;
 select * into c from tlb.academy_backup_connection where id for update;
 perform tlb.require(c.current_job_id=(p_payload->>'job_id')::uuid and c.lease_token=(p_payload->>'lease_token')::uuid and c.lease_until>now(),'Academy backup worker lease expired.');
 select * into j from tlb.academy_backup_jobs where id=c.current_job_id;
 if p_action='page' then
  perform tlb.require(p_payload->>'table'=any(tlb.academy_backup_tables()) or p_payload->>'table'='actors','Unknown backup table.');
  return (select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('sequence',sequence,'data',data) order by sequence),'[]')) from (
   select sequence,data from tlb.academy_backup_rows where job_id=j.id and table_key=p_payload->>'table' and sequence>coalesce((p_payload->>'after')::bigint,0)
   order by sequence limit least(20,greatest(1,coalesce((p_payload->>'limit')::int,10)))
  ) rows);
 elsif p_action='progress' then
  update tlb.academy_backup_jobs set completed_entries=greatest(completed_entries,coalesce((p_payload->>'entries')::bigint,0)) where id=j.id;
  return jsonb_build_object('saved',true);
 elsif p_action='finish' then
  if nullif(p_payload->>'error','') is not null then
   update tlb.academy_backup_jobs set status='failed',finished_at=now(),error=case when p_payload->>'error' in ('access','quota','network','checksum','file_missing','configuration','too_large','interrupted') then p_payload->>'error' else 'network' end where id=j.id;
   update tlb.academy_backup_slots set valid=false where id=j.slot_id;
   update tlb.academy_backup_connection set last_error=(select error from tlb.academy_backup_jobs where id=j.id),consecutive_failures=consecutive_failures+1,manual_requested=manual_requested or j.kind='manual' where id;
  else
   perform tlb.require(p_payload->>'sha256' ~ '^[a-f0-9]{64}$' and (p_payload->>'size_bytes')::bigint>22,'Confirm the complete archive checksum and size.');
   if j.kind='download' then update tlb.academy_backup_jobs set status='downloaded',finished_at=now() where id=j.id;
   else
    perform tlb.require(coalesce((p_payload->>'drive_verified')::boolean,false),'Google Drive must confirm the uploaded archive.');
    update tlb.academy_backup_slots set valid=true,completed_at=now(),sha256=p_payload->>'sha256',size_bytes=(p_payload->>'size_bytes')::bigint,
     record_count=j.record_count,file_count=j.file_count where id=j.slot_id;
    update tlb.academy_backup_jobs set status='success',finished_at=now() where id=j.id;
    update tlb.academy_backup_connection set last_success_at=now(),last_error=null,consecutive_failures=0,
     last_daily_at=case when j.kind='daily' then now() else last_daily_at end,last_monthly_at=case when j.kind='monthly' then now() else last_monthly_at end where id;
   end if;
  end if;
  delete from tlb.academy_backup_rows where job_id=j.id;
  update tlb.academy_backup_connection set lease_token=null,lease_until=null,current_job_id=null where id;
  return tlb.academy_backup_status();
 end if;
 raise exception 'Unknown Academy backup worker action.';
end $$;
revoke all on function public.academy_backup_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.academy_backup_service(text,jsonb) to service_role;
do $$ declare t text;begin
 foreach t in array array['academy_backup_connection','academy_backup_slots','academy_backup_jobs','academy_backup_rows'] loop
  execute format('alter table tlb.%I enable row level security',t);execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on function tlb.academy_backup_tables(),tlb.academy_backup_status() from public,anon,authenticated,service_role;

do $hosted$ begin
 if to_regnamespace('vault') is null then return;end if;
 execute $install$
do $$ begin
 if not exists(select 1 from vault.secrets where name='tlb_academy_backup_worker_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'tlb_academy_backup_worker_token','TLB private Academy backup worker only');
 end if;
end $$;
create function public.tlb_academy_backup_worker_authorized(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select coalesce(length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='tlb_academy_backup_worker_token'
  and extensions.digest(p_token,'sha256')=extensions.digest(decrypted_secret,'sha256')),false)
$$;
revoke all on function public.tlb_academy_backup_worker_authorized(text) from public,anon,authenticated;
grant execute on function public.tlb_academy_backup_worker_authorized(text) to service_role;
create function tlb.invoke_academy_backup_worker(p_force boolean default false) returns bigint language sql security invoker set search_path='' as $$
 select net.http_post(url:='https://aulhqofjjckwwjmdvqgi.supabase.co/functions/v1/academy-backup',
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='tlb_academy_backup_worker_token')),
  body:='{}'::jsonb,timeout_milliseconds:=10000)
 where p_force or exists(select 1 from tlb.academy_backup_connection where id and enabled and (lease_until is null or lease_until<now())
  and (manual_requested or last_daily_at is null or last_monthly_at is null or last_error is not null
   or ((last_daily_at at time zone 'Asia/Manila')::date<(now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::time>=time '02:00')
   or date_trunc('month',last_monthly_at at time zone 'Asia/Manila')<date_trunc('month',now() at time zone 'Asia/Manila')))
$$;
revoke all on function tlb.invoke_academy_backup_worker(boolean) from public,anon,authenticated,service_role;
select cron.schedule('tlb-academy-backup','*/5 * * * *','select tlb.invoke_academy_backup_worker();');
 $install$;
end $hosted$;

commit;
