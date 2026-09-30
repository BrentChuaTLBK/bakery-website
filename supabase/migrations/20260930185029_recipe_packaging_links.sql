begin;
-- Kitchen staff need packaging quantities, never supplier quotes or charges.
-- Derive the reference from existing saved links; do not rewrite recipes.
do $$
declare definition text;hook text;
begin
 definition:=pg_get_functiondef('tlb.recipe_kitchen_document(jsonb)'::regprocedure);
 hook:='''packaging'',tlb.recipe_pick(v->''packaging'',array[''description'',''dimensions'',''box'',''board'',''notes'',''photos'']),';
 perform tlb.require(position(hook in definition)>0,'Missing kitchen packaging projection hook.');
 execute replace(definition,hook,$new$
   'packaging',tlb.recipe_pick(v->'packaging',array['description','dimensions','box','board','notes','photos'])||jsonb_build_object('items',
    coalesce((select jsonb_agg(tlb.recipe_pick(item,array['id','resource_id','resource_name','resource_dimensions','quantity','unit','per_batch']))
     from jsonb_array_elements(coalesce(v->'additional_costs','[]')) item where nullif(item->>'resource_id','') is not null),'[]'::jsonb)),
$new$);
end $$;
commit;
