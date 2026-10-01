begin;
set local lock_timeout='3s';

-- Owner-approved automatic costing default. Explicit preferences, currency,
-- compatible units, active suppliers and immutable saved snapshots are retained.
do $$ declare source text; begin
 source:=pg_get_functiondef('tlb.recipe_current_price(uuid,text,text)'::regprocedure);
 if strpos(source,'order by p.amount/p.quantity/(tlb.recipe_unit(p.unit)->>1)::numeric,p.created_at desc,p.id limit 1')=0 then raise exception 'Price selection changed; review migration.';end if;
 source:=replace(source,'order by p.amount/p.quantity/(tlb.recipe_unit(p.unit)->>1)::numeric,p.created_at desc,p.id limit 1',
 'order by p.amount/p.quantity/(tlb.recipe_unit(p.unit)->>1)::numeric desc,p.created_at desc,p.id limit 1');
 execute source;
end $$;

create function tlb.recipe_resource_page(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare lim integer:=least(100,greatest(1,coalesce((p_payload->>'limit')::integer,100)));
 off integer:=greatest(0,coalesce((p_payload->>'offset')::integer,0));
 q text:=left(btrim(coalesce(p_payload->>'query','')),200);resource_kind text:=p_payload->>'kind';
 removed boolean:=coalesce((p_payload->>'deleted')::boolean,false);total bigint; result jsonb;
begin
 perform tlb.recipe_assert(true,removed);
 perform tlb.require(resource_kind in ('ingredient','packaging','supplier','equipment'),'Choose a resource type.');
 select count(*) into total from tlb.recipe_resources r where r.kind=resource_kind
  and (case when removed then r.deleted_at is not null else r.deleted_at is null end)
  and (q='' or r.name ilike '%'||q||'%') and (coalesce((p_payload->>'include_inactive')::boolean,false) or r.active);
 off:=least(off,greatest(0,((total-1)/lim)::integer*lim));
 with matched as materialized (
  select r.*,case when p.id is not null then to_jsonb(p) end price,
   case when p.id is not null then p.currency||':'||(tlb.recipe_unit(p.unit)->>0) end cost_group,
   p.amount/nullif(p.quantity,0)/(tlb.recipe_unit(p.unit)->>1)::numeric unit_cost
  from tlb.recipe_resources r left join lateral tlb.recipe_current_price(r.id) p on true
  where r.kind=resource_kind and (case when removed then r.deleted_at is not null else r.deleted_at is null end)
   and (q='' or r.name ilike '%'||q||'%') and (coalesce((p_payload->>'include_inactive')::boolean,false) or r.active)
 ), ranked as (
  select m.*,row_number() over(order by
   case when p_payload->>'sort'='cost' then cost_group end asc nulls last,
   case when p_payload->>'sort'='cost' then unit_cost end asc nulls last,
   lower(name),lower(coalesce(data->>'brand','')),id) position from matched m
 ), page as (select * from ranked order by position limit lim offset off)
 select coalesce(jsonb_agg((to_jsonb(r)-'position'-'cost_group'-'unit_cost')||jsonb_build_object(
  'suppliers',coalesce((select jsonb_agg(jsonb_build_object('supplier_id',i.supplier_id,'name',s.name,'notes',i.notes,'active',s.active,
   'price',(select to_jsonb(p) from tlb.recipe_prices p where p.resource_id=i.resource_id and p.supplier_id=i.supplier_id order by created_at desc,id limit 1)) order by s.name)
   from tlb.recipe_supplier_items i join tlb.recipe_resources s on s.id=i.supplier_id where i.resource_id=r.id),'[]'),
  'unassigned_price',(select to_jsonb(p) from tlb.recipe_prices p where p.resource_id=r.id and p.supplier_id is null order by created_at desc,id limit 1)
 ) order by position),'[]') into result from page r;
 return jsonb_build_object('rows',result,'total',total,'offset',off,'limit',lim);
end;
$$;
revoke all on function tlb.recipe_resource_page(jsonb) from public,anon,authenticated,service_role;

-- Keep the existing public authorization/session wrappers and all older callers.
-- Only catalog tables opt into global sorting, exact counts and page clamping.
do $$ declare source text; begin
 source:=pg_get_functiondef('tlb.recipe_api_before_catalog_deletion(text,jsonb)'::regprocedure);
 if strpos(source,$find$if p_action='resources' then$find$)=0 then raise exception 'Resource dispatch changed; review migration.';end if;
 source:=replace(source,$find$if p_action='resources' then$find$,$replace$if p_action='resources' then
  if coalesce((p_payload->>'paginate')::boolean,false) then return tlb.recipe_resource_page(p_payload);end if;$replace$);
 execute source;
end $$;
commit;
