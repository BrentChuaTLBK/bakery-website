begin;
-- Pair local component ingredient groups with their procedures. Formula rows,
-- quantities, approved versions and linked recipe components are unchanged.
do $$
declare definition text;hook text;
begin
 definition:=pg_get_functiondef('tlb.recipe_validate(jsonb)'::regprocedure);
 hook:='  for g in select value from jsonb_array_elements(coalesce(v->''methods'',''[]'')) loop';
 perform tlb.require(position(hook in definition)>0,'Missing recipe procedure validation hook.');
 execute replace(definition,hook,$new$
  perform tlb.require(not exists(select 1 from jsonb_array_elements(v->'groups') item
    where nullif(item->>'id','') is not null group by item->>'id' having count(*)>1),'Component IDs must be unique within each size.');
  for g in select value from jsonb_array_elements(coalesce(v->'methods','[]')) loop
   if nullif(g->>'group_id','') is not null then
    perform tlb.require(jsonb_typeof(g->'group_id')='string' and length(g->>'group_id')<=100
      and exists(select 1 from jsonb_array_elements(v->'groups') item where item->>'id'=g->>'group_id'),
      'Choose an existing component for each linked procedure.');
   end if;
$new$);
 definition:=pg_get_functiondef('tlb.recipe_kitchen_document(jsonb)'::regprocedure);
 hook:='tlb.recipe_pick(g,array[''id'',''name''])||jsonb_build_object(''steps''';
 perform tlb.require(position(hook in definition)>0,'Missing kitchen procedure projection hook.');
 execute replace(definition,hook,'tlb.recipe_pick(g,array[''id'',''name'',''group_id''])||jsonb_build_object(''steps''');
end $$;
commit;
