-- A prepared ingredient can inherit its cost from a measured amount of another
-- ingredient. The yield is explicit; no density or preparation yield is guessed.
alter table tlb.recipe_resources add column yield_source_id uuid
 generated always as ((data->'yield_source'->>'ingredient_id')::uuid) stored;
alter table tlb.recipe_resources add constraint recipe_yield_source_fk
 foreign key (yield_source_id) references tlb.recipe_resources(id) deferrable initially deferred;
create index recipe_yield_source_idx on tlb.recipe_resources(yield_source_id) where yield_source_id is not null;

create function tlb.recipe_validate_yield_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare link jsonb:=new.data->'yield_source';source tlb.recipe_resources;source_id uuid;path uuid[]:=array[new.id];
begin
 if tg_op='UPDATE' and link is not distinct from old.data->'yield_source'
  and new.kind=old.kind and new.data->>'default_unit' is not distinct from old.data->>'default_unit' then return new;end if;
 if link is null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.catalog',0));
 perform tlb.require(new.kind='ingredient' and jsonb_typeof(link)='object','Only ingredients can use a linked ingredient yield.');
 perform tlb.require(link->>'ingredient_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','Choose a saved source ingredient.');
 perform tlb.require(tlb.recipe_quantity(link->>'source_quantity')>0 and tlb.recipe_quantity(link->>'yield_quantity')>0,'Source quantity and yield must be greater than zero.');
 perform tlb.require(length(btrim(link->>'source_unit')) between 1 and 40 and length(btrim(link->>'yield_unit')) between 1 and 40,'Choose a source unit and a yield unit.');
 perform tlb.require(new.data->>'default_unit'=link->>'yield_unit','The default ingredient unit must match its yield unit.');
 source_id:=(link->>'ingredient_id')::uuid;
 while source_id is not null loop
  perform tlb.require(not(source_id=any(path)),'An ingredient cannot link to itself or form a circular ingredient link.');
  perform tlb.require(cardinality(path)<32,'Use fewer than 32 linked ingredients in a chain.');
  path:=array_append(path,source_id);
  select * into source from tlb.recipe_resources where id=source_id and kind='ingredient';
  perform tlb.require(found,'Choose a saved source ingredient.');
  source_id:=source.yield_source_id;
 end loop;
 return new;
end $$;
revoke all on function tlb.recipe_validate_yield_source() from public,anon,authenticated,service_role;
create trigger recipe_yield_source before insert or update of data,kind on tlb.recipe_resources
 for each row execute function tlb.recipe_validate_yield_source();

-- Preserve the established highest/preferred supplier selection and the OID of
-- recipe_current_price so all existing costing callers use the new resolver.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('tlb.recipe_current_price(uuid,text,text)'::regprocedure) into definition;
 execute replace(definition,'tlb.recipe_current_price(','tlb.recipe_purchase_price(');
end $migration$;
revoke all on function tlb.recipe_purchase_price(uuid,text,text) from public,anon,authenticated,service_role;

create function tlb.recipe_yield_price(p_resource uuid,p_unit text,p_currency text,p_path uuid[]) returns tlb.recipe_prices
language plpgsql stable security invoker set search_path='' as $$
declare resource tlb.recipe_resources;source tlb.recipe_resources;link jsonb;quote tlb.recipe_prices;
 source_basis jsonb;price_basis jsonb;yield_basis jsonb;target_basis jsonb;target_unit text;
begin
 if p_resource=any(p_path) or cardinality(p_path)>=32 then return null;end if;
 select * into resource from tlb.recipe_resources where id=p_resource and deleted_at is null;
 if not found then return null;end if;
 link:=resource.data->'yield_source';
 if link is null then return tlb.recipe_purchase_price(p_resource,p_unit,p_currency);end if;
 select * into source from tlb.recipe_resources where id=resource.yield_source_id and deleted_at is null;
 if not found then return null;end if;
 quote:=tlb.recipe_yield_price(source.id,link->>'source_unit',p_currency,array_append(p_path,p_resource));
 if quote.id is null then return null;end if;
 source_basis:=tlb.recipe_resource_unit(source.data,link->>'source_unit');
 price_basis:=tlb.recipe_resource_unit(source.data,quote.unit);
 target_unit:=coalesce(nullif(p_unit,''),link->>'yield_unit');
 yield_basis:=tlb.recipe_resource_unit(resource.data,link->>'yield_unit');
 target_basis:=tlb.recipe_resource_unit(resource.data,target_unit);
 if source_basis->>0<>price_basis->>0 or yield_basis->>0<>target_basis->>0 then return null;end if;
 -- This is a computed quote, never an inserted purchase. Its root price ID and
 -- timestamp retain provenance; saved recipe snapshots capture this value.
 quote.amount:=quote.amount*tlb.recipe_quantity(link->>'source_quantity')*(source_basis->>1)::numeric
  /quote.quantity/(price_basis->>1)::numeric;
 quote.quantity:=tlb.recipe_quantity(link->>'yield_quantity')*(yield_basis->>1)::numeric/(target_basis->>1)::numeric;
 quote.unit:=target_unit;quote.resource_id:=resource.id;
 return quote;
end $$;
revoke all on function tlb.recipe_yield_price(uuid,text,text,uuid[]) from public,anon,authenticated,service_role;

create or replace function tlb.recipe_current_price(p_resource uuid,p_unit text default null,p_currency text default 'PHP') returns tlb.recipe_prices
language sql stable security invoker set search_path='' as $$
 select tlb.recipe_yield_price(p_resource,p_unit,p_currency,'{}'::uuid[]);
$$;
revoke all on function tlb.recipe_current_price(uuid,text,text) from public,anon,authenticated,service_role;

-- A small, editor-only read supports source selection and an unsaved yield
-- preview, including sources that are not on the first catalog page.
create function tlb.recipe_yield_source_preview(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare source tlb.recipe_resources;quote tlb.recipe_prices;unit_name text;
begin
 perform tlb.recipe_assert(true);
 select * into source from tlb.recipe_resources where id=(p_payload->>'id')::uuid and kind='ingredient';
 perform tlb.require(found,'Source ingredient no longer exists. Choose another ingredient.');
 unit_name:=coalesce(nullif(p_payload->>'unit',''),source.data->>'default_unit');
 if source.deleted_at is null then quote:=tlb.recipe_current_price(source.id,unit_name);end if;
 return jsonb_build_object('id',source.id,'name',source.name,'active',source.active,'deleted_at',source.deleted_at,
  'data',jsonb_build_object('default_unit',source.data->>'default_unit','unit_conversions',coalesce(source.data->'unit_conversions','{}')),
  'price',to_jsonb(quote));
end $$;
revoke all on function tlb.recipe_yield_source_preview(jsonb) from public,anon,authenticated,service_role;

create function tlb.recipe_yield_save_guard(p_payload jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare link jsonb:=p_payload->'data'->'yield_source';previous jsonb;source_id uuid;
begin
 perform tlb.recipe_assert(true);
 perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.catalog',0));
 if link is null then return;end if;
 select data->'yield_source' into previous from tlb.recipe_resources where id=nullif(p_payload->>'id','')::uuid;
 if link is distinct from previous then
  source_id:=(link->>'ingredient_id')::uuid;
  perform tlb.require(exists(select 1 from tlb.recipe_resources where id=source_id and kind='ingredient' and active and deleted_at is null),'Choose an available source ingredient.');
 end if;
 perform tlb.require(not(p_payload ? 'price') and not(p_payload ? 'suppliers'),'Record purchase prices on the source ingredient, or switch this ingredient to Purchase prices.');
end $$;
revoke all on function tlb.recipe_yield_save_guard(jsonb) from public,anon,authenticated,service_role;

do $migration$
declare definition text;hook text;
begin
 select pg_get_functiondef('public.recipe_api(text,jsonb)'::regprocedure) into definition;
 hook:=$hook$ if p_action='bootstrap' then return tlb.recipe_api_before_owner_visibility(p_action,p_payload);end if;$hook$;
 perform tlb.require(strpos(definition,hook)>0,'Missing recipe gateway hook.');
 definition:=replace(definition,hook,$hook$
 if p_action='ingredient_yield_source' then return tlb.recipe_yield_source_preview(p_payload);end if;
 if p_action='save_resource' then perform tlb.recipe_yield_save_guard(p_payload);end if;
$hook$||hook);
 execute definition;
 -- Both preview and purchase resolve a named or explicitly selected ingredient
 -- here. A linked ingredient must never acquire a competing direct price.
 select pg_get_functiondef('tlb.recipe_purchase_parameters(jsonb)'::regprocedure) into definition;
 hook:=$hook$ return jsonb_build_object('payload',result||jsonb_build_object('resource_id',resource.id,'supplier_name',supplier.name),'conversion',conversion,'purchase_unit',unit_name);$hook$;
 perform tlb.require(strpos(definition,hook)>0,'Missing purchase validation hook.');
 -- Check after the resource has been resolved by the existing helper.
 execute replace(definition,hook,$hook$
 perform tlb.require(resource.yield_source_id is null,'Record the purchase on the source ingredient. This ingredient uses a linked yield.');
$hook$||hook);
end $migration$;
