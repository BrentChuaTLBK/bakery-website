-- This focused update supports both the deployed Academy API and the newer
-- comparison-management API. It does not install unrelated pending features.
begin;
set local lock_timeout='3s';

alter table tlb.academy_student_recipes add column deleted_at timestamptz;

create function tlb.academy_recipe_active(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from tlb.academy_student_recipes where id=p_id and deleted_at is null)
$$;
revoke all on function tlb.academy_recipe_active(uuid) from public,anon,authenticated,service_role;

-- Extend the teaching-field allowlist only. Document-local group IDs preserve
-- component associations; no production/version/resource IDs or costs are added.
do $$
declare d text; hook text;
begin
 d:=pg_get_functiondef('tlb.academy_recipe_document(jsonb)'::regprocedure);
 hook:='groups:=groups||jsonb_build_object(''name'',';
 perform tlb.require(strpos(d,hook)>0,'Review Academy ingredient projection.');
 d:=replace(d,hook,'groups:=groups||jsonb_build_object(''id'',left(coalesce(g->>''id'',''''),100),''name'',');
 hook:='methods:=methods||jsonb_build_object(''name'',';
 perform tlb.require(strpos(d,hook)>0,'Review Academy method projection.');
 d:=replace(d,hook,$q$methods:=methods||jsonb_build_object('group_id',case when exists(select 1 from jsonb_array_elements(coalesce(v->'groups','[]')) x where x->>'id'=m->>'group_id') then left(m->>'group_id',100) else '' end,'name',$q$);
 hook:='baking:=baking||jsonb_build_object(''name'',';
 perform tlb.require(strpos(d,hook)>0,'Review Academy baking projection.');
 d:=replace(d,hook,$q$baking:=baking||jsonb_build_object(
 'group_id',case when s ? 'group_id' then case when exists(select 1 from jsonb_array_elements(coalesce(v->'groups','[]')) x where x->>'id'=s->>'group_id') then left(s->>'group_id',100) else '' end when jsonb_array_length(coalesce(v->'groups','[]'))=1 then left(coalesce(v#>>'{groups,0,id}',''),100) else '' end,
 'actual_bottom',left(coalesce(s->>'actual_bottom',''),60),'temperature',left(coalesce(s->>'temperature',''),60),
 'ingredient_temperature',left(coalesce(s->>'ingredient_temperature',''),60),'batter_temperature',left(coalesce(s->>'batter_temperature',''),60),
 'resting_temperature',left(coalesce(s->>'resting_temperature',''),60),'cooling_minutes',left(coalesce(s->>'cooling_minutes',''),60),
 'freezing_minutes',left(coalesce(s->>'freezing_minutes',''),60),'notes',left(coalesce(s->>'notes',''),10000),'name',$q$);
 execute d;

 -- Hide retired recipes in all class lists and dashboard shortcuts. Keep the
 -- assignment rows so historical student work and conversations retain context.
 d:=pg_get_functiondef('tlb.academy_portal_base(text,jsonb)'::regprocedure);
 hook:='join tlb.academy_student_recipes x on x.id=cr.recipe_id';
 perform tlb.require(strpos(d,hook)>0,'Review Academy class recipe list.');
 execute replace(d,hook,hook||' and x.deleted_at is null');
 d:=pg_get_functiondef('tlb.academy_class_card(uuid)'::regprocedure);
 hook:='where cr.class_id=c.id and tlb.academy_enrolled(c.id)';
 perform tlb.require(strpos(d,hook)>0,'Review Academy recipe shortcut.');
 execute replace(d,hook,hook||' and r.deleted_at is null');
 d:=pg_get_functiondef('public.academy_portal_media_readable(text)'::regprocedure);
 hook:='m.path=p_path and m.uploaded';
 perform tlb.require(strpos(d,hook)>0,'Review Academy recipe media access.');
 execute replace(d,hook,hook||' and (m.recipe_id is null or tlb.academy_recipe_active(m.recipe_id))');
 d:=pg_get_functiondef('public.academy_portal_upload_check(uuid)'::regprocedure);
 hook:='m.user_id=auth.uid()';
 perform tlb.require(strpos(d,hook)>0,'Review Academy pending recipe upload.');
 execute replace(d,hook,hook||' and (m.recipe_id is null or tlb.academy_recipe_active(m.recipe_id))');
 d:=pg_get_functiondef('public.academy_portal_confirm_upload(uuid,uuid,text)'::regprocedure);
 hook:='m.user_id=p_user and';
 perform tlb.require(strpos(d,hook)>0,'Review Academy recipe upload confirmation.');
 execute replace(d,hook,'m.user_id=p_user and (m.recipe_id is null or tlb.academy_recipe_active(m.recipe_id)) and');
end $$;

create function tlb.academy_recipe_context(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('source',(
  select jsonb_build_object('version_id',v.id,'name',pr.name,'number',v.number)
  from tlb.academy_student_recipes r join tlb.recipe_versions v on v.id=r.source_version_id join tlb.recipes pr on pr.id=v.recipe_id where r.id=p_id),
 'used_in',(select coalesce(jsonb_agg(jsonb_build_object('class_id',c.id,'class_name',c.name,'module_id',cr.module_id,'module_name',mo.name,
  'visible',coalesce((to_jsonb(cr)->>'visible')::boolean,true) and coalesce((to_jsonb(mo)->>'visible')::boolean,true)) order by c.name,c.id),'[]')
  from tlb.academy_class_recipes cr join tlb.academy_curricula c on c.id=cr.class_id left join tlb.academy_modules mo on mo.id=cr.module_id
  where cr.recipe_id=p_id and not coalesce((to_jsonb(cr)->>'removed')::boolean,false)))
$$;
revoke all on function tlb.academy_recipe_context(uuid) from public,anon,authenticated,service_role;

alter function public.academy_portal_api(text,jsonb) rename to academy_portal_before_recipe_management;
alter function public.academy_portal_before_recipe_management(text,jsonb) set schema tlb;
revoke all on function tlb.academy_portal_before_recipe_management(text,jsonb) from public,anon,authenticated,service_role;

create function public.academy_portal_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; rec tlb.academy_student_recipes; result jsonb;
begin
 perform tlb.require(jsonb_typeof(p_payload)='object' and octet_length(p_payload::text)<1000000,'Request is too large.');
 if p_action='public_welcome' then return tlb.academy_portal_before_recipe_management(p_action,'{}');end if;
 perform tlb.academy_assert(auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid()));
 if p_action in ('final_recipes','production_recipes','import_recipe','delete_recipe','admin_recipes','admin_recipe','save_recipe','duplicate_recipe','recipe_source_photos','admin_media') then
  perform tlb.academy_assert(tlb.academy_owner());
 end if;
 if p_action in ('final_recipes','production_recipes') then
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.name,x.version_id) from (
   select v.id version_id,rp.name,v.number,v.status from tlb.recipes rp join tlb.recipe_versions v on v.recipe_id=rp.id
   where rp.deleted_at is null and rp.current_version_id=v.id and rp.production_version_id=v.id and v.status='production'
    and rp.name ilike '%'||coalesce(p_payload->>'query','')||'%' order by rp.name,rp.id limit 100)x),'[]');
 end if;
 if p_action='import_recipe' then
  perform 1 from tlb.recipes rp join tlb.recipe_versions v on v.recipe_id=rp.id
   where v.id=(p_payload->>'version_id')::uuid and rp.deleted_at is null
    and rp.current_version_id=v.id and rp.production_version_id=v.id and v.status='production' for share of rp,v;
  perform tlb.require(found,'This recipe is no longer the current Final version. Search Final recipes again.');
 end if;
 if p_action='delete_recipe' then
  select * into rec from tlb.academy_student_recipes where id=(p_payload->>'id')::uuid for update;
  perform tlb.academy_assert(rec.id is not null);
  if rec.deleted_at is not null then return jsonb_build_object('id',rec.id,'deleted',true);end if;
  perform tlb.require(rec.revision=(p_payload->>'revision')::bigint,'This recipe changed. Reload before deleting.');
  update tlb.academy_student_recipes set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=rec.id;
  perform tlb.academy_log('recipe_deleted',rec.id);return jsonb_build_object('id',rec.id,'deleted',true);
 end if;
 if p_action='admin_recipes' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'revision',r.revision)||tlb.academy_recipe_context(r.id) order by r.title,r.id)
   from tlb.academy_student_recipes r where r.deleted_at is null),'[]');
 end if;
 -- Check before cached replies too. A stale editor must not revive a deletion.
 if p_action in ('recipe','admin_recipe','save_recipe','duplicate_recipe','recipe_source_photos') then target:=nullif(p_payload->>'id','')::uuid;
 elsif p_action in ('assign_recipe','recipe_visibility','start_thread','draft_submission','reserve_media','admin_media') then target:=nullif(p_payload->>'recipe_id','')::uuid;
 elsif p_action in ('attach_media','set_media_cover','remove_admin_media') then select recipe_id into target from tlb.academy_portal_media where id=(p_payload->>'id')::uuid;
 end if;
 if target is not null then
  if p_action='save_recipe' then perform 1 from tlb.academy_student_recipes where id=target and deleted_at is null for update;
  else perform 1 from tlb.academy_student_recipes where id=target and deleted_at is null for share;end if;
  perform tlb.require(found,'This student recipe was deleted. Return to the recipe list.');
 end if;
 if p_action='admin_media' and p_payload->>'purpose'='recipe' and target is not null then
  return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'sort_order',coalesce((to_jsonb(a)->>'sort_order')::int,0),'is_cover',a.position=1) order by a.position)
   from (select m.*,row_number() over(order by coalesce((to_jsonb(m)->>'sort_order')::int,0),m.created_at,m.id) position
    from tlb.academy_portal_media m where m.recipe_id=target and m.uploaded and to_jsonb(m)->>'abandoned_at' is null)a),'[]');
 end if;
 result:=tlb.academy_portal_before_recipe_management(p_action,p_payload);
 if p_action='admin_recipe' then result:=result||tlb.academy_recipe_context(target);end if;
 if p_action in ('import_recipe','save_recipe','duplicate_recipe') then perform tlb.require(tlb.academy_recipe_active((result->>'id')::uuid),'This student recipe was deleted. Start a new recipe or import.');end if;
 return result;
end $$;
revoke all on function public.academy_portal_api(text,jsonb) from public,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to anon,authenticated;
commit;
