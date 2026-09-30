begin;
-- Capture catalog details and existing image references without copying blobs.
-- Old versions without a snapshot get a read-time fallback; saved snapshots
-- and approved formulas remain unchanged when the catalog is edited.
create function tlb.recipe_packaging_document(p_doc jsonb,p_refresh boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;item jsonb;photo jsonb;resource tlb.recipe_resources;attachment tlb.recipe_files;
 variants jsonb:='[]';extras jsonb;photos jsonb;files jsonb;
begin
 select coalesce(jsonb_agg(value),'[]') into files from jsonb_array_elements(coalesce(p_doc->'files','[]')) where value->>'packaging_resource' is distinct from 'true';
 for v in select value from jsonb_array_elements(p_doc->'variants') loop
  extras:='[]';
  for item in select value from jsonb_array_elements(coalesce(v->'additional_costs','[]')) loop
   if nullif(item->>'resource_id','') is not null then
    if p_refresh or not(item ? 'resource_photos') then
     select * into resource from tlb.recipe_resources where id::text=item->>'resource_id' and kind='packaging';
     if found then
      select coalesce(jsonb_agg(jsonb_build_object('file_id',f.id,'caption',left(coalesce(p.value->>'caption',''),500)) order by p.n),'[]') into photos
      from jsonb_array_elements(coalesce(resource.data->'photos','[]')) with ordinality p(value,n)
      join tlb.recipe_files f on f.id::text=p.value->>'file_id' and f.uploaded and f.mime_type in ('image/jpeg','image/png','image/webp');
      item:=item||jsonb_build_object('resource_name',resource.name,'resource_dimensions',coalesce(resource.data->>'dimensions',''),
       'resource_type',coalesce(resource.data->>'type',''),'resource_notes',coalesce(resource.data->>'notes',''),'resource_photos',photos);
     end if;
    end if;
    for photo in select value from jsonb_array_elements(case when jsonb_typeof(item->'resource_photos')='array' then item->'resource_photos' else '[]'::jsonb end) loop
     select * into attachment from tlb.recipe_files where id::text=photo->>'file_id' and uploaded and mime_type in ('image/jpeg','image/png','image/webp');
     if found then
      if exists(select 1 from jsonb_array_elements(files) f where f->>'id'=attachment.id::text) then
       select jsonb_agg(case when f->>'id'=attachment.id::text then f||jsonb_build_object('visibility','kitchen') else f end) into files from jsonb_array_elements(files) f;
      else
       files:=files||jsonb_build_array(jsonb_build_object('id',attachment.id,'path',attachment.path,'filename',attachment.filename,
        'mime_type',attachment.mime_type,'size_bytes',attachment.size_bytes,'visibility','kitchen','packaging_resource',true));
      end if;
     end if;
    end loop;
   end if;
   extras:=extras||jsonb_build_array(item);
  end loop;
  variants:=variants||jsonb_build_array(v||jsonb_build_object('additional_costs',extras));
 end loop;
 return p_doc||jsonb_build_object('variants',variants,'files',files);
end $$;
revoke all on function tlb.recipe_packaging_document(jsonb,boolean) from public,anon,authenticated,service_role;

do $$
declare definition text;hook text;
begin
 definition:=pg_get_functiondef('tlb.recipe_capture_costs(jsonb)'::regprocedure);
 hook:=' for v in select value from jsonb_array_elements(p_doc->''variants'') loop';
 perform tlb.require(position(hook in definition)>0,'Missing packaging capture hook.');
 execute replace(definition,hook,E' p_doc:=tlb.recipe_packaging_document(p_doc,true);\n'||hook);

 definition:=pg_get_functiondef('tlb.recipe_save_version(uuid,bigint,jsonb,text,text,jsonb)'::regprocedure);
 hook:=' select coalesce(max(number),0)+1 into num from tlb.recipe_versions where recipe_id=p_id;';
 perform tlb.require(position(hook in definition)>0,'Missing packaging restore hook.');
 execute replace(definition,hook,E' doc:=tlb.recipe_packaging_document(doc,false);\n'||hook);

 definition:=pg_get_functiondef('tlb.recipe_kitchen_document(jsonb)'::regprocedure);
 hook:='tlb.recipe_pick(item,array[''id'',''resource_id'',''resource_name'',''resource_dimensions'',''quantity'',''unit'',''per_batch''])';
 perform tlb.require(position(hook in definition)>0,'Missing packaging photo projection hook.');
 execute replace(definition,hook,$new$tlb.recipe_pick(item,array['id','resource_id','resource_name','resource_dimensions','resource_type','resource_notes','quantity','unit','per_batch'])||jsonb_build_object('resource_photos',tlb.recipe_pick_array(item->'resource_photos',array['file_id','caption']))$new$);

 definition:=pg_get_functiondef('tlb.recipe_detail(uuid,uuid,boolean)'::regprocedure);
 hook:=' select coalesce(jsonb_agg(jsonb_build_object(''id'',l.link_id,';
 perform tlb.require(position(hook in definition)>0,'Missing packaging detail hook.');
 definition:=replace(definition,hook,E' v.document:=tlb.recipe_packaging_document(v.document,false);\n'||hook);
 hook:=' return jsonb_build_object(''id'',r.id,''code'',r.code,''revision'',r.revision,''version_id'',v.id,';
 perform tlb.require(position(hook in definition)>0,'Missing packaging file detail hook.');
 execute replace(definition,hook,$new$
 select files||coalesce(jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'mime_type',f.mime_type,'path',f.path,'size_bytes',f.size_bytes,'visibility','kitchen')),'[]') into files
 from tlb.recipe_files f where f.uploaded and f.id::text in (select photo->>'file_id' from jsonb_array_elements(v.document->'variants') size cross join lateral jsonb_array_elements(coalesce(size->'additional_costs','[]')) item cross join lateral jsonb_array_elements(coalesce(item->'resource_photos','[]')) photo)
 and not exists(select 1 from jsonb_array_elements(files) linked where linked->>'id'=f.id::text);
$new$||hook);

 -- Pre-existing recipes can read only the catalog images of their explicitly
 -- linked packaging. Draft-only and unrelated catalog files stay inaccessible.
 definition:=pg_get_functiondef('public.recipe_file_access(text,boolean)'::regprocedure);
 hook:='where f.path=p_path and f.uploaded and l.visibility=''kitchen'' and l.version_id in(select id from tlb.recipe_readable_versions()));';
 perform tlb.require(position(hook in definition)>0,'Missing legacy packaging access hook.');
 execute replace(definition,hook,$new$where f.path=p_path and f.uploaded and l.visibility='kitchen' and l.version_id in(select id from tlb.recipe_readable_versions()))
  or exists(select 1 from tlb.recipe_files f
   join tlb.recipe_versions v on v.id in(select id from tlb.recipe_readable_versions())
   cross join lateral jsonb_array_elements(v.document->'variants') size
   cross join lateral jsonb_array_elements(coalesce(size->'additional_costs','[]')) item
   join tlb.recipe_resources r on r.id::text=item->>'resource_id' and r.kind='packaging'
   cross join lateral jsonb_array_elements(coalesce(r.data->'photos','[]')) photo
   where f.path=p_path and f.uploaded and f.mime_type in ('image/jpeg','image/png','image/webp')
    and not(item ? 'resource_photos') and photo->>'file_id'=f.id::text);$new$);
end $$;
commit;
