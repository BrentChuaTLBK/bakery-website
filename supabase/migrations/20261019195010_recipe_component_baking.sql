begin;
set local lock_timeout='3s';

-- Keep the existing ordered baking arrays and all historical recipe JSON.
-- A stage may link to a local component; missing or empty links stay compatible
-- with recipe-wide instructions that have not been assigned by an editor.
do $$
declare definition text; hook text;
begin
 definition:=pg_get_functiondef('tlb.recipe_validate(jsonb)'::regprocedure);
 hook:='  perform tlb.require(jsonb_typeof(coalesce(v->''methods'',''[]''))=''array'',''Method sections must be an array.'');';
 perform tlb.require(strpos(definition,hook)>0,'Missing baking component validation hook.');
 execute replace(definition,hook,$new$
  perform tlb.require(jsonb_typeof(coalesce(v->'baking','[]'))='array','Baking stages must be an array.');
  for r in select value from jsonb_array_elements(coalesce(v->'baking','[]')) loop
   if nullif(r->>'group_id','') is not null then
    perform tlb.require(jsonb_typeof(r->'group_id')='string' and length(r->>'group_id')<=100
      and exists(select 1 from jsonb_array_elements(v->'groups') item where item->>'id'=r->>'group_id'),
      'Choose an existing component for each linked baking stage.');
   end if;
  end loop;
$new$||hook);

 definition:=pg_get_functiondef('tlb.recipe_kitchen_document(jsonb)'::regprocedure);
 hook:='tlb.recipe_pick_array(v->''baking'',array[''id'',''name'',''top''';
 perform tlb.require(strpos(definition,hook)>0,'Missing kitchen baking projection hook.');
 execute replace(definition,hook,'tlb.recipe_pick_array(v->''baking'',array[''id'',''name'',''group_id'',''top''');
end $$;
commit;
