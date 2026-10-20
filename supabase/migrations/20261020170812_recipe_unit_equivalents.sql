-- Ingredient-specific equivalents extend the existing per-resource conversion
-- path. Standard unit factors and historical recipe snapshots are unchanged.
create function tlb.recipe_validate_unit_equivalents() returns trigger
language plpgsql security invoker set search_path='' as $$
declare conversions jsonb:=new.data->'unit_conversions';entry record;names text[]:='{}';
begin
 if tg_op='UPDATE' and conversions is not distinct from old.data->'unit_conversions' then return new;end if;
 if conversions is null then return new;end if;
 perform tlb.require(new.kind in ('ingredient','packaging') and jsonb_typeof(conversions)='object','Unit equivalents belong to an ingredient or packaging item.');
 perform tlb.require((select count(*)<=50 from jsonb_each(conversions)),'Use at most 50 equivalent units per item.');
 for entry in select key,value from jsonb_each(conversions) loop
  perform tlb.require(length(btrim(entry.key)) between 1 and 40 and tlb.recipe_unit(entry.key)->>0 like 'custom:%','Standard units already convert automatically. Use a recipe measure such as tsp, tbsp, cup or bag.');
  perform tlb.require(not(lower(btrim(entry.key))=any(names)),'Only enter one equivalent for each recipe unit.');
  names:=array_append(names,lower(btrim(entry.key)));
  perform tlb.require(jsonb_typeof(entry.value)='object' and length(btrim(entry.value->>'unit')) between 1 and 40 and tlb.recipe_unit(entry.value->>'unit')->>0 not like 'custom:%','Choose a standard unit for the equivalent quantity.');
  perform tlb.require(tlb.recipe_quantity(entry.value->>'quantity')>0,'Equivalent quantity must be greater than zero.');
 end loop;
 return new;
end $$;
revoke all on function tlb.recipe_validate_unit_equivalents() from public,anon,authenticated,service_role;
create trigger recipe_unit_equivalents before insert or update of data on tlb.recipe_resources
for each row execute function tlb.recipe_validate_unit_equivalents();
