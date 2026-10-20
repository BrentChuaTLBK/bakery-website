-- Owner-only permanent deletion is restricted to the current Recently deleted
-- collection. Preview tokens bind confirmation to that exact set and revisions.
create function tlb.recipe_purge_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 scope text:=p_payload->>'scope';targets jsonb;ids uuid[];versions uuid[];refs uuid[];
 total integer;token text;previous_context text;blocked text;
begin
 perform tlb.recipe_assert(true,true);
 perform tlb.require(jsonb_typeof(p_payload)='object' and scope in ('one','all_deleted'),'Choose a recipe or Recently deleted.');
 perform tlb.require(p_action in ('purge_preview','purge'),'Unknown permanent deletion action.');
 if scope='one' then perform tlb.require(nullif(p_payload->>'id','') is not null,'Choose a deleted recipe.');end if;
 if p_action='purge' then
  perform tlb.require(p_payload->'confirmed'='true'::jsonb,'Confirm permanent deletion first.');
  -- Briefly prevent new references, restores, or drafts while verifying and
  -- removing history. No lock is held while the owner reads the confirmation.
  lock table tlb.recipes,tlb.recipe_versions,tlb.recipe_links,tlb.recipe_tests,
   tlb.recipe_drafts,tlb.academy_student_recipes in share row exclusive mode;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'name',name,'code',code) order by id),'[]'),
  coalesce(array_agg(id order by id),'{}'::uuid[]),count(*)::integer
 into targets,ids,total from tlb.recipes
 where deleted_at is not null and (scope='all_deleted' or id=(p_payload->>'id')::uuid);
 if scope='one' then perform tlb.require(total=1,'Only recipes in Recently deleted can be permanently deleted. Refresh the library.');end if;
 token:=md5(targets::text);
 if p_action='purge_preview' then return jsonb_build_object('count',total,'recipes',targets,'token',token);end if;
 perform tlb.require(total>0,'Recently deleted is already empty.');
 perform tlb.require(p_payload->>'token'=token,'Recently deleted changed. Review the recipes and confirm again.');

 select coalesce(array_agg(id),'{}'::uuid[]) into versions from tlb.recipe_versions where recipe_id=any(ids);
 refs:=ids||versions;
 -- Include historical versions, external working drafts and R&D proposals:
 -- none may be silently broken by deleting their source.
 select name into blocked from (
  select r.name from tlb.recipe_links l join tlb.recipe_versions v on v.id=l.version_id
   join tlb.recipes r on r.id=v.recipe_id where l.target_version_id=any(versions) and not(r.id=any(ids))
  union
  select r.name from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id
   where not(r.id=any(ids)) and exists(select 1 from tlb.recipe_owner_json_refs(v.document) x where x.id=any(refs))
  union
  select coalesce(d.document->>'name','Working draft') from tlb.recipe_drafts d
   where (d.recipe_id is null or not(d.recipe_id=any(ids)))
   and exists(select 1 from tlb.recipe_owner_json_refs(d.document) x where x.id=any(refs))
  union
  select r.name from tlb.recipe_tests t join tlb.recipes r on r.id=t.recipe_id where not(t.recipe_id=any(ids))
   and (t.promoted_version_id=any(versions) or exists(select 1 from tlb.recipe_owner_json_refs(jsonb_build_array(t.proposed_document,t.data)) x where x.id=any(refs)))
  union
  select 'Academy: '||title from tlb.academy_student_recipes where source_version_id=any(versions)
 ) dependencies order by name limit 1;
 perform tlb.require(blocked is null,'Cannot permanently delete: a saved recipe, draft, or Academy reference still uses it ('||coalesce(blocked,'')||'). Remove that reference first.');

 previous_context:=current_setting('tlb.recipe_purge_ids',true);
 perform set_config('tlb.recipe_purge_ids',array_to_string(ids,','),true);
 delete from tlb.recipe_file_links where version_id=any(versions) or test_id in(select id from tlb.recipe_tests where recipe_id=any(ids));
 delete from tlb.recipe_ingredient_links where version_id=any(versions);
 delete from tlb.recipe_links where version_id=any(versions);
 delete from tlb.recipe_runs where recipe_id=any(ids);
 delete from tlb.recipe_tests where recipe_id=any(ids);
 delete from tlb.recipe_drafts where recipe_id=any(ids);
 delete from tlb.recipe_user_state where recipe_id=any(ids);
 delete from tlb.recipe_audit where recipe_id=any(ids);
 update tlb.recipes set current_version_id=null,production_version_id=null where id=any(ids);
 delete from tlb.recipe_versions where recipe_id=any(ids);
 delete from tlb.recipes where id=any(ids) and deleted_at is not null;
 perform set_config('tlb.recipe_purge_ids',coalesce(previous_context,''),true);
 -- Keep an action record without retaining any deleted formula or notes.
 insert into tlb.recipe_audit(actor,action,details) values(auth.uid(),'recipes_permanently_deleted',jsonb_build_object('count',total,'scope',scope));
 return jsonb_build_object('deleted',total,'ids',to_jsonb(ids));
end $$;
revoke all on function tlb.recipe_purge_api(text,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare source text;hook text;
begin
 select pg_get_functiondef('tlb.recipe_immutable()'::regprocedure) into source;
 hook:=$hook$ raise exception 'History is immutable. Create a new version instead.';$hook$;
 perform tlb.require(strpos(source,hook)>0,'Missing immutable recipe history hook.');
 source:=replace(source,hook,$hook$
 -- Only the private owner purge can remove history for its verified trash set.
 -- Other history edits, price history, and active recipes remain immutable.
 if tg_op='DELETE' and tg_table_name in ('recipe_versions','recipe_runs','recipe_audit')
  and tlb.recipe_role(auth.uid())='owner'
  and position(','||(to_jsonb(old)->>'recipe_id')||',' in ','||coalesce(current_setting('tlb.recipe_purge_ids',true),'')||',')>0
  and exists(select 1 from tlb.recipes where id=(to_jsonb(old)->>'recipe_id')::uuid and deleted_at is not null)
 then return old;end if;
$hook$||hook);
 execute source;
 select pg_get_functiondef('public.recipe_api(text,jsonb)'::regprocedure) into source;
 hook:=$hook$ if p_action='bootstrap' then return tlb.recipe_api_before_owner_visibility(p_action,p_payload);end if;$hook$;
 perform tlb.require(strpos(source,hook)>0,'Missing owner recipe gateway hook.');
 source:=replace(source,hook,$hook$ if p_action in ('purge_preview','purge') then return tlb.recipe_purge_api(p_action,p_payload);end if;
$hook$||hook);
 execute source;
end $migration$;
