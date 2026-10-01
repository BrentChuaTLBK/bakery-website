begin;
set local lock_timeout='3s';

-- One account-wide permission. Existing non-owner accounts start without it.
alter table tlb.recipe_access add column can_view_rd boolean not null default false;
alter table tlb.recipe_drafts add column requires_rd boolean not null default false;

create function tlb.recipe_can_view_rd() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(tlb.recipe_role(auth.uid())='owner' or
  (tlb.recipe_role(auth.uid()) is not null and (select can_view_rd from tlb.recipe_access where user_id=auth.uid())),false)
$$;

-- Check every pinned dependency as well as the requested version. A working
-- R&D recipe may still expose its previously published Final to normal staff.
create function tlb.recipe_version_visible(p_version uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 with recursive chain(id) as (
  select p_version union select l.target_version_id from tlb.recipe_links l join chain c on c.id=l.version_id
 ) select exists(select 1 from tlb.recipe_versions where id=p_version) and
 (tlb.recipe_can_view_rd() or not exists(
  select 1 from chain c join tlb.recipe_versions v on v.id=c.id
  join tlb.recipes r on r.id=v.recipe_id join tlb.recipe_versions current on current.id=r.current_version_id
  where v.status='testing' or (current.status='testing' and v.status not in ('approved','production'))))
$$;

create function tlb.recipe_listing_version(p_recipe uuid,p_kitchen boolean default false,p_rd boolean default false) returns uuid
language sql stable security invoker set search_path='' as $$
 select case when p_rd then case when tlb.recipe_can_view_rd() and v.status='testing' then v.id end
  when p_kitchen then r.production_version_id
  when tlb.recipe_version_visible(v.id) then v.id else r.production_version_id end
 from tlb.recipes r join tlb.recipe_versions v on v.id=r.current_version_id where r.id=p_recipe
$$;

create function tlb.recipe_document_visible(p_doc jsonb) returns boolean
language sql stable security invoker set search_path='' as $$
 select tlb.recipe_can_view_rd() or not exists(
  select 1 from (
   select nullif(p_doc#>>'{base,version_id}','')::uuid id
   union all select nullif(c->>'version_id','')::uuid
   from jsonb_array_elements(coalesce(p_doc->'variants','[]')) v
   cross join lateral jsonb_array_elements(coalesce(v->'components','[]')) c
  ) refs where id is not null and not tlb.recipe_version_visible(id))
$$;

-- Bulk reads calculate the restricted set once, including parents that pin a
-- restricted dependency. Avoid one authorization/tree walk per library row.
create function tlb.recipe_hidden_versions() returns table(id uuid)
language sql stable security invoker set search_path='' as $$
 with recursive hidden(id) as (
  select v.id from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id
  join tlb.recipe_versions current on current.id=r.current_version_id
  where v.status='testing' or (current.status='testing' and v.status not in ('approved','production'))
  union select l.version_id from tlb.recipe_links l join hidden h on h.id=l.target_version_id
 ) select id from hidden
$$;

create or replace function tlb.recipe_readable_versions() returns table(id uuid)
language sql stable security invoker set search_path='' as $$
 with recursive published(id) as (
  select r.production_version_id from tlb.recipes r where r.deleted_at is null and r.production_version_id is not null
  union
  select l.target_version_id from tlb.recipe_links l join published p on p.id=l.version_id where l.kind='component'
 ), research(id) as (
  select r.current_version_id from tlb.recipes r join tlb.recipe_versions v on v.id=r.current_version_id
  where r.deleted_at is null and v.status='testing' and (select tlb.recipe_can_view_rd())
  union select l.target_version_id from tlb.recipe_links l join research p on p.id=l.version_id where l.kind='component'
 ) select id from published where (select tlb.recipe_can_view_rd()) or id not in(select id from tlb.recipe_hidden_versions()) union select id from research
$$;

-- Keep the storage policy bound to the existing public function identity.
create function tlb.recipe_file_visible(p_file uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select tlb.recipe_can_view_rd()
 or not exists(select 1 from tlb.recipe_file_links where file_id=p_file)
 or exists(select 1 from tlb.recipe_file_links l where l.file_id=p_file and l.version_id is not null and tlb.recipe_version_visible(l.version_id))
 or exists(select 1 from tlb.recipe_resources r cross join lateral jsonb_array_elements(coalesce(r.data->'photos','[]')) p where r.kind='packaging' and p->>'file_id'=p_file::text)
$$;

do $$ declare source text;hook text;begin
 source:=pg_get_functiondef('public.recipe_file_access(text,boolean)'::regprocedure);
 hook:='if role_name in (''owner'',''chef'') then';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe file access hook.');
 source:=replace(source,hook,$hook$if role_name='chef' and not p_write and not tlb.recipe_can_view_rd() then
  return exists(select 1 from tlb.recipe_files f where f.path=p_path and tlb.recipe_file_visible(f.id));
 end if;
 if role_name in ('owner','chef') then$hook$);
 execute source;

 source:=pg_get_functiondef('tlb.recipe_detail(uuid,uuid,boolean)'::regprocedure);
 hook:='case when role_name=''kitchen'' then r.production_version_id else r.current_version_id end';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe detail version hook.');
 source:=replace(source,hook,'tlb.recipe_listing_version(r.id,role_name=''kitchen'')');
 hook:=' perform tlb.require(v.id is not null,''Recipe version not found.'');';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe detail visibility hook.');
 source:=replace(source,hook,hook||E'\n perform tlb.require(tlb.recipe_version_visible(v.id),''R&D access is required for this recipe.'');');
 hook:='''production_version_id'',r.production_version_id';
 source:=replace(source,hook,$hook$'rd_restricted',not tlb.recipe_can_view_rd() and exists(select 1 from tlb.recipe_versions where id=r.current_version_id and status='testing'),'production_version_id',r.production_version_id$hook$);
 execute source;

 source:=pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure);
 hook:='uid uuid:=auth.uid();rid uuid;';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe list permission declaration hook.');
 source:=replace(source,hook,$hook$uid uuid:=auth.uid();can_rd boolean:=tlb.recipe_can_view_rd();hidden_versions uuid[]:=case when can_rd or p_action<>'list' then '{}'::uuid[] else array(select id from tlb.recipe_hidden_versions()) end;rid uuid;$hook$);
 hook:='case when role_name=''kitchen'' then r.production_version_id else r.current_version_id end';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe list version hook.');
 source:=replace(source,hook,$hook$case when coalesce((p_payload->>'rd')::boolean,false) then r.current_version_id when role_name='kitchen' or r.current_version_id=any(hidden_versions) then r.production_version_id else r.current_version_id end$hook$);
 hook:='left join tlb.recipe_user_state u on u.recipe_id=r.id and u.user_id=uid';
 -- Join filtering applies before both pagination and total/search counting.
 source:=replace(source,hook,$hook$and not(v.id=any(hidden_versions)) and (not coalesce((p_payload->>'rd')::boolean,false) or v.status='testing') $hook$||hook);
 hook:='''version'',v.number,''updated_at'',v.created_at';
 source:=replace(source,hook,$hook$'rd_restricted',not can_rd and exists(select 1 from tlb.recipe_versions where id=r.current_version_id and status='testing'),'version',v.number,'updated_at',v.created_at$hook$);
 source:=replace(source,'where v.created_by=u.id)','where v.created_by=u.id and (can_rd or tlb.recipe_version_visible(v.id)))');
 hook:='select * from tlb.recipe_versions where recipe_id=(p_payload->>''id'')::uuid order by number desc';
 perform tlb.require(strpos(source,hook)>0,'Missing version history visibility hook.');
 source:=replace(source,hook,'select * from tlb.recipe_versions where recipe_id=(p_payload->>''id'')::uuid and tlb.recipe_version_visible(id) order by number desc');
 hook:='select * from tlb.recipe_drafts where user_id=uid order by updated_at desc';
 perform tlb.require(strpos(source,hook)>0,'Missing draft visibility hook.');
 source:=replace(source,hook,$hook$select * from tlb.recipe_drafts where user_id=uid and
 (tlb.recipe_can_view_rd() or (not requires_rd and tlb.recipe_document_visible(document) and
 not exists(select 1 from tlb.recipes r join tlb.recipe_versions v on v.id=r.current_version_id where r.id=recipe_drafts.recipe_id and v.status='testing')))
 order by updated_at desc$hook$);
 hook:='select * from tlb.recipe_audit where recipe_id=(p_payload->>''id'')::uuid order by id desc';
 perform tlb.require(strpos(source,hook)>0,'Missing audit visibility hook.');
 source:=replace(source,hook,$hook$select * from tlb.recipe_audit where recipe_id=(p_payload->>'id')::uuid and
 (tlb.recipe_can_view_rd() or (action not like 'test%' and action<>'test_promoted'
 and (details->>'version_id' is null or tlb.recipe_version_visible((details->>'version_id')::uuid))
 and (details->>'previous_version_id' is null or tlb.recipe_version_visible((details->>'previous_version_id')::uuid)))) order by id desc$hook$);
 execute source;

 source:=pg_get_functiondef('public.recipe_api(text,jsonb)'::regprocedure);
 hook:='declare record jsonb;';
 perform tlb.require(strpos(source,hook)>0,'Missing costing overview permission declaration hook.');
 source:=replace(source,hook,$hook$declare can_rd boolean:=tlb.recipe_can_view_rd();hidden_versions uuid[]:=case when can_rd or p_action<>'costing_overview' then '{}'::uuid[] else array(select id from tlb.recipe_hidden_versions()) end;record jsonb;$hook$);
 hook:='from tlb.recipes r join tlb.recipe_versions v on v.id=r.current_version_id';
 perform tlb.require(strpos(source,hook)>0,'Missing costing overview visibility hook.');
 source:=replace(source,hook,'from tlb.recipes r join tlb.recipe_versions v on v.id=case when r.current_version_id=any(hidden_versions) then r.production_version_id else r.current_version_id end and not(v.id=any(hidden_versions))');
 source:=replace(source,'select r.id,r.name,r.code,r.updated_at,r.category_id,v.id version_id','select r.id,v.document->>''name'' name,r.code,v.created_at updated_at,nullif(v.document->>''category_id'','''')::uuid category_id,v.id version_id');
 source:=replace(source,'or r.name ilike','or v.document->>''name'' ilike');
 source:=replace(source,'or r.category_id=(p_payload->>''category_id'')::uuid','or v.document->>''category_id''=p_payload->>''category_id''');
 source:=replace(source,'or r.updated_at>=now()','or v.created_at>=now()');
 execute source;
end $$;

-- Classify existing working copies without changing their formulas.
update tlb.recipe_drafts d set requires_rd=true where exists(
 select 1 from tlb.recipe_versions v where v.recipe_id=d.recipe_id and v.status='testing');

alter function public.recipe_api(text,jsonb) rename to recipe_api_before_rd_access;
alter function public.recipe_api_before_rd_access(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_rd_access(text,jsonb) from public,anon,authenticated,service_role;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare role_name text;can_rd boolean;result jsonb;target uuid;rid uuid;vid uuid;doc jsonb;file jsonb;needs_rd boolean:=false;
begin
 -- Invitation claiming must run before asserting the newly granted role.
 if p_action='bootstrap' then
  result:=tlb.recipe_api_before_rd_access(p_action,p_payload);
  return result||jsonb_build_object('can_view_rd',tlb.recipe_can_view_rd());
 end if;
 role_name:=tlb.recipe_assert();can_rd:=tlb.recipe_can_view_rd();
 if p_action='save_rd_access' then
  perform tlb.recipe_assert(true,true);target:=(p_payload->>'user_id')::uuid;
  perform tlb.require(tlb.recipe_role(target) is distinct from 'owner','Owners retain full R&D access.');
  perform tlb.require(jsonb_typeof(p_payload->'can_view_rd')='boolean','Choose whether this account can view R&D.');
  update tlb.recipe_access set can_view_rd=(p_payload->>'can_view_rd')::boolean,granted_by=auth.uid(),updated_at=now() where user_id=target;
  perform tlb.require(found,'Give this account recipe access first.');
  insert into tlb.recipe_audit(actor,action,details) values(auth.uid(),'rd_access_changed',jsonb_build_object('user_id',target,'can_view_rd',p_payload->'can_view_rd'));
  return jsonb_build_object('saved',true);
 elsif p_action='access' then
  result:=tlb.recipe_api_before_rd_access(p_action,p_payload);
  return coalesce((select jsonb_agg(p||jsonb_build_object('can_view_rd',coalesce(p->>'role'='owner',false) or coalesce((select a.can_view_rd from tlb.recipe_access a where a.user_id=nullif(p->>'user_id','')::uuid),false))) from jsonb_array_elements(result) p),'[]');
 end if;
 if coalesce((p_payload->>'rd')::boolean,false) or p_action in ('tests','save_test','promote_test')
  or p_payload->>'status'='testing' or (p_action='duplicate' and p_payload->>'mode'='test') then
  perform tlb.require(can_rd,'R&D access is required. Ask the owner to enable Can view R&D.');
 end if;
 if p_action in ('get','costing','favorite','versions','runs','audit','save','autosave','set_status','delete','undelete') then rid:=nullif(p_payload->>'id','')::uuid;end if;
 if p_action='save_test' then rid:=nullif(p_payload->>'recipe_id','')::uuid;end if;
 vid:=nullif(p_payload->>'version_id','')::uuid;
 if vid is not null then perform tlb.require(tlb.recipe_version_visible(vid),'R&D access is required for this recipe version.');end if;
 if rid is not null then
  select v.status='testing' into needs_rd from tlb.recipes r join tlb.recipe_versions v on v.id=r.current_version_id where r.id=rid;
  if not can_rd and coalesce(needs_rd,false) and p_action in ('save','autosave','set_status','delete','undelete','audit') then
   raise exception 'R&D access is required for this recipe.';
  end if;
 end if;
 if p_action='restore_version' and not can_rd then
  perform tlb.require(not exists(select 1 from tlb.recipe_versions source join tlb.recipes r on r.id=source.recipe_id join tlb.recipe_versions current on current.id=r.current_version_id where source.id=vid and current.status='testing'),'R&D access is required for this recipe.');
 end if;
 for doc in select value from jsonb_each(p_payload) where key in ('document','proposed_document') and jsonb_typeof(value)='object' loop
  perform tlb.require(tlb.recipe_document_visible(doc),'R&D access is required for a linked recipe.');
  for file in select value from jsonb_array_elements(coalesce(doc->'files','[]')) loop
   perform tlb.require(tlb.recipe_file_visible((file->>'id')::uuid),'R&D access is required for this attachment.');
  end loop;
 end loop;
 if p_action='save_resource' then
  for file in select value from jsonb_array_elements(coalesce(p_payload#>'{data,photos}','[]')) loop
   perform tlb.require(tlb.recipe_file_visible((file->>'file_id')::uuid),'R&D access is required for this attachment.');
  end loop;
 end if;
 if p_action='get' and coalesce((p_payload->>'rd')::boolean,false) and vid is null then
  vid:=tlb.recipe_listing_version(rid,true,true);
  perform tlb.require(vid is not null,'R&D recipe not found.');p_payload:=p_payload||jsonb_build_object('version_id',vid);
 end if;
 if p_action='autosave' then
  perform tlb.require(can_rd or not exists(select 1 from tlb.recipe_drafts where user_id=auth.uid() and draft_id=(p_payload->>'draft_id')::uuid and requires_rd),'R&D access is required for this working copy.');
 end if;
 result:=tlb.recipe_api_before_rd_access(p_action,p_payload);
 if p_action='autosave' then
  update tlb.recipe_drafts set requires_rd=requires_rd or coalesce(needs_rd,false) or coalesce(p_payload->>'status'='testing',false)
   or exists(select 1 from jsonb_array_elements(coalesce(p_payload#>'{document,variants}','[]')) v cross join lateral jsonb_array_elements(coalesce(v->'components','[]')) c join tlb.recipe_versions ver on ver.id=nullif(c->>'version_id','')::uuid where ver.status='testing')
   where user_id=auth.uid() and draft_id=(p_payload->>'draft_id')::uuid;
 end if;
 return result;
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;
revoke all on function tlb.recipe_can_view_rd(),tlb.recipe_version_visible(uuid),tlb.recipe_listing_version(uuid,boolean,boolean),tlb.recipe_document_visible(jsonb),tlb.recipe_file_visible(uuid),tlb.recipe_hidden_versions() from public,anon,authenticated,service_role;
commit;
