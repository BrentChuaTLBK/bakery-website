-- Compare recipe content before recapturing current prices. An unchanged Save
-- keeps the current version and its historical costs; restore/promotion retain
-- their existing, explicit version-creation behavior.
create function tlb.recipe_save_comparison(p_doc jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare doc jsonb;v jsonb;g jsonb;item jsonb;variants jsonb:='[]';groups jsonb;ingredients jsonb;extras jsonb;
begin
 doc:=tlb.recipe_packaging_document(tlb.recipe_linked_ingredient_document(p_doc),false);
 -- Match optional fields supplied by the editor when opening older recipes.
 doc:='{"name":"","description":"","category_id":"","tags":[],"flavor":"","product_line":"","currency":"PHP","allergens":[],"private_notes":"","critical_notes":"","photos":[],"files":[]}'::jsonb||doc;
 for v in select value from jsonb_array_elements(doc->'variants') loop
  v:='{"name":"Standard","groups":[],"methods":[],"baking":[],"components":[],"equipment":[],"additional_costs":[],"production_notes":"","photos":[]}'::jsonb||v;
  v:=v||jsonb_build_object(
   'yield','{"quantity":"1","unit":"batch","portions":"","portion_weight":"","batch_weight":"","finished_weight":"","pan_size":"","pans":"","loss_percent":""}'::jsonb||coalesce(v->'yield','{}'),
   'costing','{"mode":"costing_only","labor_percent":"0","saleable_yield":"","sale_unit":"each","selling_price":"","price_basis":"unit"}'::jsonb||coalesce(v->'costing','{}'),
   'packaging','{"description":"","dimensions":"","notes":"","photos":[]}'::jsonb||coalesce(v->'packaging','{}'));
  groups:='[]';
  for g in select value from jsonb_array_elements(v->'groups') loop
   ingredients:='[]';
   for item in select value from jsonb_array_elements(g->'ingredients') loop
    -- Linked prices are chosen by the server. Manual/unlinked costs remain
    -- meaningful content and must still trigger a saved version when edited.
    if nullif(item->>'ingredient_id','') is not null then item:=item-'cost_snapshot';end if;
    ingredients:=ingredients||jsonb_build_array(item);
   end loop;
   groups:=groups||jsonb_build_array(g||jsonb_build_object('ingredients',ingredients));
  end loop;
  extras:='[]';
  for item in select value from jsonb_array_elements(v->'additional_costs') loop
   if nullif(item->>'resource_id','') is not null then item:=item-'cost_snapshot';end if;
   extras:=extras||jsonb_build_array(item);
  end loop;
  variants:=variants||jsonb_build_array(v||jsonb_build_object('groups',groups,'additional_costs',extras));
 end loop;
 return doc||jsonb_build_object('variants',variants);
end $$;
revoke all on function tlb.recipe_save_comparison(jsonb) from public,anon,authenticated,service_role;

create function tlb.recipe_unchanged_save(p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare recipe tlb.recipes;version tlb.recipe_versions;target text:=coalesce(p_payload->>'status','draft');
begin
 perform tlb.recipe_assert(true);
 if target not in ('draft','testing','approved','production','final','hidden','archived','archive') then return null;end if;
 target:=case target when 'final' then 'production' when 'archive' then 'archived' else target end;
 if target in ('approved','production','hidden','archived') then perform tlb.recipe_assert(true,true);end if;
 select * into recipe from tlb.recipes where id=(p_payload->>'id')::uuid for update;
 perform tlb.require(recipe.id is not null and recipe.deleted_at is null,'Recipe was removed or does not exist.');
 perform tlb.require(recipe.revision=(p_payload->>'revision')::bigint,'This recipe changed in another window. Reload before saving.');
 select * into version from tlb.recipe_versions where id=recipe.current_version_id;
 if target<>version.status
  or (p_payload ? 'visibility' and p_payload->>'visibility'<>recipe.visibility) then return null;end if;
 perform tlb.recipe_validate(p_payload->'document');
 if tlb.recipe_save_comparison(p_payload->'document')=tlb.recipe_save_comparison(version.document) then
  return tlb.recipe_detail(recipe.id)||jsonb_build_object('unchanged',true);
 end if;
 return null;
end $$;
revoke all on function tlb.recipe_unchanged_save(jsonb) from public,anon,authenticated,service_role;

do $migration$
declare definition text;hook text;
begin
 -- Reach the core dispatcher only after all gateway checks, including R&D,
 -- owner-only visibility, attachments and nested recipe permissions.
 select pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure) into definition;
 hook:=$hook$ if p_action in ('create','save','duplicate','restore_version','promote_test') then$hook$;
 perform tlb.require(strpos(definition,hook)>0,'Missing core recipe save hook.');
 execute replace(definition,hook,$hook$
 if p_action='save' then
  result:=tlb.recipe_unchanged_save(p_payload);
  if result is not null then return result;end if;
 end if;
$hook$||hook);
 select pg_get_functiondef('public.recipe_api(text,jsonb)'::regprocedure) into definition;
 hook:=$hook$ if coalesce((result->>'error')::boolean,false) then return result;end if;$hook$;
 perform tlb.require(strpos(definition,hook)>0,'Missing protected recipe response hook.');
 -- Do not issue even a same-value visibility update for an unchanged Save.
 execute replace(definition,hook,hook||$hook$
 if p_action='save' and result->>'unchanged'='true' then return result;end if;
$hook$);
end $migration$;
