begin;
set local lock_timeout='3s';

-- New archives contain current library data. Historical archives stay readable.
alter table tlb.recipe_backup_jobs add column scope text not null default 'full' check(scope in ('full','essentials'));
alter table tlb.recipe_backup_slots add column scope text not null default 'full' check(scope in ('full','essentials'));
create or replace function tlb.recipe_backup_tables() returns text[] language sql immutable set search_path='' as $$
 select array['recipe_settings','recipe_categories','recipe_resources','recipe_supplier_items','recipe_prices','recipes','recipe_versions',
 'recipe_links','recipe_ingredient_links','recipe_files','recipe_file_links']
$$;

create function tlb.recipe_backup_essential_rows() returns table(table_key text,record_id text,data jsonb)
language sql stable security invoker set search_path='' as $$
 with recursive latest as materialized (
  select distinct on (v.recipe_id) v.recipe_id,v.id from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id
  where r.deleted_at is null order by v.recipe_id,v.number desc,v.id
 ), needed(id) as (
  select id from latest union select l.target_version_id from tlb.recipe_links l join needed n on l.version_id=n.id
 ), versions as materialized (
  select v.*,tlb.recipe_capture_costs_current(v.document,true,0) current_cost from tlb.recipe_versions v join needed n on n.id=v.id
 ), resources as materialized (
  select * from tlb.recipe_resources where kind in ('ingredient','supplier','packaging')
 ), prices as materialized (
  select distinct on (p.resource_id,p.supplier_id) p.* from tlb.recipe_prices p join resources r on r.id=p.resource_id
  where p.supplier_id is null or exists(select 1 from resources s where s.id=p.supplier_id)
  order by p.resource_id,p.supplier_id,p.created_at desc,p.id
 ), files as materialized (
  select f.* from tlb.recipe_files f where f.uploaded and (
   exists(select 1 from tlb.recipe_file_links l join needed n on n.id=l.version_id where l.file_id=f.id and l.test_id is null)
   or exists(select 1 from resources r cross join lateral jsonb_path_query(r.data,'$.**.file_id') value where value#>>'{}'=f.id::text)
  )
 ), core as materialized (
  select 'recipe_settings'::text table_key,t.id::text record_id,to_jsonb(t) data from tlb.recipe_settings t
  union all select 'recipe_categories',t.id::text,to_jsonb(t) from tlb.recipe_categories t
  union all select 'recipe_resources',t.id::text,to_jsonb(t) from resources t
  union all select 'recipe_supplier_items',t.resource_id::text||':'||t.supplier_id::text,to_jsonb(t) from tlb.recipe_supplier_items t
   where exists(select 1 from resources r where r.id=t.resource_id) and exists(select 1 from resources r where r.id=t.supplier_id)
  union all select 'recipe_prices',t.id::text,to_jsonb(t) from prices t
  union all select 'recipes',r.id::text,to_jsonb(r)||jsonb_build_object(
   'current_version_id',coalesce(l.id,(select v.id from versions v where v.recipe_id=r.id order by v.number desc limit 1)),
   'production_version_id',case when exists(select 1 from needed n where n.id=r.production_version_id) then r.production_version_id end)
   from tlb.recipes r left join latest l on l.recipe_id=r.id where exists(select 1 from versions v where v.recipe_id=r.id)
  union all select 'recipe_versions',v.id::text,(to_jsonb(v)-'search_text'-'kitchen_search'-'current_cost')||jsonb_build_object(
   'document',v.current_cost->'document','cost_snapshot',v.current_cost->'snapshot','reason','') from versions v
  union all select 'recipe_links',t.version_id::text||':'||t.link_id,to_jsonb(t) from tlb.recipe_links t join needed n on n.id=t.version_id
  union all select 'recipe_ingredient_links',t.version_id::text||':'||t.row_id,to_jsonb(t) from tlb.recipe_ingredient_links t join needed n on n.id=t.version_id
  union all select 'recipe_files',t.id::text,to_jsonb(t) from files t
  union all select 'recipe_file_links',t.file_id::text||':'||t.version_id::text,to_jsonb(t) from tlb.recipe_file_links t
   join files f on f.id=t.file_id join needed n on n.id=t.version_id where t.test_id is null
 )
 select * from core
 union all select 'actors',u.id::text,jsonb_build_object('id',u.id,'email',u.email,'role',case when exists(select 1 from tlb.staff s where s.user_id=u.id and s.role='owner') then 'owner' end)
 from auth.users u where exists(select 1 from tlb.staff s where s.user_id=u.id and s.role='owner') or exists(
  select 1 from core c where u.id::text in (c.data->>'created_by',c.data->>'updated_by')
 )
$$;
revoke all on function tlb.recipe_backup_essential_rows() from public,anon,authenticated,service_role;

-- Preserve the checked worker API, leases, quotas and verified Drive completion.
do $$ declare source text;start_at integer;end_at integer;hook text;begin
 source:=replace(pg_get_functiondef('public.recipe_backup_service(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 start_at:=strpos(source,'foreach table_name in array tlb.recipe_backup_tables() loop');
 end_at:=strpos(source,'select count(*),count(*) filter(where table_key=');
 perform tlb.require(start_at>0 and end_at>start_at,'Missing backup snapshot hook.');
 source:=substr(source,1,start_at-1)||E'insert into tlb.recipe_backup_rows(job_id,table_key,record_id,data) select jid,table_key,record_id,data from tlb.recipe_backup_essential_rows();\n   '||substr(source,end_at);
 hook:='update tlb.recipe_backup_jobs set record_count=snapshot_records,file_count=snapshot_files where id=jid;';
 perform tlb.require(strpos(source,hook)>0,'Missing backup scope hook.');
 source:=replace(source,hook,'update tlb.recipe_backup_jobs set record_count=snapshot_records,file_count=snapshot_files,scope=case when kind_name=''monthly'' then source_slot.scope else ''essentials'' end where id=jid;');
 source:=replace(source,'''generated_at'',now(),''record_count'',snapshot_records','''generated_at'',now(),''scope'',case when kind_name=''monthly'' then source_slot.scope else ''essentials'' end,''record_count'',snapshot_records');
 -- Jobs that began before this migration may finish reading their own staged tables.
 source:=replace(source,'p_payload->>''table''=any(tlb.recipe_backup_tables()) or p_payload->>''table''=''actors''',
 'p_payload->>''table''=any(tlb.recipe_backup_tables()) or p_payload->>''table''=''actors'' or exists(select 1 from tlb.recipe_backup_rows where job_id=j.id and table_key=p_payload->>''table'')');
 source:=replace(source,'record_count=j.record_count,file_count=j.file_count where id=j.slot_id;',
 'record_count=j.record_count,file_count=j.file_count,scope=j.scope where id=j.slot_id;');
 execute source;
end $$;

do $$ declare source text;begin
 source:=pg_get_functiondef('tlb.recipe_backup_status()'::regprocedure);
 source:=replace(source,'''schedule'',''Daily at 02:00','''scope'',''essentials'',''schedule'',''Daily at 02:00');
 execute source;
end $$;
commit;
