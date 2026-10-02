begin;

-- An unset shared allowance preserves existing recipe costs until the owner
-- chooses a percentage. Zero is an explicit setting, not an unset value.
create function tlb.recipe_costing_settings() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('configured',settings ? 'labor_utilities_percent',
  'percent',settings->>'labor_utilities_percent','revision',revision)
 from tlb.recipe_settings where id
$$;
revoke all on function tlb.recipe_costing_settings() from public,anon,authenticated,service_role;

create function tlb.recipe_apply_shared_allowance(p_document jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare allowance text;variants jsonb;
begin
 select settings->>'labor_utilities_percent' into allowance from tlb.recipe_settings where id;
 if allowance is null then return p_document;end if;
 select coalesce(jsonb_agg(v.value||jsonb_build_object('costing',coalesce(v.value->'costing','{}'::jsonb)
  ||jsonb_build_object('labor_percent',allowance)) order by v.ordinality),'[]'::jsonb)
 into variants from jsonb_array_elements(p_document->'variants') with ordinality v;
 return p_document||jsonb_build_object('variants',variants);
end $$;
revoke all on function tlb.recipe_apply_shared_allowance(jsonb) from public,anon,authenticated,service_role;

-- Apply only when capturing current costs or saving a new version. Historical
-- snapshot reconstruction deliberately continues to use its saved percentage.
do $migration$
declare definition text;hook text:=E'begin\n';
begin
 definition:=replace(pg_get_functiondef('tlb.recipe_capture_costs_current(jsonb,boolean,integer)'::regprocedure),E'\r','');
 perform tlb.require(strpos(definition,hook)>0,'Shared allowance: cost capture implementation was not found.');
 definition:=overlay(definition placing hook||E' p_doc:=tlb.recipe_apply_shared_allowance(p_doc);\n'
  from strpos(definition,hook) for length(hook));
 execute definition;
end $migration$;

alter function public.recipe_api(text,jsonb) rename to recipe_api_before_workflow_refinement;
alter function public.recipe_api_before_workflow_refinement(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_workflow_refinement(text,jsonb) from public,anon,authenticated,service_role;

-- Conversions belong to an individual item: a bag of flour need not contain
-- the same quantity as a bag of sugar. Never infer a mass/volume conversion.
create function tlb.recipe_resource_unit(p_data jsonb,p_unit text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare basis jsonb:=tlb.recipe_unit(p_unit);conversion jsonb;target jsonb;
begin
 if basis->>0 not like 'custom:%' then return basis;end if;
 select value into conversion from jsonb_each(coalesce(p_data->'unit_conversions','{}')) where lower(key)=lower(btrim(p_unit));
 if conversion is null then return basis;end if;
 target:=tlb.recipe_unit(conversion->>'unit');
 perform tlb.require(target->>0 not like 'custom:%' and tlb.recipe_quantity(conversion->>'quantity')>0,'Use a positive pack size in grams, kilograms, millilitres or pieces.');
 return jsonb_build_array(target->>0,((target->>1)::numeric*tlb.recipe_quantity(conversion->>'quantity'))::text);
end $$;
revoke all on function tlb.recipe_resource_unit(jsonb,text) from public,anon,authenticated,service_role;

create or replace function tlb.recipe_current_price(p_resource uuid,p_unit text default null,p_currency text default 'PHP') returns tlb.recipe_prices
language sql stable security invoker set search_path='' as $$
 with resource as (select * from tlb.recipe_resources where id=p_resource and deleted_at is null), latest as (
  select distinct on (p.supplier_id) p.* from tlb.recipe_prices p where p.resource_id=p_resource order by p.supplier_id,p.created_at desc,p.id
 ), basis as (
  select coalesce(nullif(p_unit,''),nullif(r.data->>'default_unit',''),(select unit from latest order by created_at desc,id limit 1)) name from resource r
 ), comparable as (
  select p.*,r.data,b.name,tlb.recipe_resource_unit(r.data,p.unit) price_basis,tlb.recipe_resource_unit(r.data,b.name) target_basis
  from latest p cross join basis b cross join resource r
  where p.currency=p_currency
  and (nullif(r.data->>'preferred_supplier_id','') is null or p.supplier_id=nullif(r.data->>'preferred_supplier_id','')::uuid or exists(select 1 from tlb.recipe_resources s where s.id=nullif(r.data->>'preferred_supplier_id','')::uuid and s.deleted_at is not null))
  and ((p.supplier_id is null and coalesce((r.data->>'allow_unassigned_price')::boolean,true)) or exists(select 1 from tlb.recipe_supplier_items i join tlb.recipe_resources s on s.id=i.supplier_id where i.resource_id=p_resource and i.supplier_id=p.supplier_id and s.active and s.deleted_at is null))
 ) select (jsonb_populate_record(null::tlb.recipe_prices,to_jsonb(p)||case when tlb.recipe_unit(p.unit)->>0=tlb.recipe_unit(p.name)->>0 then '{}'::jsonb
  else jsonb_build_object('unit',p.name,'quantity',p.quantity*(p.price_basis->>1)::numeric/(p.target_basis->>1)::numeric) end)).*
 from comparable p where p.price_basis->>0=p.target_basis->>0
 order by p.amount/p.quantity/(p.price_basis->>1)::numeric desc,p.created_at desc,p.id limit 1
$$;

create function tlb.recipe_purchase_parameters(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare resource tlb.recipe_resources;supplier tlb.recipe_resources;result jsonb:=p_payload;conversion jsonb;unit_name text:=btrim(p_payload->>'unit');qty numeric;
begin
 perform tlb.require(p_payload->>'kind' in ('ingredient','packaging'),'Choose an ingredient or packaging purchase.');
 perform tlb.require(length(btrim(p_payload->>'name')) between 1 and 200,'Enter the item name.');
 select * into supplier from tlb.recipe_resources where id=nullif(p_payload->>'supplier_id','')::uuid and kind='supplier' and active and deleted_at is null;
 perform tlb.require(found,'Choose an available saved supplier.');
 if nullif(p_payload->>'resource_id','') is not null then
  select * into resource from tlb.recipe_resources where id=(p_payload->>'resource_id')::uuid and kind=p_payload->>'kind' and deleted_at is null;
  perform tlb.require(found,'This item was deleted. Restore it or choose another item.');
 else
  select * into resource from tlb.recipe_resources where kind=p_payload->>'kind' and deleted_at is null
   and lower(regexp_replace(btrim(name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_payload->>'name'),'\s+',' ','g'))
   and lower(coalesce(data->>'brand',''))=lower(btrim(coalesce(p_payload->>'brand',''))) order by created_at limit 1;
 end if;
 qty:=tlb.recipe_quantity(p_payload->>'quantity');perform tlb.recipe_quantity(p_payload->>'amount');
 perform tlb.require(qty>0 and length(unit_name) between 1 and 40,'Enter a positive quantity and purchase unit.');
 if nullif(p_payload->>'contents_quantity','') is not null then
  perform tlb.require(tlb.recipe_unit(unit_name)->>0 like 'custom:%','Pack contents are only used for custom units.');
  conversion:=jsonb_build_object('quantity',tlb.recipe_quantity(p_payload->>'contents_quantity')::text,'unit',btrim(p_payload->>'contents_unit'));
  perform tlb.require(tlb.recipe_quantity(conversion->>'quantity')>0 and tlb.recipe_unit(conversion->>'unit')->>0 not like 'custom:%','Enter positive pack contents using a standard unit.');
 elsif tlb.recipe_unit(unit_name)->>0 like 'custom:%' then
  select value into conversion from jsonb_each(coalesce(resource.data->'unit_conversions','{}')) where lower(key)=lower(unit_name);
 end if;
 if conversion is not null then
  qty:=qty*tlb.recipe_quantity(conversion->>'quantity');result:=result||jsonb_build_object('quantity',qty::text,'unit',conversion->>'unit');
 end if;
 if resource.id is not null then
  perform tlb.require(tlb.recipe_resource_unit(resource.data||case when conversion is null then '{}'::jsonb else jsonb_build_object('unit_conversions',coalesce(resource.data->'unit_conversions','{}')||jsonb_build_object(unit_name,conversion)) end,resource.data->>'default_unit')->>0=tlb.recipe_unit(coalesce(result->>'unit',unit_name))->>0,
   'Enter this pack’s contents in a unit compatible with the item’s recipe unit.');
 end if;
 return jsonb_build_object('payload',result||jsonb_build_object('resource_id',resource.id,'supplier_name',supplier.name),'conversion',conversion,'purchase_unit',unit_name);
end $$;
revoke all on function tlb.recipe_purchase_parameters(jsonb) from public,anon,authenticated,service_role;

create function tlb.recipe_resource_usage(p_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 with recursive chain(recipe_id,version_id) as (
  select r.id,tlb.recipe_listing_version(r.id) from tlb.recipes r where r.deleted_at is null and tlb.recipe_version_visible(tlb.recipe_listing_version(r.id))
  union select c.recipe_id,l.target_version_id from chain c join tlb.recipe_links l on l.version_id=c.version_id
 ), refs as (
  select c.recipe_id,value#>>'{}' resource_id from chain c join tlb.recipe_versions v on v.id=c.version_id cross join lateral (
   select value from jsonb_path_query(v.document,'$.variants[*].groups[*].ingredients[*].ingredient_id') value
   union select value from jsonb_path_query(v.document,'$.variants[*].additional_costs[*].resource_id') value
  ) reference
 ), counts as (select resource_id,count(distinct recipe_id) total from refs where resource_id=any(p_ids::text[]) group by resource_id)
 select coalesce(jsonb_object_agg(resource_id,total),'{}'::jsonb) from counts
$$;
revoke all on function tlb.recipe_resource_usage(uuid[]) from public,anon,authenticated,service_role;

-- Honor the saved supplier ID, including when two suppliers share a name.
do $migration$
declare definition text;hook text:=E'  select id into target from tlb.recipe_resources where kind=''supplier'' and deleted_at is null and lower(regexp_replace(btrim(name),''\\s+'','' '',''g''))=lower(supplier_name) order by created_at limit 1;';
begin
 definition:=replace(pg_get_functiondef('tlb.recipe_api_before_catalog_deletion(text,jsonb)'::regprocedure),E'\r','');
 perform tlb.require(strpos(definition,hook)>0,'Saved supplier selection: purchase implementation was not found.');
 definition:=replace(definition,hook,E'  if nullif(p_payload->>''supplier_id'','''') is not null then target:=(p_payload->>''supplier_id'')::uuid;else\n'||hook||E'\n  end if;');
 execute definition;
end $migration$;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;current_settings tlb.recipe_settings;allowance numeric;units jsonb;unit_name text;symbol text;
 item jsonb;cost jsonb;cards jsonb:='[]'::jsonb;version_document jsonb;normalized jsonb;original_payload jsonb:=p_payload;previous jsonb;
 resource tlb.recipe_resources;quote tlb.recipe_prices;unit_basis jsonb;proposed numeric;current_cost numeric;effective numeric;affected integer;preferred uuid;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, private, max-age=0"},{"Pragma":"no-cache"},{"Vary":"Authorization"}]',true);
 if p_action='purchase_preview' or (p_action='record_purchase' and p_payload ? 'supplier_id') then
  if tlb.recipe_assert()='kitchen' then return tlb.recipe_api_before_workflow_refinement(p_action,p_payload);end if;
  perform tlb.recipe_assert(true);perform tlb.require(jsonb_typeof(p_payload)='object','Use an object for purchase parameters.');
  if p_action='record_purchase' then
   -- Match the established lock order: catalog first, then purchases.
   perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.catalog',0));
   perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.record-purchase',0));
   select details into previous from tlb.recipe_audit where actor=auth.uid() and action='purchase_refinement' and details->>'request_id'=p_payload->>'request_id';
   if previous ? 'refinement_request' then
    perform tlb.require(previous->'refinement_request'=p_payload,'This purchase was already saved with different details. Start a new purchase.');return previous->'result';
   end if;
  end if;
  normalized:=tlb.recipe_purchase_parameters(p_payload);p_payload:=normalized->'payload';
  if p_action='record_purchase' then
   result:=tlb.recipe_api_before_workflow_refinement(p_action,p_payload);
   if normalized->'conversion'<>'null'::jsonb then
    update tlb.recipe_resources set data=data||jsonb_build_object('unit_conversions',coalesce(data->'unit_conversions','{}')||jsonb_build_object(normalized->>'purchase_unit',normalized->'conversion')) where id=(result->>'resource_id')::uuid;
   end if;
   insert into tlb.recipe_audit(actor,action,details) values(auth.uid(),'purchase_refinement',jsonb_build_object('request_id',p_payload->>'request_id','refinement_request',original_payload,'pack_contents',normalized->'conversion','result',result));
   return result;
  end if;
  select * into resource from tlb.recipe_resources where id=nullif(p_payload->>'resource_id','')::uuid;
  unit_basis:=tlb.recipe_unit(p_payload->>'unit');proposed:=tlb.recipe_quantity(p_payload->>'amount')/tlb.recipe_quantity(p_payload->>'quantity');
  select * into quote from tlb.recipe_current_price(resource.id,p_payload->>'unit');
  if quote.id is not null then current_cost:=quote.amount/quote.quantity*(unit_basis->>1)::numeric/(tlb.recipe_unit(quote.unit)->>1)::numeric;end if;
  preferred:=case when coalesce((p_payload->>'preferred')::boolean,false) then (p_payload->>'supplier_id')::uuid else nullif(resource.data->>'preferred_supplier_id','')::uuid end;
  if preferred is not null and exists(select 1 from tlb.recipe_resources where id=preferred and deleted_at is not null) then preferred:=null;end if;
  with latest as (select distinct on (p.supplier_id) p.* from tlb.recipe_prices p where p.resource_id=resource.id order by p.supplier_id,p.created_at desc,p.id), candidates as (
   select p.amount/p.quantity*(unit_basis->>1)::numeric/(tlb.recipe_resource_unit(resource.data,p.unit)->>1)::numeric amount
   from latest p where p.supplier_id is distinct from (p_payload->>'supplier_id')::uuid and p.currency='PHP'
   and tlb.recipe_resource_unit(resource.data,p.unit)->>0=unit_basis->>0 and (preferred is null or p.supplier_id=preferred)
   and ((p.supplier_id is null and coalesce((resource.data->>'allow_unassigned_price')::boolean,true)) or exists(select 1 from tlb.recipe_supplier_items i join tlb.recipe_resources s on s.id=i.supplier_id where i.resource_id=resource.id and i.supplier_id=p.supplier_id and s.active and s.deleted_at is null))
   union all select proposed where preferred is null or preferred=(p_payload->>'supplier_id')::uuid
  ) select max(amount) into effective from candidates;
  with recursive chain(recipe_id,version_id) as (
   select r.id,tlb.recipe_listing_version(r.id) from tlb.recipes r where r.deleted_at is null
   union select c.recipe_id,l.target_version_id from chain c join tlb.recipe_links l on l.version_id=c.version_id
  ) select count(distinct c.recipe_id) into affected from chain c join tlb.recipe_versions v on v.id=c.version_id
   where tlb.recipe_version_visible(c.version_id) and (
    jsonb_path_exists(v.document,'$.variants[*].groups[*].ingredients[*] ? (@.ingredient_id == $id)',jsonb_build_object('id',resource.id::text))
    or jsonb_path_exists(v.document,'$.variants[*].additional_costs[*] ? (@.resource_id == $id)',jsonb_build_object('id',resource.id::text)));
  return jsonb_build_object('unit',p_payload->>'unit','quantity',p_payload->>'quantity','proposed_unit_cost',proposed::text,'current_unit_cost',current_cost::text,'effective_unit_cost',effective::text,'affected_recipes',affected);
 end if;
 if p_action in ('costing_settings','save_costing_settings','recipe_units','save_recipe_unit','library_costs') then
  -- Keep Kitchen Staff denial responses and access policy behavior unchanged.
  if tlb.recipe_assert()='kitchen' then return tlb.recipe_api_before_workflow_refinement(p_action,p_payload);end if;
  perform tlb.recipe_assert(true);
  perform tlb.require(jsonb_typeof(p_payload)='object','Use an object for recipe request parameters.');
  if p_action='costing_settings' then return tlb.recipe_costing_settings();end if;
  if p_action='save_costing_settings' then
   perform tlb.recipe_assert(true,true);
   allowance:=tlb.recipe_quantity(p_payload->>'percent');
   perform tlb.require(allowance<=10000,'Labor and utilities allowance must be between 0% and 10,000%.');
   select * into current_settings from tlb.recipe_settings where id for update;
   perform tlb.require((p_payload->>'revision')::bigint=current_settings.revision,'Settings changed in another window. Refresh before applying the allowance.');
   update tlb.recipe_settings set settings=settings||jsonb_build_object('labor_utilities_percent',allowance::text),revision=revision+1 where id;
   insert into tlb.recipe_audit(actor,action,details) values(auth.uid(),'shared_allowance_changed',
    jsonb_build_object('before',current_settings.settings->'labor_utilities_percent','after',allowance::text));
   return tlb.recipe_costing_settings();
  end if;
  if p_action in ('recipe_units','save_recipe_unit') then
   if p_action='save_recipe_unit' then
    unit_name:=regexp_replace(btrim(p_payload->>'name'),'\s+',' ','g');symbol:=btrim(p_payload->>'symbol');
    perform tlb.require(length(unit_name) between 1 and 60 and length(symbol) between 1 and 16
     and symbol!~'[[:cntrl:]]','Enter a unit name and a short label of up to 16 characters.');
    perform tlb.require(lower(symbol)<>all(array['g','kg','mg','gram','grams','ml','l','litre','liter','pc','pcs','piece','pieces']),
     'That standard unit is already available.');
    select * into current_settings from tlb.recipe_settings where id for update;
    units:=coalesce(current_settings.settings->'recipe_units','[]'::jsonb);
    perform tlb.require(jsonb_array_length(units)<200,'Keep up to 200 custom units.');
    perform tlb.require(not exists(select 1 from jsonb_array_elements(units) u where lower(u->>'symbol')=lower(symbol)),
     'That unit label is already available.');
    units:=units||jsonb_build_array(jsonb_build_object('name',unit_name,'symbol',symbol));
    update tlb.recipe_settings set settings=settings||jsonb_build_object('recipe_units',units),revision=revision+1 where id;
    insert into tlb.recipe_audit(actor,action,details) values(auth.uid(),'recipe_unit_added',jsonb_build_object('name',unit_name,'symbol',symbol));
   end if;
   return (select jsonb_build_object('units',coalesce(settings->'recipe_units','[]'::jsonb),'revision',revision) from tlb.recipe_settings where id);
  end if;
  if p_action='library_costs' then
   perform tlb.require(jsonb_typeof(p_payload->'recipes')='array' and jsonb_array_length(p_payload->'recipes')<=24,
    'Request costs for up to 24 recipe cards at a time.');
   for item in select value from jsonb_array_elements(p_payload->'recipes') loop
    -- The existing dispatcher enforces recipe/version visibility, including R&D.
    cost:=tlb.recipe_api_before_workflow_refinement('costing',jsonb_build_object('id',item->>'id',
     'version_id',item->>'version_id','source','current'));
    select document into version_document from tlb.recipe_versions where id=(cost->>'version_id')::uuid;
    cards:=cards||jsonb_build_array(jsonb_build_object('id',cost->>'recipe_id','version',cost->'version',
     'version_id',cost->>'version_id','currency',cost#>>'{snapshot,currency}',
     'variants',(select coalesce(jsonb_agg(s.value||jsonb_build_object('yield',v.value->'yield') order by v.ordinality),'[]'::jsonb)
      from jsonb_array_elements(cost#>'{snapshot,variants}') s
      join jsonb_array_elements(version_document->'variants') with ordinality v on v.value->>'id'=s.value->>'variant_id')));
   end loop;
   return jsonb_build_object('rows',cards);
  end if;
 end if;
 result:=tlb.recipe_api_before_workflow_refinement(p_action,p_payload);
 if p_action='resources' and p_payload->>'paginate'='true' and p_payload->>'kind' in ('ingredient','packaging') then
  previous:=tlb.recipe_resource_usage(array(select (value->>'id')::uuid from jsonb_array_elements(result->'rows')));
  result:=jsonb_set(result,'{rows}',(select coalesce(jsonb_agg(value||jsonb_build_object('usage_count',coalesce((previous->>(value->>'id'))::integer,0))),'[]'::jsonb) from jsonb_array_elements(result->'rows')));
 end if;
 if p_action in ('bootstrap','costing_overview') and tlb.recipe_role(auth.uid())<>'kitchen' then
  result:=result||jsonb_build_object('global_allowance',tlb.recipe_costing_settings());
  if p_action='bootstrap' then
   result:=jsonb_set(result,'{settings,recipe_units}',(select coalesce(settings->'recipe_units','[]'::jsonb) from tlb.recipe_settings where id));
  end if;
 end if;
 return result;
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;

-- Reuse the existing eligibility and category rules for every range. Derive
-- all-time boundaries on every request, including an export refresh.
alter function tlb.accounting_report_v2(uuid,jsonb) rename to accounting_report_before_all_time;
revoke all on function tlb.accounting_report_before_all_time(uuid,jsonb) from public,anon,authenticated,service_role;
create function tlb.accounting_report_v2(p_user uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare first_date date;last_date date;result jsonb;today date:=(now() at time zone 'Asia/Manila')::date;
begin
 perform tlb.assert_staff(p_user,true);
 if p_payload->>'mode'='all' then
  select min(entry_date),max(entry_date) into first_date,last_date
   from tlb.accounting_rows_v2('-infinity'::date,'infinity'::date);
  result:=tlb.accounting_report_before_all_time(p_user,p_payload||jsonb_build_object('start',coalesce(first_date,today),'end',coalesce(last_date,today)));
  return result||jsonb_build_object('mode','all','first_entry',first_date,'latest_entry',last_date);
 end if;
 return tlb.accounting_report_before_all_time(p_user,p_payload)||jsonb_build_object('mode',case when p_payload->>'mode'='month' then 'month' else 'custom' end);
end $$;
revoke all on function tlb.accounting_report_v2(uuid,jsonb) from public,anon,authenticated,service_role;

commit;
