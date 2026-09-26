begin;

create table if not exists tlb.academy_classes (
 id uuid primary key, draft jsonb not null, published jsonb,
 published_slug text unique, revision integer not null default 1,
 published_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists tlb.academy_settings (
 id boolean primary key default true check(id), draft jsonb not null,
 published jsonb, revision integer not null default 1
);
create table if not exists tlb.academy_assets (
 id uuid primary key, storage_path text not null unique,
 original_name text not null, width integer not null, height integer not null,
 created_at timestamptz not null default now(), created_by uuid not null,
 check(storage_path=id::text||'.webp'), check(length(original_name)<=200),
 check(width between 1 and 1600 and height between 1 and 1600)
);
alter table tlb.academy_classes enable row level security;
alter table tlb.academy_settings enable row level security;
alter table tlb.academy_assets enable row level security;
revoke all on tlb.academy_classes,tlb.academy_settings,tlb.academy_assets from public,anon,authenticated,service_role;

create or replace function tlb.academy_refs(doc jsonb) returns setof text
language sql immutable security invoker set search_path='' as $$
 select distinct value #>> '{}' from jsonb_path_query(coalesce(doc,'{}'),'$.**.asset_id') as value where jsonb_typeof(value)='string'
$$;
revoke all on function tlb.academy_refs(jsonb) from public,anon,authenticated,service_role;

create or replace function public.academy_media_readable(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from tlb.academy_assets a where a.storage_path=path and (
 tlb.role_for(auth.uid())='owner' or exists(select 1 from tlb.academy_classes c where c.published is not null and a.id::text in(select tlb.academy_refs(c.published)))))
$$;
revoke all on function public.academy_media_readable(text) from public;
grant execute on function public.academy_media_readable(text) to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('academy-photos','academy-photos',false,5242880,array['image/webp']) on conflict(id) do nothing;
-- Policy helper exposes only the caller's own authorization, not staff records.
create or replace function public.academy_is_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(tlb.role_for(auth.uid())='owner',false)
$$;
revoke all on function public.academy_is_owner() from public,anon;
grant execute on function public.academy_is_owner() to authenticated;
drop policy if exists academy_photo_read on storage.objects;
create policy academy_photo_read on storage.objects for select to anon,authenticated
using(bucket_id='academy-photos' and public.academy_media_readable(name));
drop policy if exists academy_photo_insert on storage.objects;
create policy academy_photo_insert on storage.objects for insert to authenticated
with check(bucket_id='academy-photos' and (select public.academy_is_owner()) and name ~ '^[0-9a-f-]{36}\.webp$');
-- No overwrite or browser delete: replacing a photo makes a new immutable asset.
-- Old published images remain valid while a replacement is still a draft.

create or replace function tlb.academy_check_photo(photo jsonb,batches jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if photo is null or photo='null'::jsonb then return; end if;
 perform tlb.require(jsonb_typeof(photo)='object' and exists(select 1 from tlb.academy_assets where id::text=photo->>'asset_id'),'Choose an uploaded Academy image.');
 perform tlb.require(length(coalesce(photo->>'caption',''))<=1000 and length(coalesce(photo->>'alt',''))<=300,'Photo captions or alt text are too long.');
 perform tlb.require(coalesce((photo->>'focal_x')::numeric,50) between 0 and 100 and coalesce((photo->>'focal_y')::numeric,50) between 0 and 100,'Photo focal point must be between 0 and 100.');
 perform tlb.require(coalesce(photo->>'batch_id','')='' or exists(select 1 from jsonb_array_elements(batches) b where b->>'id'=photo->>'batch_id'),'Photo batch must belong to this class.');
end $$;
create or replace function tlb.academy_validate(doc jsonb,publishing boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare v jsonb; p jsonb; key text; ids text[]:='{}'; batches jsonb:=coalesce(doc->'batches','[]');
begin
 perform tlb.require(jsonb_typeof(doc)='object' and octet_length(doc::text)<=2000000,'Class content must be under 2 MB.');
 perform tlb.require(length(trim(doc->>'title')) between 1 and 160,'Enter a class title.');
 perform tlb.require(doc->>'slug' ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(doc->>'slug')<=100,'Use a URL slug with lowercase letters, numbers and hyphens.');
 perform tlb.require(not(doc ? 'allow_photo_placeholders') or jsonb_typeof(doc->'allow_photo_placeholders')='boolean','Photo placeholders must be enabled or disabled.');
 foreach key in array array['category_label','short_description','description','module_description','instructor','location','age_group','duration','date_text','achievement'] loop
  perform tlb.require(length(coalesce(doc->>key,''))<=12000,'Class details are too long.');
 end loop;
 perform tlb.require(coalesce((doc->>'student_total')::integer,0) between 0 and 100000,'Enter a valid camp-wide student total.');
 foreach key in array array['creations','batches','videos'] loop
  perform tlb.require(jsonb_typeof(doc->key)='array' and jsonb_array_length(doc->key)<=200,'Class sections must contain at most 200 entries.');
  for v in select value from jsonb_array_elements(doc->key) loop
   perform tlb.require(v->>'id' ~ '^[0-9a-f-]{36}$' and not(v->>'id'=any(ids)),'Class items need unique identifiers.');
   ids:=array_append(ids,v->>'id');
  end loop;
 end loop;
 perform tlb.academy_check_photo(doc->'thumbnail',batches);perform tlb.academy_check_photo(doc->'hero',batches);
 if publishing and not coalesce((doc->>'allow_photo_placeholders')::boolean,false) then
  perform tlb.require(coalesce(doc#>>'{thumbnail,asset_id}','')<>'' and coalesce(doc#>>'{hero,asset_id}','')<>'','Add a thumbnail and hero photo before publishing.');
 end if;
 for v in select value from jsonb_array_elements(batches) loop
  perform tlb.academy_check_photo(v->'cover',batches);
  perform tlb.require(length(trim(v->>'label')) between 1 and 160,'Each batch needs a label.');
  perform tlb.require(length(coalesce(v->>'description',''))<=12000 and coalesce((v->>'student_count')::integer,0) between 0 and 100000,'Check the batch description and student count.');
  if coalesce(v->>'start_date','')<>'' then perform (v->>'start_date')::date; end if;
  if coalesce(v->>'end_date','')<>'' then perform (v->>'end_date')::date; end if;
  perform tlb.require(coalesce(v->>'end_date','')='' or coalesce(v->>'start_date','')='' or (v->>'end_date')::date>=(v->>'start_date')::date,'Batch end date must follow its start date.');
 end loop;
 for v in select value from jsonb_array_elements(doc->'creations') union all select value from jsonb_array_elements(batches) loop
  perform tlb.require(length(coalesce(v->>'name',''))<=160 and length(coalesce(v->>'description',''))<=12000,'Creation details are too long.');
  perform tlb.require(jsonb_typeof(v->'photos')='array' and jsonb_array_length(v->'photos')<=500,'An album can contain up to 500 photos.');
  for p in select value from jsonb_array_elements(v->'photos') loop perform tlb.academy_check_photo(p,batches); end loop;
 end loop;
 for v in select value from jsonb_array_elements(doc->'videos') loop
  perform tlb.require(v->>'url' ~ '^https://www\.instagram\.com/(p|reel)/[A-Za-z0-9_-]+/$','Paste a supported Instagram Reel or post URL.');
  perform tlb.require(length(coalesce(v->>'title',''))<=200,'Video title is too long.');
  perform tlb.require(coalesce(v->>'batch_id','')='' or exists(select 1 from jsonb_array_elements(batches) b where b->>'id'=v->>'batch_id'),'Video batch must belong to this class.');
  perform tlb.academy_check_photo(v->'cover',batches);
 end loop;
end $$;
revoke all on function tlb.academy_check_photo(jsonb,jsonb),tlb.academy_validate(jsonb,boolean) from public,anon,authenticated,service_role;

create or replace function public.academy_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c tlb.academy_classes; cfg tlb.academy_settings; target uuid; doc jsonb; result jsonb; asset tlb.academy_assets;
begin
 select * into cfg from tlb.academy_settings where id;
 if p_action='catalog' then
  return jsonb_build_object('settings',coalesce(cfg.published,'{}'),'classes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'content',published)) from tlb.academy_classes where published is not null),'[]'));
 elsif p_action='class' then
  select published||jsonb_build_object('id',id) into result from tlb.academy_classes where published_slug=p_payload->>'slug' and published is not null;
  return jsonb_build_object('content',result,'settings',coalesce(cfg.published,'{}'));
 elsif p_action='assets' then
  perform tlb.require(jsonb_typeof(p_payload->'ids')='array' and jsonb_array_length(p_payload->'ids')<=1000,'Request up to 1,000 images at a time.');
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'storage_path',storage_path,'width',width,'height',height)),'[]') into result from tlb.academy_assets where id::text in(select jsonb_array_elements_text(p_payload->'ids')) and public.academy_media_readable(storage_path);
  return result;
 end if;
 perform tlb.assert_staff(u,true);
 if p_action='admin' then
  return jsonb_build_object('settings',to_jsonb(cfg),'classes',coalesce((select jsonb_agg(to_jsonb(x) order by updated_at,id) from tlb.academy_classes x),'[]'),'assets',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from tlb.academy_assets x),'[]'));
 elsif p_action='preview' then
  select draft||jsonb_build_object('id',id) into result from tlb.academy_classes where id=(p_payload->>'id')::uuid;
  return jsonb_build_object('content',result,'settings',cfg.draft);
 end if;
 perform pg_advisory_xact_lock(841721950320::bigint);
 if p_action in ('save_settings','publish_settings') then
  select * into cfg from tlb.academy_settings where id for update;
  perform tlb.require(cfg.revision=(p_payload->>'revision')::integer,'Academy settings changed. Reload before saving.');
  if p_action='save_settings' then
   doc:=p_payload->'content';
   perform tlb.require(jsonb_typeof(doc)='object' and octet_length(doc::text)<=100000,'Check the landing-page settings.');
   perform tlb.require(length(trim(doc->>'heading')) between 1 and 160 and length(coalesce(doc->>'description',''))<=4000,'Enter a heading and a shorter description.');
   perform tlb.require(doc->>'enquiry_url' ~ '^https://[^[:space:]<>"\\]+$' and length(doc->>'enquiry_url')<=1000,'Use an HTTPS enquiry link.');
   perform tlb.require(length(coalesce(doc->>'enquiry_heading',''))<=160 and length(coalesce(doc->>'enquiry_text',''))<=4000,'Enquiry copy is too long.');
   perform tlb.require(jsonb_typeof(doc->'class_order')='array' and jsonb_array_length(doc->'class_order')<=1000,'Check class ordering.');
   update tlb.academy_settings set draft=doc,revision=revision+1 where id returning to_jsonb(tlb.academy_settings.*) into result;
  else
   update tlb.academy_settings set published=draft,revision=revision+1 where id returning to_jsonb(tlb.academy_settings.*) into result;
  end if;
  return result;
 elsif p_action='register_asset' then
  target:=(p_payload->>'id')::uuid;
  perform tlb.require(exists(select 1 from storage.objects where bucket_id='academy-photos' and name=target::text||'.webp'),'Upload the image before adding it to the library.');
  insert into tlb.academy_assets(id,storage_path,original_name,width,height,created_by) values(target,target::text||'.webp',left(coalesce(p_payload->>'name','Photo'),200),(p_payload->>'width')::int,(p_payload->>'height')::int,u)
  on conflict(id) do nothing;
  select to_jsonb(a) into result from tlb.academy_assets a where id=target;return result;
 end if;
 target:=(p_payload->>'id')::uuid;
 perform tlb.require(target is not null,'Choose a class.');
 select * into c from tlb.academy_classes where id=target for update;
 perform tlb.require(coalesce(c.revision,0)=(p_payload->>'revision')::integer,'This class changed. Reload before saving.');
 if p_action='save_class' then
  doc:=p_payload->'content';perform tlb.academy_validate(doc);
  perform tlb.require(c.published_slug is null or doc->>'slug'=c.published_slug,'Published class URLs stay fixed. Create another class for a different URL.');
  perform tlb.require(not exists(select 1 from tlb.academy_classes where id<>target and (draft->>'slug'=doc->>'slug' or published_slug=doc->>'slug')),'That URL slug is already in use.');
  insert into tlb.academy_classes(id,draft) values(target,doc) on conflict(id) do update set draft=excluded.draft,revision=tlb.academy_classes.revision+1,updated_at=now() returning to_jsonb(tlb.academy_classes.*) into result;
 elsif p_action='publish_class' then
  perform tlb.require(c.id is not null,'Class not found.');perform tlb.academy_validate(c.draft,true);
  update tlb.academy_classes set published=draft,published_slug=draft->>'slug',published_at=now(),revision=revision+1,updated_at=now() where id=target returning to_jsonb(tlb.academy_classes.*) into result;
 elsif p_action='unpublish_class' then
  perform tlb.require(c.id is not null,'Class not found.');
  update tlb.academy_classes set published=null,published_at=null,revision=revision+1,updated_at=now() where id=target returning to_jsonb(tlb.academy_classes.*) into result;
 elsif p_action='delete_class' then
  perform tlb.require(c.id is not null,'Class not found.');delete from tlb.academy_classes where id=target;result:='{}';
 else raise exception 'Unknown Academy action.' using errcode='22023';end if;
 return result;
end $$;
revoke all on function public.academy_api(text,jsonb) from public;
grant execute on function public.academy_api(text,jsonb) to anon,authenticated;

insert into tlb.academy_classes(id,draft)
select id::uuid,jsonb_build_object('title',title,'slug',slug,'category_label',case n when 1 then 'Baking camp' when 2 then 'Baking class' else 'Decorating class' end,'short_description',description,'description','','module_description','','instructor','','location','','age_group','','duration','','date_text','','achievement',case when n=1 then '102 students joined the 2nd Summer Baking Camp.' else '' end,'student_total',case when n=1 then 102 else null end,'allow_photo_placeholders',true,'thumbnail',null,'hero',null,'creations','[]'::jsonb,'batches','[]'::jsonb,'videos','[]'::jsonb)
from (values(1,'a0000000-0000-4000-8000-000000000001','2nd Summer Baking Camp','2nd-summer-baking-camp','A look back at our summer baking camp.'),(2,'a0000000-0000-4000-8000-000000000002','Cookies & Brownies','cookies-and-brownies','One class covering cookies and brownies.'),(3,'a0000000-0000-4000-8000-000000000003','Animal Cupcake Decorating','animal-cupcake-decorating','A class in animal cupcake decorating.')) s(n,id,title,slug,description) on conflict(id) do nothing;
insert into tlb.academy_settings(id,draft) values(true,'{"heading":"Little bakers. Big creations.","description":"Discover what our students made, then step inside the kitchen to see how it all came together.","enquiry_heading":"Your next sweet adventure?","enquiry_text":"Ask us about upcoming classes at TLB Academy.","enquiry_url":"https://www.instagram.com/tlbacademy/","featured_id":"a0000000-0000-4000-8000-000000000001","class_order":["a0000000-0000-4000-8000-000000000001","a0000000-0000-4000-8000-000000000002","a0000000-0000-4000-8000-000000000003"]}') on conflict(id) do nothing;
commit;
