begin;
set local lock_timeout='3s';

-- Preserve immutable historical status codes; new clients expose four choices.
alter table tlb.recipe_versions drop constraint recipe_versions_status_check;
alter table tlb.recipe_versions add constraint recipe_versions_status_check
 check(status in ('draft','testing','approved','production','hidden','archived'));

create function tlb.recipe_status(p_status text) returns text
language sql immutable security invoker set search_path='' as $$
 select case p_status when 'production' then 'production' when 'final' then 'production'
  when 'hidden' then 'hidden' when 'archived' then 'archived' when 'archive' then 'archived' else 'draft' end
$$;
revoke all on function tlb.recipe_status(text) from public,anon,authenticated,service_role;

do $$ declare source text;hook text; begin
 source:=pg_get_functiondef('tlb.recipe_save_version(uuid,bigint,jsonb,text,text,jsonb)'::regprocedure);
 hook:='p_status in (''draft'',''testing'',''approved'',''production'',''archived'')';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe status validation hook.');
 source:=replace(source,hook,'p_status in (''draft'',''testing'',''approved'',''production'',''hidden'',''archived'')');
 source:=replace(source,'p_status in (''approved'',''production'',''archived'')','p_status in (''approved'',''production'',''hidden'',''archived'')');
 hook:='when p_status=''archived'' then null';
 perform tlb.require(strpos(source,hook)>0,'Missing kitchen visibility hook.');
 source:=replace(source,hook,'when p_status in (''hidden'',''archived'') then null');
 source:=replace(source,'before approving each size.','before marking each size Final.');
 source:=replace(source,'before approving this recipe.','before marking this recipe Final.');
 source:=replace(source,'Approve linked components before publishing this recipe.','Mark linked components Final before marking this recipe Final.');
 execute source;

 source:=pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure);
 hook:='and (nullif(p_payload->>''status'','''') is null or v.status=p_payload->>''status'')';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe list status hook.');
 -- Apply status/Archive filtering to both the paginated rows and total count.
 source:=replace(source,hook,$new$and (case when nullif(p_payload->>'status','') is null
  then v.status<>'archived' or coalesce((p_payload->>'include_archived')::boolean,false) or coalesce((p_payload->>'deleted')::boolean,false)
  else tlb.recipe_status(v.status)=tlb.recipe_status(p_payload->>'status') end)$new$);
 execute source;
end $$;

alter function public.recipe_api(text,jsonb) rename to recipe_api_before_workflow;
alter function public.recipe_api_before_workflow(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_workflow(text,jsonb) from public,anon,authenticated,service_role;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare recipe tlb.recipes;version tlb.recipe_versions;vid uuid;target text;
begin
 if p_action='set_status' then
  perform tlb.recipe_assert(true,true);
  perform tlb.require(p_payload->>'status' in ('draft','final','production','hidden','archive','archived'),'Choose Draft, Final, Hidden or Archive.');
  target:=tlb.recipe_status(p_payload->>'status');
  select * into recipe from tlb.recipes where id=(p_payload->>'id')::uuid for update;
  perform tlb.require(recipe.id is not null and recipe.deleted_at is null,'Recipe was removed or does not exist.');
  perform tlb.require(recipe.revision=(p_payload->>'revision')::bigint,'This recipe changed in another window. Reload before saving.');
  select * into version from tlb.recipe_versions where id=recipe.current_version_id;
  if version.status=target and (target<>'draft' or recipe.production_version_id is null) then return tlb.recipe_detail(recipe.id);end if;
  -- Reuse the exact saved formula and cost snapshot; changing status never
  -- silently reprices ingredients or adopts newer catalog/component versions.
  vid:=tlb.recipe_save_version(recipe.id,recipe.revision,version.document,target,'Status changed to '||target,version.cost_snapshot);
  -- Explicitly returning to Draft withdraws the recipe. Editing a working
  -- Draft continues to preserve the last Final until an owner changes status.
  if target='draft' then update tlb.recipes set production_version_id=null where id=recipe.id;end if;
  return tlb.recipe_detail(recipe.id,vid);
 end if;
 if p_payload->>'status' in ('final','archive') then p_payload:=jsonb_set(p_payload,'{status}',to_jsonb(tlb.recipe_status(p_payload->>'status')));end if;
 return tlb.recipe_api_before_workflow(p_action,p_payload);
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;
commit;
