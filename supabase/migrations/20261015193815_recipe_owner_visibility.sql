begin;
set local lock_timeout='3s';

-- Visibility is an account permission, independent of the immutable version's
-- Draft / R&D / Final status. Existing recipes and new recipes stay shared.
alter table tlb.recipes add column visibility text not null default 'staff'
 check (visibility in ('staff','owner'));
alter table tlb.recipe_drafts add column visibility text not null default 'staff'
 check (visibility in ('staff','owner'));

-- Include every pinned component and variation base, including historical
-- versions. A parent whose current formula is restricted cannot expose an old
-- Final as a way around the owner's access decision.
create function tlb.recipe_owner_hidden_versions() returns table(id uuid)
language sql stable security invoker set search_path='' as $$
 with recursive edges(id,target) as (
  select version_id,target_version_id from tlb.recipe_links
  union select v.id,r.current_version_id from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id
   where r.current_version_id is not null
 ), hidden(id) as (
  select v.id from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id where r.visibility='owner'
  union select e.id from edges e join hidden h on h.id=e.target
 ) select id from hidden
$$;

create function tlb.recipe_owner_version_visible(p_version uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from tlb.recipe_versions where id=p_version) and
 (tlb.recipe_role(auth.uid())='owner' or not exists(select 1 from tlb.recipe_owner_hidden_versions() where id=p_version))
$$;

create function tlb.recipe_owner_recipe_visible(p_recipe uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from tlb.recipes r where r.id=p_recipe and
  (tlb.recipe_role(auth.uid())='owner' or (r.visibility='staff' and tlb.recipe_owner_version_visible(r.current_version_id))))
$$;

-- PostgreSQL accepts UUIDs with braces, uppercase or omitted hyphens. Legacy
-- snapshots can contain those spellings, so compare parsed UUID identities;
-- ordinary instructions/captions must never raise an invalid UUID error.
create function tlb.recipe_owner_uuid(p_value text) returns uuid
language plpgsql immutable security invoker set search_path='' as $$
begin
 if p_value is null or length(btrim(p_value)) not between 32 and 64
  or p_value !~* '^[[:space:]{}0-9a-f-]+$' then return null;end if;
 return p_value::uuid;
exception when invalid_text_representation then return null;
end $$;

create function tlb.recipe_owner_json_refs(p_value jsonb) returns table(id uuid)
language sql immutable security invoker set search_path='' as $$
 select distinct tlb.recipe_owner_uuid(value#>>'{}') id
 from jsonb_path_query(coalesce(p_value,'null'),'$.** ? (@.type() == "string")') value
 where tlb.recipe_owner_uuid(value#>>'{}') is not null
$$;

create function tlb.recipe_owner_snapshot_has_file(p_value jsonb,p_file uuid,p_path text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
begin
 if p_path is not null and jsonb_path_exists(coalesce(p_value,'null'),'$.** ? (@ == $path)',jsonb_build_object('path',p_path)) then return true;end if;
 -- A cheap candidate check avoids parsing every UUID in unrelated historical
 -- documents. Removing optional UUID punctuation preserves every spelling
 -- accepted by the safe parser; the parsed comparison remains authoritative.
 if strpos(lower(translate(coalesce(p_value::text,''),'-{}','')),replace(p_file::text,'-',''))=0 then return false;end if;
 return exists(select 1 from tlb.recipe_owner_json_refs(p_value) where id=p_file);
end
$$;

-- Testing formulas are editable snapshots: their proposed components/base are
-- not written to recipe_links until promotion. Inspect those references as
-- well, without calling file/JSON visibility helpers recursively.
create function tlb.recipe_owner_hidden_tests() returns table(id uuid)
language sql stable security invoker set search_path='' as $$
 with hidden as materialized (select id from tlb.recipe_owner_hidden_versions()),
 private_refs as materialized (
  select id from hidden union select id from tlb.recipes
   where visibility='owner' or current_version_id in(select id from hidden)
 )
 select t.id from tlb.recipe_tests t where t.recipe_id in(select id from private_refs)
  or t.version_id in(select id from hidden)
  or exists(select 1 from tlb.recipe_owner_json_refs(jsonb_build_array(t.proposed_document,t.data)) x
   join private_refs p on p.id=x.id)
$$;

-- Any private provenance wins. In particular, adding an attachment to a shared
-- packaging resource must not make an owner's recipe or testing photo public.
create function tlb.recipe_owner_file_visible(p_file uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare hidden uuid[];private_recipes uuid[];private_refs uuid[];private_tests uuid[];
 file_path text;snapshot jsonb;entry record;private_draft boolean:=false;
begin
 if tlb.recipe_role(auth.uid())='owner' then return true;end if;
 if not exists(select 1 from tlb.recipes where visibility='owner')
  and not exists(select 1 from tlb.recipe_drafts where visibility='owner') then return true;end if;
 hidden:=array(select id from tlb.recipe_owner_hidden_versions());
 private_recipes:=array(select id from tlb.recipes where visibility='owner' or current_version_id=any(hidden));
 private_refs:=hidden||private_recipes;
 private_tests:=array(select id from tlb.recipe_owner_hidden_tests());
 select path into file_path from tlb.recipe_files where id=p_file;

 if exists(select 1 from tlb.recipe_file_links where file_id=p_file
  and (version_id=any(hidden) or test_id=any(private_tests))) then return false;end if;
 for snapshot in select document from tlb.recipe_versions where id=any(hidden) loop
  if tlb.recipe_owner_snapshot_has_file(snapshot,p_file,file_path) then return false;end if;
 end loop;
 for snapshot in select jsonb_build_array(proposed_document,data) from tlb.recipe_tests where id=any(private_tests) loop
  if tlb.recipe_owner_snapshot_has_file(snapshot,p_file,file_path) then return false;end if;
 end loop;
 -- Filter by this attachment before parsing private references. Previous test
 -- snapshots stay protected when an owner removes a proposed-formula upload.
 for entry in select recipe_id,details from tlb.recipe_audit
  where tlb.recipe_owner_snapshot_has_file(details,p_file,file_path) loop
  if entry.recipe_id=any(private_recipes) or exists(select 1 from tlb.recipe_owner_json_refs(entry.details) where id=any(private_refs)) then return false;end if;
 end loop;
 for entry in select recipe_id,visibility,document from tlb.recipe_drafts
  where tlb.recipe_owner_snapshot_has_file(document,p_file,file_path) loop
  if entry.visibility='owner' or entry.recipe_id=any(private_recipes)
   or exists(select 1 from tlb.recipe_owner_json_refs(entry.document) where id=any(private_refs)) then private_draft:=true;exit;end if;
 end loop;
 if not private_draft then return true;end if;

 -- Only a matching private working copy needs this availability exception.
 -- An unsaved selector cannot withdraw an already-shared saved image, while
 -- new private-draft uploads stay protected. Saved private provenance above
 -- always wins. Check canonical links before any legacy document fallback.
 if exists(select 1 from tlb.recipe_file_links l join tlb.recipe_versions v on v.id=l.version_id
  join tlb.recipes r on r.id=v.recipe_id where l.file_id=p_file and r.deleted_at is null and not(v.id=any(hidden))) then return true;end if;
 for snapshot in select v.document from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id
  where r.deleted_at is null and not(v.id=any(hidden)) loop
  if tlb.recipe_owner_snapshot_has_file(snapshot,p_file,file_path) then return true;end if;
 end loop;
 return false;
end
$$;

-- Inspect nested saved snapshots as well as top-level IDs. This covers test
-- data, audit previous/new documents, file lists, and prepared export batches.
create function tlb.recipe_owner_json_visible(p_value jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare refs uuid[];hidden uuid[];private_recipes uuid[];private_refs uuid[];strings text[];file_id uuid;entry record;
begin
 if tlb.recipe_role(auth.uid())='owner' then return true;end if;
 if not exists(select 1 from tlb.recipes where visibility='owner')
  and not exists(select 1 from tlb.recipe_drafts where visibility='owner') then return true;end if;
 strings:=array(select distinct value#>>'{}' from jsonb_path_query(coalesce(p_value,'null'),'$.** ? (@.type() == "string")') value);
 refs:=array(select distinct tlb.recipe_owner_uuid(value) from unnest(strings) value where tlb.recipe_owner_uuid(value) is not null);
 hidden:=array(select id from tlb.recipe_owner_hidden_versions());
 if refs&&hidden then return false;end if;
 private_recipes:=array(select id from tlb.recipes where visibility='owner' or current_version_id=any(hidden));
 if refs&&private_recipes then return false;end if;
 private_refs:=hidden||private_recipes;
 for entry in select recipe_id,version_id,proposed_document,data from tlb.recipe_tests where id=any(refs) loop
  if entry.recipe_id=any(private_recipes) or entry.version_id=any(hidden)
   or exists(select 1 from tlb.recipe_owner_json_refs(jsonb_build_array(entry.proposed_document,entry.data)) where id=any(private_refs)) then return false;end if;
 end loop;
 -- Materialize only file identities actually present in this payload, then
 -- authorize each once even when both its UUID and legacy path are present.
 for file_id in select id from tlb.recipe_files where id=any(refs)
  union select id from tlb.recipe_files where path=any(strings) loop
  if not tlb.recipe_owner_file_visible(file_id) then return false;end if;
 end loop;
 return true;
end
$$;

create function tlb.recipe_owner_redact_files(p_value jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;part record;item jsonb;
begin
 if tlb.recipe_role(auth.uid())='owner' then return p_value;end if;
 if jsonb_typeof(p_value)='object' then
  result:='{}';for part in select key,value from jsonb_each(p_value) loop
   if part.key in ('photos','files','resource_photos') and jsonb_typeof(part.value)='array' then
    select coalesce(jsonb_agg(tlb.recipe_owner_redact_files(value) order by ord),'[]') into item
     from jsonb_array_elements(part.value) with ordinality a(value,ord) where tlb.recipe_owner_json_visible(value);
   else item:=tlb.recipe_owner_redact_files(part.value);end if;
   result:=result||jsonb_build_object(part.key,item);
  end loop;return result;
 elsif jsonb_typeof(p_value)='array' then
  return (select coalesce(jsonb_agg(tlb.recipe_owner_redact_files(value) order by ord),'[]')
   from jsonb_array_elements(p_value) with ordinality a(value,ord));
 end if;return p_value;
end $$;

create or replace function tlb.recipe_version_visible(p_version uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 with recursive chain(id) as (
  select p_version union select l.target_version_id from tlb.recipe_links l join chain c on c.id=l.version_id
 ) select tlb.recipe_owner_version_visible(p_version) and
 (tlb.recipe_can_view_rd() or not exists(
  select 1 from chain c join tlb.recipe_versions v on v.id=c.id
  join tlb.recipes r on r.id=v.recipe_id join tlb.recipe_versions current on current.id=r.current_version_id
  where v.status='testing' or (current.status='testing' and v.status not in ('approved','production'))))
$$;

create or replace function tlb.recipe_hidden_versions() returns table(id uuid)
language sql stable security invoker set search_path='' as $$
 with recursive hidden(id) as (
  select v.id from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id
  join tlb.recipe_versions current on current.id=r.current_version_id
  where (not tlb.recipe_can_view_rd() and (v.status='testing' or (current.status='testing' and v.status not in ('approved','production'))))
   or (tlb.recipe_role(auth.uid())<>'owner' and v.id in(select id from tlb.recipe_owner_hidden_versions()))
  union select l.version_id from tlb.recipe_links l join hidden h on h.id=l.target_version_id
 ) select id from hidden
$$;

create or replace function tlb.recipe_listing_version(p_recipe uuid,p_kitchen boolean default false,p_rd boolean default false) returns uuid
language sql stable security invoker set search_path='' as $$
 select case when not tlb.recipe_owner_recipe_visible(r.id) then null
  when p_rd then case when tlb.recipe_can_view_rd() and v.status='testing' then v.id end
  when p_kitchen then r.production_version_id
  when tlb.recipe_version_visible(v.id) then v.id else r.production_version_id end
 from tlb.recipes r join tlb.recipe_versions v on v.id=r.current_version_id where r.id=p_recipe
$$;

create or replace function tlb.recipe_document_visible(p_doc jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select tlb.recipe_owner_json_visible(p_doc) and not exists(
  select 1 from (
   select nullif(p_doc#>>'{base,version_id}','')::uuid id
   union all select nullif(c->>'version_id','')::uuid
   from jsonb_array_elements(coalesce(p_doc->'variants','[]')) v
   cross join lateral jsonb_array_elements(coalesce(v->'components','[]')) c
  ) refs where id is not null and not tlb.recipe_version_visible(id))
$$;

create or replace function tlb.recipe_file_visible(p_file uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select tlb.recipe_owner_file_visible(p_file) and (
 tlb.recipe_can_view_rd()
 or not exists(select 1 from tlb.recipe_file_links where file_id=p_file)
 or exists(select 1 from tlb.recipe_file_links l where l.file_id=p_file and l.version_id is not null and tlb.recipe_version_visible(l.version_id))
 or exists(select 1 from tlb.recipe_resources r cross join lateral jsonb_array_elements(coalesce(r.data->'photos','[]')) p where r.kind='packaging' and p->>'file_id'=p_file::text))
$$;

-- Patch the established dispatchers in place so authorization stays before
-- search, pagination and counts, and their storage policy OIDs stay unchanged.
do $$ declare source text;hook text;signature text;begin
 source:=replace(pg_get_functiondef('public.recipe_file_access(text,boolean)'::regprocedure),E'\r\n',E'\n');
 hook:='role_name=''chef'' and not p_write and not tlb.recipe_can_view_rd()';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe file visibility hook.');
 source:=replace(source,hook,'role_name=''chef'' and not p_write');
 hook:='if role_name=''kitchen'' then return false;end if;';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe file upload privacy hook.');
 execute replace(source,hook,hook||$hook$
 if role_name='chef' and exists(select 1 from tlb.recipe_files f where f.path=p_path and not tlb.recipe_owner_file_visible(f.id)) then return false;end if;$hook$);

 source:=replace(pg_get_functiondef('tlb.recipe_readable_versions()'::regprocedure),E'\r\n',E'\n');
 hook:='where (select tlb.recipe_can_view_rd()) or id not in(select id from tlb.recipe_hidden_versions())';
 perform tlb.require(strpos(source,hook)>0,'Missing readable recipe visibility hook.');
 source:=replace(source,hook,'where id not in(select id from tlb.recipe_hidden_versions())');
 source:=replace(source,'union select id from research','union select id from research where id not in(select id from tlb.recipe_hidden_versions())');execute source;

 source:=replace(pg_get_functiondef('tlb.recipe_staff_roots(uuid,boolean)'::regprocedure),E'\r\n',E'\n');
 hook:='and v.id not in(select id from invalid)';
 perform tlb.require(strpos(source,hook)>0,'Missing staff recipe visibility hook.');
 execute replace(source,hook,hook||' and v.id not in(select id from tlb.recipe_owner_hidden_versions())');

 foreach signature in array array['tlb.recipe_detail(uuid,uuid,boolean)','tlb.recipe_staff_detail(uuid,uuid,boolean)'] loop
  source:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  hook:='''id'',r.id,''code'',r.code';
  perform tlb.require(strpos(source,hook)>0,'Missing recipe detail visibility field hook.');
  source:=replace(source,hook,hook||',''visibility'',r.visibility');
  if signature like 'tlb.recipe_detail%' then
   hook:='perform tlb.require(r.id is not null,''Recipe not found.'');';
   source:=replace(source,hook,hook||E'\n perform tlb.require(tlb.recipe_owner_recipe_visible(r.id),''Recipe not found or access denied.'');');
   hook:='v.document:=tlb.recipe_packaging_document(tlb.recipe_linked_ingredient_document(v.document),false);';
   perform tlb.require(strpos(source,hook)>0,'Missing recipe document visibility hook.');
   source:=replace(source,hook,hook||E'\n perform tlb.require(tlb.recipe_owner_json_visible(v.document),''Recipe not found or access denied.'');');
  else
   hook:='doc:=tlb.recipe_kitchen_document(tlb.recipe_packaging_document(tlb.recipe_linked_ingredient_document(v.document),false));';
   perform tlb.require(strpos(source,hook)>0,'Missing kitchen document visibility hook.');
   source:=replace(source,hook,$hook$perform tlb.require(tlb.recipe_owner_recipe_visible(r.id) and tlb.recipe_owner_version_visible(v.id),'Recipe not found or access denied.');
 doc:=tlb.recipe_packaging_document(tlb.recipe_linked_ingredient_document(v.document),false);
 perform tlb.require(tlb.recipe_owner_json_visible(doc),'Recipe not found or access denied.');
 doc:=tlb.recipe_kitchen_document(doc);$hook$);
  end if;execute source;
 end loop;

 source:=replace(pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 hook:='case when can_rd or p_action<>''list''';perform tlb.require(strpos(source,hook)>0,'Missing library visibility declaration hook.');
 source:=replace(source,hook,'case when p_action<>''list''');
 source:=replace(source,'(can_rd or tlb.recipe_version_visible(v.id))','tlb.recipe_version_visible(v.id)');
 source:=replace(source,'''id'',r.id,''code'',r.code,''name''','''id'',r.id,''code'',r.code,''visibility'',r.visibility,''name''');
 source:=replace(source,'from tlb.recipe_runs where recipe_id=(p_payload->>''id'')::uuid order by','from tlb.recipe_runs where recipe_id=(p_payload->>''id'')::uuid and tlb.recipe_version_visible(version_id) order by');
 source:=replace(source,'from tlb.recipe_tests where recipe_id=(p_payload->>''id'')::uuid order by','from tlb.recipe_tests where recipe_id=(p_payload->>''id'')::uuid and tlb.recipe_owner_json_visible(to_jsonb(recipe_tests)) order by');
 source:=replace(source,'from tlb.recipe_audit where recipe_id=(p_payload->>''id'')::uuid and','from tlb.recipe_audit where recipe_id=(p_payload->>''id'')::uuid and tlb.recipe_owner_json_visible(details) and');
 hook:='from tlb.recipe_drafts where user_id=uid and';perform tlb.require(strpos(source,hook)>0,'Missing working draft visibility hook.');
 source:=replace(source,hook,hook||$hook$
 (tlb.recipe_role(uid)='owner' or (visibility='staff' and (recipe_id is null or tlb.recipe_owner_recipe_visible(recipe_id)) and tlb.recipe_owner_json_visible(document))) and$hook$);
 execute source;

 source:=replace(pg_get_functiondef('tlb.recipe_api_before_rd_access(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 hook:='case when can_rd or p_action<>''costing_overview''';perform tlb.require(strpos(source,hook)>0,'Missing costing visibility declaration hook.');
 execute replace(source,hook,'case when p_action<>''costing_overview''');

 source:=replace(pg_get_functiondef('tlb.recipe_api_before_workflow_refinement(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 hook:='select r.id,r.code,v.document->>''name'' name';perform tlb.require(strpos(source,hook)>0,'Missing kitchen listing visibility field hook.');
 execute replace(source,hook,'select r.id,r.code,r.visibility,v.document->>''name'' name');
end $$;

-- Keep the existing RPC as the only entry point. New helpers are private
-- invokers; the delegated gateway retains its established definer behavior
-- with all direct caller grants revoked.
alter function public.recipe_api(text,jsonb) rename to recipe_api_before_owner_visibility;
alter function public.recipe_api_before_owner_visibility(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_owner_visibility(text,jsonb) from public,anon,authenticated,service_role;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text;result jsonb;recipe tlb.recipes;draft tlb.recipe_drafts;rid uuid;vid uuid;entry jsonb;doc jsonb;
 requested text;previous text;source_visibility text;draft_visibility text;denied boolean:=false;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, private, max-age=0"},{"Pragma":"no-cache"},{"Vary":"Authorization"}]',true);
 if p_action='bootstrap' then return tlb.recipe_api_before_owner_visibility(p_action,p_payload);end if;
 role_name:=tlb.recipe_assert();
 perform tlb.require(jsonb_typeof(p_payload)='object','Use an object for recipe request parameters.');
 if p_payload ? 'visibility' then
  perform tlb.recipe_assert(true,true);
  perform tlb.require(jsonb_typeof(p_payload->'visibility')='string' and p_payload->>'visibility' in ('staff','owner'),'Choose Shared with staff or Owner only.');
  requested:=p_payload->>'visibility';
 end if;
 if p_action='set_visibility' then
  perform tlb.recipe_assert(true,true);
  perform tlb.require(requested is not null,'Choose Shared with staff or Owner only.');
  select * into recipe from tlb.recipes where id=(p_payload->>'id')::uuid for update;
  perform tlb.require(recipe.id is not null,'Recipe not found or access denied.');
  perform tlb.require(recipe.revision=(p_payload->>'revision')::bigint,'This recipe changed. Reload before changing visibility.');
  if recipe.visibility<>requested then
   update tlb.recipes set visibility=requested,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=recipe.id;
   insert into tlb.recipe_audit(recipe_id,actor,action,details) values(recipe.id,auth.uid(),'visibility_changed',jsonb_build_object('previous_visibility',recipe.visibility,'visibility',requested));
  end if;
  return tlb.recipe_detail(recipe.id);
 end if;

 if p_action in ('get','costing','favorite','versions','runs','audit','tests','save','autosave','set_status','delete','undelete','access_check','scale','export_authorize','export','export_data','print','pdf','csv','download') then rid:=nullif(p_payload->>'id','')::uuid;end if;
 if p_action in ('save_test','media_authorize') then rid:=nullif(p_payload->>'recipe_id','')::uuid;end if;
 vid:=nullif(p_payload->>'version_id','')::uuid;
 if p_payload ? 'version_ids' then
  perform tlb.require(jsonb_typeof(p_payload->'version_ids')='array','Choose valid recipe versions.');
  for entry in select value from jsonb_array_elements(p_payload->'version_ids') loop
   perform tlb.require(jsonb_typeof(entry)='string' and entry#>>'{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','Choose valid recipe versions.');
   if not tlb.recipe_version_visible((entry#>>'{}')::uuid) then denied:=true;end if;
  end loop;
 end if;
 if role_name<>'owner' then
  denied:=denied or not tlb.recipe_owner_json_visible(p_payload)
   or (rid is not null and not tlb.recipe_owner_recipe_visible(rid))
   or (vid is not null and not tlb.recipe_owner_version_visible(vid));
  if p_action='autosave' then
   select * into draft from tlb.recipe_drafts where user_id=auth.uid() and draft_id=(p_payload->>'draft_id')::uuid;
   denied:=denied or (draft.draft_id is not null and (draft.visibility='owner' or
    (draft.recipe_id is not null and not tlb.recipe_owner_recipe_visible(draft.recipe_id)) or not tlb.recipe_owner_json_visible(draft.document)));
  end if;
  if p_action='save_test' and nullif(p_payload->>'id','') is not null then
   -- A caller cannot erase an inaccessible saved testing snapshot by omitting
   -- its private references from a replacement payload.
   denied:=denied or exists(select 1 from tlb.recipe_tests t where t.id=(p_payload->>'id')::uuid
    and not tlb.recipe_owner_json_visible(to_jsonb(t)));
  end if;
  for doc in select value from jsonb_each(p_payload) where key in ('document','proposed_document') and jsonb_typeof(value)='object' loop
   denied:=denied or not tlb.recipe_owner_json_visible(tlb.recipe_packaging_document(doc,false));
  end loop;
 end if;
 if denied then
  perform set_config('response.status','403',true);
  return jsonb_build_object('error',true,'code','42501','reason','recipe_denied','message','Recipe not found or access denied.');
 end if;

 if p_action='duplicate' then
  select r.visibility into source_visibility from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id where v.id=vid;
 elsif p_action='save' then
  select visibility into previous from tlb.recipes where id=rid;
 elsif p_action='autosave' then
  select visibility into draft_visibility from tlb.recipe_drafts where user_id=auth.uid() and draft_id=(p_payload->>'draft_id')::uuid;
  select visibility into source_visibility from tlb.recipes where id=rid;
 end if;
 result:=tlb.recipe_api_before_owner_visibility(p_action,p_payload);
 if coalesce((result->>'error')::boolean,false) then return result;end if;
 if p_action in ('create','save','duplicate') then
  rid:=(result->>'id')::uuid;
  if requested is not null or (p_action='duplicate' and source_visibility='owner') then
   update tlb.recipes set visibility=coalesce(requested,source_visibility,'staff') where id=rid;
   if p_action='save' and previous is distinct from requested then
    insert into tlb.recipe_audit(recipe_id,actor,action,details) values(rid,auth.uid(),'visibility_changed',jsonb_build_object('previous_visibility',previous,'visibility',requested));
   end if;
   result:=tlb.recipe_detail(rid,(result->>'version_id')::uuid);
  end if;
 elsif p_action='autosave' then
  update tlb.recipe_drafts set visibility=coalesce(requested,case when source_visibility='owner' then 'owner' end,draft_visibility,'staff')
   where user_id=auth.uid() and draft_id=(p_payload->>'draft_id')::uuid returning visibility into draft_visibility;
  result:=result||jsonb_build_object('visibility',draft_visibility);
 elsif p_action in ('resources','save_resource') and role_name<>'owner' then
  result:=tlb.recipe_owner_redact_files(result);
 end if;
 return result;
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;

revoke all on function tlb.recipe_owner_hidden_versions(),tlb.recipe_owner_hidden_tests(),tlb.recipe_owner_version_visible(uuid),
 tlb.recipe_owner_recipe_visible(uuid),tlb.recipe_owner_file_visible(uuid),tlb.recipe_owner_json_visible(jsonb),
 tlb.recipe_owner_redact_files(jsonb),tlb.recipe_owner_uuid(text),tlb.recipe_owner_json_refs(jsonb),
 tlb.recipe_owner_snapshot_has_file(jsonb,uuid,text) from public,anon,authenticated,service_role;

-- Backup rows use to_jsonb(recipes.*), so full and Final archives retain the
-- access field without changing their existing recipe/version selection.
commit;
