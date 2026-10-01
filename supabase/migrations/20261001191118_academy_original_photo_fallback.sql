begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Keep already-uploaded WebP rows and old clients compatible. Originals are
-- confined to student work/conversations and remain in the same private bucket.
alter table tlb.academy_portal_media add column mime_type text not null default 'image/webp';
alter table tlb.academy_portal_media
 drop constraint academy_portal_media_size_bytes_check,
 drop constraint academy_portal_media_width_check,
 drop constraint academy_portal_media_height_check,
 add constraint academy_photo_format check(mime_type in ('image/webp','image/png','image/jpeg','image/heic')),
 add constraint academy_photo_original_scope check(mime_type='image/webp' or purpose in ('submission','message')),
 add constraint academy_photo_path check(path=id::text||case mime_type when 'image/webp' then '.webp' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' when 'image/heic' then '.heic' end),
 add constraint academy_photo_size check(size_bytes between 1 and case mime_type when 'image/webp' then 5242880 else 26214400 end),
 add constraint academy_photo_dimensions check(width between 1 and case mime_type when 'image/webp' then 4096 else 16384 end and height between 1 and case mime_type when 'image/webp' then 4096 else 16384 end and width::bigint*height<=60000000);
create index academy_original_photos_pending on tlb.academy_portal_media(created_at,id) where uploaded and mime_type<>'image/webp';

update storage.buckets set file_size_limit=26214400,allowed_mime_types=array['image/webp','image/png','image/jpeg','image/heic'] where id='academy-student-media';

do $migration$
declare definition text:=replace(pg_get_functiondef('tlb.academy_portal_base(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 old_columns text:='insert into tlb.academy_portal_media(id,path,user_id,class_id,submission_id,message_id,announcement_id,upcoming_id,recipe_id,module_id,purpose,size_bytes,width,height)';
 old_values text:=$anchor$values(id,id||'.webp',u,cid,s.id,m.id,nullif(p_payload->>'announcement_id','')::uuid,nullif(p_payload->>'upcoming_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,nullif(p_payload->>'module_id','')::uuid,p_payload->>'purpose',(p_payload->>'size_bytes')::int,(p_payload->>'width')::int,(p_payload->>'height')::int)$anchor$;
 new_values text:=$replacement$values(id,id||case coalesce(p_payload->>'mime_type','image/webp') when 'image/webp' then '.webp' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' when 'image/heic' then '.heic' end,u,cid,s.id,m.id,nullif(p_payload->>'announcement_id','')::uuid,nullif(p_payload->>'upcoming_id','')::uuid,nullif(p_payload->>'recipe_id','')::uuid,nullif(p_payload->>'module_id','')::uuid,p_payload->>'purpose',(p_payload->>'size_bytes')::int,(p_payload->>'width')::int,(p_payload->>'height')::int,coalesce(p_payload->>'mime_type','image/webp'))$replacement$;
 media_projection text:=$anchor$jsonb_build_object('id',x.id,'path',x.path)$anchor$;
begin
 if position(old_columns in definition)=0 or position(old_values in definition)=0 or position(media_projection in definition)=0 then raise exception 'Review Academy dispatch before adding original photos';end if;
 definition:=replace(definition,old_columns,replace(old_columns,'width,height)','width,height,mime_type)'));
 definition:=replace(definition,old_values,new_values);
 definition:=replace(definition,media_projection,$replacement$jsonb_build_object('id',x.id,'path',x.path,'mime_type',x.mime_type,'conversion_pending',x.mime_type<>'image/webp')$replacement$);
 execute definition;
end $migration$;

-- Confirm original storage metadata after the service has validated its bytes.
do $migration$
declare definition text:=replace(pg_get_functiondef('public.academy_portal_confirm_upload(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n');
 anchor text:=$anchor$exists(select 1 from storage.objects where bucket_id='academy-student-media' and name=m.path)$anchor$;
 replacement text:=$replacement$exists(select 1 from storage.objects where bucket_id='academy-student-media' and name=m.path and (m.mime_type='image/webp' or (metadata->>'mimetype'=m.mime_type and (metadata->>'size')::bigint=m.size_bytes)))$replacement$;
begin
 if position(anchor in definition)=0 then raise exception 'Review Academy upload confirmation before adding original photos';end if;
 execute replace(definition,anchor,replacement);
end $migration$;
revoke all on function tlb.academy_portal_base(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.academy_portal_confirm_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.academy_portal_confirm_upload(uuid,uuid,text) to service_role;
commit;
