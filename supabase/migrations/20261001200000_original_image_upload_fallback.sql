-- Keep genuine PNG/JPEG/HEIC originals when browser WebP conversion is unavailable.
-- Existing assets, permissions, privacy, immutable paths and approval rules remain.
create function tlb.image_extension(p_mime text) returns text
language sql immutable set search_path='' as $$
 select case p_mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg'
 when 'image/webp' then 'webp' when 'image/heic' then 'heic' end
$$;
revoke all on function tlb.image_extension(text) from public,anon,authenticated;

update storage.buckets set allowed_mime_types=array['image/png','image/jpeg','image/webp','image/heic']
where id in ('payment-proofs','product-images','academy-photos','academy-student-media');
update storage.buckets set file_size_limit=26214400
where id in ('product-images','academy-photos','academy-student-media');
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'image/heic')
where id='recipe-files' and not ('image/heic'=any(allowed_mime_types));

-- Broaden only the file-specific constraints. Original dimensions can exceed a
-- resized WebP's bounds, but every image remains limited to 60 megapixels.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='tlb.academy_assets'::regclass and contype='c'
 and (pg_get_constraintdef(oid) like '%storage_path%' or pg_get_constraintdef(oid) like '%width%') loop
 execute format('alter table tlb.academy_assets drop constraint %I',c.conname);end loop;
end $$;
alter table tlb.academy_assets add constraint academy_asset_original_path check(
 storage_path in (id::text||'.webp',id::text||'.png',id::text||'.jpg',id::text||'.heic'));
alter table tlb.academy_assets add constraint academy_asset_original_dimensions
 check(width>0 and height>0 and width::bigint*height::bigint<=60000000);
drop policy academy_photo_insert on storage.objects;
create policy academy_photo_insert on storage.objects for insert to authenticated
with check(bucket_id='academy-photos' and (select public.academy_is_owner()) and name ~ '^[0-9a-f-]{36}\.(webp|png|jpg|heic)$');

-- Academy's earlier original-photo migration already enforces MIME, paths,
-- dimensions, size, and storage metadata. Extend originals to owner material.
alter table tlb.academy_portal_media drop constraint academy_photo_original_scope;

-- Extend current recipe image allowlists, including kitchen projections and
-- backup exports, without replacing any of their access-control wrappers.
do $$ declare f record; definition text; updated text; begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('tlb','public') and p.prokind='f'
 and p.prosrc like '%''image/jpeg'',''image/png'',''image/webp''%' loop
 definition:=pg_get_functiondef(f.oid);
 updated:=replace(definition,'''image/jpeg'',''image/png'',''image/webp''','''image/jpeg'',''image/png'',''image/webp'',''image/heic''');
 execute updated;
 end loop;
 -- Payment and courier receipts keep the same order-owned private path rule.
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('tlb','public') and p.prokind='f'
 and p.prosrc like '%png|jpg|jpeg|webp%' loop
 execute replace(pg_get_functiondef(f.oid),'png|jpg|jpeg|webp','png|jpg|jpeg|webp|heic');
 end loop;
 -- Academy library registration uses only the requested immutable asset ID.
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('tlb','public') and p.prokind='f'
 and p.prosrc like '%target::text||''.webp''%' and p.prosrc like '%register_asset%' loop
 definition:=pg_get_functiondef(f.oid);
 updated:=replace(definition,'target::text||''.webp''','target::text||''.''||tlb.image_extension(coalesce(p_payload->>''mime_type'',''image/webp''))');
 execute updated;
 end loop;
end $$;
