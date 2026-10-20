-- Accept the original one-source shape as well as a measured batch of inputs.
create function tlb.recipe_yield_inputs(p_link jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select case when p_link is null then '[]'::jsonb
  when p_link ? 'sources' then p_link->'sources'
  else jsonb_build_array(jsonb_build_object('ingredient_id',p_link->'ingredient_id',
   'source_quantity',p_link->'source_quantity','source_unit',p_link->'source_unit')) end;
$$;
revoke all on function tlb.recipe_yield_inputs(jsonb) from public,anon,authenticated,service_role;

-- Derived from resource data; rebuilt by the trigger during backup restoration.
-- Every input has a foreign key, including inputs after the first.
create table tlb.recipe_yield_dependencies (
 resource_id uuid not null references tlb.recipe_resources(id) on delete cascade,
 source_id uuid not null references tlb.recipe_resources(id) deferrable initially deferred,
 primary key(resource_id,source_id), check(resource_id<>source_id)
);
create index recipe_yield_dependencies_source on tlb.recipe_yield_dependencies(source_id);
alter table tlb.recipe_yield_dependencies enable row level security;
revoke all on tlb.recipe_yield_dependencies from public,anon,authenticated,service_role;
insert into tlb.recipe_yield_dependencies(resource_id,source_id)
 select r.id,(s->>'ingredient_id')::uuid from tlb.recipe_resources r
 cross join lateral jsonb_array_elements(tlb.recipe_yield_inputs(r.data->'yield_source')) s;

create or replace function tlb.recipe_validate_yield_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare link jsonb:=new.data->'yield_source';inputs jsonb;item jsonb;ids uuid[]:='{}';source_id uuid;cycle boolean;depth integer;
begin
 if tg_op='UPDATE' and link is not distinct from old.data->'yield_source'
  and new.kind=old.kind and new.data->>'default_unit' is not distinct from old.data->>'default_unit' then return new;end if;
 if link is null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.catalog',0));
 perform tlb.require(new.kind='ingredient' and jsonb_typeof(link)='object','Only ingredients can use a linked ingredient yield.');
 perform tlb.require(not(link ? 'sources' and link ? 'ingredient_id'),'Use one source list for the ingredient yield.');
 inputs:=tlb.recipe_yield_inputs(link);
 perform tlb.require(jsonb_typeof(inputs)='array','Choose saved source ingredients.');
 perform tlb.require(jsonb_array_length(inputs) between 1 and 50,'Add between 1 and 50 source ingredients.');
 perform tlb.require(tlb.recipe_quantity(link->>'yield_quantity')>0,'Source quantity and yield must be greater than zero.');
 perform tlb.require(length(btrim(link->>'yield_unit')) between 1 and 40,'Choose a source unit and a yield unit.');
 perform tlb.require(new.data->>'default_unit'=link->>'yield_unit','The default ingredient unit must match its yield unit.');
 for item in select value from jsonb_array_elements(inputs) loop
  perform tlb.require(jsonb_typeof(item)='object' and item->>'ingredient_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','Choose a saved source ingredient.');
  perform tlb.require(tlb.recipe_quantity(item->>'source_quantity')>0,'Source quantity and yield must be greater than zero.');
  perform tlb.require(length(btrim(item->>'source_unit')) between 1 and 40,'Choose a source unit and a yield unit.');
  source_id:=(item->>'ingredient_id')::uuid;
  perform tlb.require(not(source_id=any(ids)),'Only add each source ingredient once.');
  perform tlb.require(exists(select 1 from tlb.recipe_resources where id=source_id and kind='ingredient'),'Choose a saved source ingredient.');
  ids:=array_append(ids,source_id);
 end loop;
 -- UNION deduplicates shared subgraphs at each depth, avoiding repeated paths.
 with recursive walk(id,n) as (
  select unnest(ids),1
  union select d.source_id,w.n+1 from walk w join tlb.recipe_yield_dependencies d on d.resource_id=w.id where w.n<32
 ) select coalesce(bool_or(id=new.id),false),max(n) into cycle,depth from walk;
 perform tlb.require(not cycle,'An ingredient cannot link to itself or form a circular ingredient link.');
 perform tlb.require(depth<32,'Use fewer than 32 linked ingredients in a chain.');
 return new;
end $$;

create function tlb.recipe_sync_yield_dependencies() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.data->'yield_source' is not distinct from old.data->'yield_source' then return new;end if;
 delete from tlb.recipe_yield_dependencies where resource_id=new.id;
 insert into tlb.recipe_yield_dependencies(resource_id,source_id)
  select new.id,(s->>'ingredient_id')::uuid from jsonb_array_elements(tlb.recipe_yield_inputs(new.data->'yield_source')) s;
 return new;
end $$;
revoke all on function tlb.recipe_sync_yield_dependencies() from public,anon,authenticated,service_role;
create trigger recipe_yield_dependencies after insert or update of data on tlb.recipe_resources
 for each row execute function tlb.recipe_sync_yield_dependencies();

create or replace function tlb.recipe_yield_price(p_resource uuid,p_unit text,p_currency text,p_path uuid[]) returns tlb.recipe_prices
language plpgsql stable security invoker set search_path='' as $$
declare resource tlb.recipe_resources;source tlb.recipe_resources;link jsonb;item jsonb;inputs jsonb;
 quote tlb.recipe_prices;result tlb.recipe_prices;total numeric:=0;
 source_basis jsonb;price_basis jsonb;yield_basis jsonb;target_basis jsonb;target_unit text;
begin
 if p_resource=any(p_path) or cardinality(p_path)>=32 then return null;end if;
 select * into resource from tlb.recipe_resources where id=p_resource and deleted_at is null;
 if not found then return null;end if;
 link:=resource.data->'yield_source';
 if link is null then return tlb.recipe_purchase_price(p_resource,p_unit,p_currency);end if;
 inputs:=tlb.recipe_yield_inputs(link);
 for item in select value from jsonb_array_elements(inputs) loop
  select * into source from tlb.recipe_resources where id=(item->>'ingredient_id')::uuid and deleted_at is null;
  if not found then return null;end if;
  quote:=tlb.recipe_yield_price(source.id,item->>'source_unit',p_currency,array_append(p_path,p_resource));
  -- Never present a partial cost when any input is missing a comparable price.
  if quote.id is null then return null;end if;
  source_basis:=tlb.recipe_resource_unit(source.data,item->>'source_unit');
  price_basis:=tlb.recipe_resource_unit(source.data,quote.unit);
  if source_basis->>0<>price_basis->>0 then return null;end if;
  total:=total+quote.amount*tlb.recipe_quantity(item->>'source_quantity')*(source_basis->>1)::numeric
   /quote.quantity/(price_basis->>1)::numeric;
  if result.id is null then result:=quote;else result.created_at:=greatest(result.created_at,quote.created_at);end if;
 end loop;
 if result.id is null then return null;end if;
 target_unit:=coalesce(nullif(p_unit,''),link->>'yield_unit');
 yield_basis:=tlb.recipe_resource_unit(resource.data,link->>'yield_unit');
 target_basis:=tlb.recipe_resource_unit(resource.data,target_unit);
 if yield_basis->>0<>target_basis->>0 then return null;end if;
 -- Computed quotes are never inserted as purchases. The combined amount is
 -- captured by saved recipe snapshots; a blend has no single supplier.
 result.amount:=total;
 result.quantity:=tlb.recipe_quantity(link->>'yield_quantity')*(yield_basis->>1)::numeric/(target_basis->>1)::numeric;
 result.unit:=target_unit;result.resource_id:=resource.id;
 if jsonb_array_length(inputs)>1 then result.supplier_id:=null;end if;
 return result;
end $$;

create or replace function tlb.recipe_yield_save_guard(p_payload jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare link jsonb:=p_payload->'data'->'yield_source';previous jsonb;item jsonb;
begin
 perform tlb.recipe_assert(true);
 perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.catalog',0));
 if link is null then return;end if;
 select data->'yield_source' into previous from tlb.recipe_resources where id=nullif(p_payload->>'id','')::uuid;
 if link is distinct from previous then
  for item in select value from jsonb_array_elements(tlb.recipe_yield_inputs(link)) loop
   perform tlb.require(exists(select 1 from tlb.recipe_resources where id=(item->>'ingredient_id')::uuid
    and kind='ingredient' and active and deleted_at is null),'Choose an available source ingredient.');
  end loop;
 end if;
 perform tlb.require(not(p_payload ? 'price') and not(p_payload ? 'suppliers'),'Record purchase prices on the source ingredients, or switch this ingredient to Purchase prices.');
end $$;

do $migration$
declare definition text;hook text;
begin
 select pg_get_functiondef('tlb.recipe_purchase_parameters(jsonb)'::regprocedure) into definition;
 hook:='resource.yield_source_id is null';
 perform tlb.require(strpos(definition,hook)>0,'Missing linked ingredient purchase guard.');
 execute replace(definition,hook,'not coalesce(resource.data ? ''yield_source'',false)');
end $migration$;
