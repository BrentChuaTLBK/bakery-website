-- Large camp albums must not rescan all published references once per requested asset.
-- Preserve owner draft access, published-only visitor access, existing function grants and signatures.
CREATE OR REPLACE FUNCTION public.academy_api(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  with published_refs as materialized (
   select tlb.academy_refs(published) as asset_id from tlb.academy_classes where published is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'storage_path',a.storage_path,'width',a.width,'height',a.height)),'[]')
  into result from tlb.academy_assets a
  where a.id::text in(select jsonb_array_elements_text(p_payload->'ids'))
   and (tlb.role_for(u)='owner' or a.id::text in(select asset_id from published_refs));
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
end $function$
;

create or replace function public.academy_media_readable(path text)
returns boolean language sql stable security definer set search_path=''
as $function$
 select exists(select 1 from tlb.academy_assets a where a.storage_path=path and (
  tlb.role_for(auth.uid())='owner' or exists(
   select 1 from tlb.academy_classes c where c.published is not null
    and jsonb_path_exists(c.published,'$.**.asset_id ? (@.type() == "string" && @ == $target)',jsonb_build_object('target',a.id::text))
  )
 ))
$function$;

