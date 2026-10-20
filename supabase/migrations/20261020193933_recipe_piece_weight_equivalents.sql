-- A measured piece weight/volume belongs to this ingredient only.
-- Existing standard factors and historical recipe snapshots stay unchanged.
create or replace function tlb.recipe_validate_unit_equivalents() returns trigger
language plpgsql security invoker set search_path='' as $$
declare conversions jsonb:=new.data->'unit_conversions';entry record;names text[]:='{}';dimension text;name_key text;
begin
 if tg_op='UPDATE' and conversions is not distinct from old.data->'unit_conversions' then return new;end if;
 if conversions is null then return new;end if;
 perform tlb.require(new.kind in ('ingredient','packaging') and jsonb_typeof(conversions)='object','Unit equivalents belong to an ingredient or packaging item.');
 perform tlb.require((select count(*)<=50 from jsonb_each(conversions)),'Use at most 50 equivalent units per item.');
 for entry in select key,value from jsonb_each(conversions) loop
  dimension:=tlb.recipe_unit(entry.key)->>0;
  perform tlb.require(length(btrim(entry.key)) between 1 and 40 and (dimension='count' or dimension like 'custom:%'),'Choose pieces or a recipe measure such as tsp, tbsp, cup or bag. Weight and volume units already convert automatically.');
  name_key:=case when dimension='count' then 'pc' else lower(btrim(entry.key)) end;
  perform tlb.require(not(name_key=any(names)),'Only enter one equivalent for each recipe unit.');
  names:=array_append(names,name_key);
  perform tlb.require(jsonb_typeof(entry.value)='object' and length(btrim(entry.value->>'unit')) between 1 and 40 and tlb.recipe_unit(entry.value->>'unit')->>0 not like 'custom:%','Choose a standard unit for the equivalent quantity.');
  perform tlb.require(dimension<>'count' or tlb.recipe_unit(entry.value->>'unit')->>0 in ('mass','volume'),'Enter the weight or volume of one piece.');
  perform tlb.require(tlb.recipe_quantity(entry.value->>'quantity')>0,'Equivalent quantity must be greater than zero.');
 end loop;
 return new;
end $$;

create or replace function tlb.recipe_resource_unit(p_data jsonb,p_unit text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare basis jsonb:=tlb.recipe_unit(p_unit);conversion jsonb;target jsonb;
begin
 if basis->>0 in ('mass','volume') then return basis;end if;
 select value into conversion from jsonb_each(coalesce(p_data->'unit_conversions','{}'))
 where case when basis->>0='count' then tlb.recipe_unit(key)->>0='count' else lower(btrim(key))=lower(btrim(p_unit)) end;
 if conversion is null then return basis;end if;
 target:=tlb.recipe_unit(conversion->>'unit');
 perform tlb.require(target->>0 not like 'custom:%' and tlb.recipe_quantity(conversion->>'quantity')>0,'Use a positive equivalent in a standard unit.');
 perform tlb.require(basis->>0<>'count' or target->>0 in ('mass','volume'),'Enter the weight or volume of one piece.');
 -- The only possible chain is a custom pack -> pieces -> weight/volume.
 if target->>0='count' then target:=tlb.recipe_resource_unit(p_data,conversion->>'unit');end if;
 return jsonb_build_array(target->>0,((target->>1)::numeric*tlb.recipe_quantity(conversion->>'quantity'))::text);
end $$;
revoke all on function tlb.recipe_validate_unit_equivalents() from public,anon,authenticated,service_role;
revoke all on function tlb.recipe_resource_unit(jsonb,text) from public,anon,authenticated,service_role;

-- Purchase validation and supplier comparisons must use the same measured
-- equivalent as recipe costing, including when purchases remain in pieces.
do $migration$
declare definition text;hook text;
begin
 select pg_get_functiondef('tlb.recipe_purchase_parameters(jsonb)'::regprocedure) into definition;
 hook:='tlb.recipe_unit(coalesce(result->>''unit'',unit_name))->>0';
 perform tlb.require(strpos(definition,hook)>0,'Missing purchase equivalent comparison.');
 execute replace(definition,hook,'tlb.recipe_resource_unit(resource.data,coalesce(result->>''unit'',unit_name))->>0');

 select pg_get_functiondef('tlb.recipe_api_before_owner_visibility(text,jsonb)'::regprocedure) into definition;
 hook:='unit_basis:=tlb.recipe_unit(p_payload->>''unit'')';
 perform tlb.require(strpos(definition,hook)>0,'Missing purchase preview unit basis.');
 definition:=replace(definition,hook,'unit_basis:=tlb.recipe_resource_unit(resource.data,p_payload->>''unit'')');
 hook:='(tlb.recipe_unit(quote.unit)->>1)::numeric';
 perform tlb.require(strpos(definition,hook)>0,'Missing purchase preview price basis.');
 execute replace(definition,hook,'(tlb.recipe_resource_unit(resource.data,quote.unit)->>1)::numeric');
end $migration$;
