begin;
set local lock_timeout='3s';

-- Recoverable catalog deletion keeps version references, quotes and photos intact.
alter table tlb.recipe_resources add column deleted_at timestamptz;
alter table tlb.recipe_categories add column deleted_at timestamptz;
alter table tlb.recipe_categories add column revision bigint not null default 1;

-- Filter before pagination, including when older clients request inactive rows.
do $$ declare source text; begin
 source:=pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure);
 if strpos(source,'where kind=p_payload->>''kind'' and (q=')=0 then raise exception 'Resource listing changed; review migration.';end if;
 source:=replace(source,'where kind=p_payload->>''kind'' and (q=',
 'where kind=p_payload->>''kind'' and (case when coalesce((p_payload->>''deleted'')::boolean,false) then deleted_at is not null else deleted_at is null end) and (q=');
 source:=replace(source,'active=excluded.active;return jsonb_build_object(''id'',fid);','active=excluded.active,revision=tlb.recipe_categories.revision+1;return jsonb_build_object(''id'',fid);');
 execute source;
 source:=pg_get_functiondef('tlb.recipe_current_price(uuid,text,text)'::regprocedure);
 source:=replace(source,'where id=p_resource)','where id=p_resource and deleted_at is null)');
 source:=replace(source,'and s.active)','and s.active and s.deleted_at is null)');
 source:=replace(source,'p.supplier_id=nullif(r.data->>''preferred_supplier_id'','''')::uuid)',
 'p.supplier_id=nullif(r.data->>''preferred_supplier_id'','''')::uuid or exists(select 1 from tlb.recipe_resources s where s.id=nullif(r.data->>''preferred_supplier_id'','''')::uuid and s.deleted_at is not null))');
 execute source;
 source:=pg_get_functiondef('public.recipe_api(text,jsonb)'::regprocedure);
 source:=replace(source,'kind=''supplier'' and lower(regexp_replace','kind=''supplier'' and deleted_at is null and lower(regexp_replace');
 source:=replace(source,'kind=p_payload->>''kind'' and lower(regexp_replace','kind=p_payload->>''kind'' and deleted_at is null and lower(regexp_replace');
 source:=replace(source,'where i.resource_id=(r->>''id'')::uuid),''[]'')','where i.resource_id=(r->>''id'')::uuid and s.deleted_at is null),''[]'')');
 execute source;
end $$;

alter function public.recipe_api(text,jsonb) rename to recipe_api_before_catalog_deletion;
alter function public.recipe_api_before_catalog_deletion(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_catalog_deletion(text,jsonb) from public,anon,authenticated,service_role;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); resource tlb.recipe_resources; category tlb.recipe_categories; supplier_id uuid; offer jsonb; target uuid;
begin
 -- Serialize catalog changes so a concurrent purchase/save cannot resurrect a deletion.
 if p_action in ('save_resource','record_purchase','delete_resource','restore_resource','save_category','delete_category','restore_category') then
  perform tlb.recipe_assert(true);
  perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.catalog',0));
 end if;
 if p_action='resources' and coalesce((p_payload->>'deleted')::boolean,false) then perform tlb.recipe_assert(true,true);end if;
 if p_action in ('delete_resource','restore_resource') then
  perform tlb.recipe_assert(true,true);
  select * into resource from tlb.recipe_resources where id=(p_payload->>'id')::uuid for update;
  perform tlb.require(found,'Record not found.');
  perform tlb.require(resource.revision=(p_payload->>'revision')::bigint,'This record changed. Reload before trying again.');
  perform tlb.require((resource.deleted_at is null)=(p_action='delete_resource'),'This record was already deleted or restored. Reload the list.');
  update tlb.recipe_resources set deleted_at=case when p_action='delete_resource' then now() end,revision=revision+1,updated_at=now(),updated_by=uid where id=resource.id;
  insert into tlb.recipe_audit(actor,action,details) values(uid,case when p_action='delete_resource' then 'resource_deleted' else 'resource_restored' end,jsonb_build_object('previous',to_jsonb(resource),'resource_id',resource.id));
  return jsonb_build_object('saved',true);
 elsif p_action in ('delete_category','restore_category') then
  perform tlb.recipe_assert(true,true);
  select * into category from tlb.recipe_categories where id=(p_payload->>'id')::uuid for update;
  perform tlb.require(found,'Category not found.');
  perform tlb.require(category.revision=(p_payload->>'revision')::bigint,'This category changed. Reload before trying again.');
  perform tlb.require((category.deleted_at is null)=(p_action='delete_category'),'This category was already deleted or restored. Reload the list.');
  if p_action='delete_category' then
   perform tlb.require(not exists(select 1 from tlb.recipe_categories where parent_id=category.id and deleted_at is null),'Move or delete its subcategories first.');
  else
   perform tlb.require(category.parent_id is null or exists(select 1 from tlb.recipe_categories where id=category.parent_id and deleted_at is null),'Restore its parent category first.');
  end if;
  update tlb.recipe_categories set deleted_at=case when p_action='delete_category' then now() end,revision=revision+1 where id=category.id;
  insert into tlb.recipe_audit(actor,action,details) values(uid,case when p_action='delete_category' then 'category_deleted' else 'category_restored' end,jsonb_build_object('previous',to_jsonb(category),'category_id',category.id));
  return jsonb_build_object('saved',true);
 elsif p_action='save_resource' then
  target:=nullif(p_payload->>'id','')::uuid;
  if target is not null then perform tlb.require(exists(select 1 from tlb.recipe_resources where id=target and deleted_at is null),'This record was deleted. Restore it before editing.');end if;
  for supplier_id in
   select nullif(v,'')::uuid from (values (p_payload#>>'{data,supplier_id}'),(p_payload#>>'{data,preferred_supplier_id}'),(p_payload#>>'{price,supplier_id}')) refs(v) where nullif(v,'') is not null
   union select nullif(value->>'supplier_id','')::uuid from jsonb_array_elements(coalesce(p_payload->'suppliers','[]')) where nullif(value->>'supplier_id','') is not null
  loop
   perform tlb.require(exists(select 1 from tlb.recipe_resources where id=supplier_id and kind='supplier' and deleted_at is null),'Supplier not found or deleted. Reload and choose an available supplier.');
  end loop;
 elsif p_action='record_purchase' and nullif(p_payload->>'resource_id','') is not null then
  perform tlb.require(exists(select 1 from tlb.recipe_resources where id=(p_payload->>'resource_id')::uuid and deleted_at is null),'This item was deleted. Restore it or choose another item.');
 elsif p_action='save_category' then
  perform tlb.recipe_assert(true,true);
  target:=nullif(p_payload->>'id','')::uuid;
  if target is not null then
   select * into category from tlb.recipe_categories where id=target;
   perform tlb.require(found and category.deleted_at is null,'This category was deleted. Restore it before editing.');
   if p_payload->>'revision' is not null then perform tlb.require(category.revision=(p_payload->>'revision')::bigint,'This category changed. Reload before saving.');end if;
  end if;
  target:=nullif(p_payload->>'parent_id','')::uuid;
  if target is not null then perform tlb.require(exists(select 1 from tlb.recipe_categories where id=target and deleted_at is null),'Choose an available parent category.');end if;
 end if;
 return tlb.recipe_api_before_catalog_deletion(p_action,p_payload);
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon,service_role;
grant execute on function public.recipe_api(text,jsonb) to authenticated;
commit;
