-- Normal recipe costing uses current linked ingredient, packaging and component
-- prices. Historical snapshots remain available only through an explicit read.
-- Preserve the existing permission and R&D visibility checks in this dispatcher.
begin;
do $migration$
declare
 definition text := pg_get_functiondef('tlb.recipe_api_before_rd_access(text,jsonb)'::regprocedure);
 old_variants text := $old$), variants as (
   select s.*,x.value size from selected s cross join lateral jsonb_array_elements(s.document->'variants') x$old$;
 new_variants text := $new$), captured as materialized (
   select s.*,case when coalesce(p_payload->>'source','current')='current'
    then tlb.recipe_capture_costs_current(s.document,true,0)
    else jsonb_build_object('document',s.document,'snapshot',s.cost_snapshot) end current_cost
   from selected s
  ), variants as (
   select s.id,s.name,s.code,s.updated_at,s.category_id,s.version_id,s.number,s.status,
    s.current_cost->'document' document,s.current_cost->'snapshot' cost_snapshot,x.value size
   from captured s cross join lateral jsonb_array_elements(s.current_cost->'document'->'variants') x$new$;
begin
 definition := replace(definition,E'\r','');
 if strpos(definition,old_variants)=0 or strpos(definition,'''source'',''saved'',''rows''')=0 then
  raise exception 'Current-cost migration: expected costing overview implementation was not found.';
 end if;
 definition := replace(definition,'coalesce(p_payload->>''source'',''saved'')','coalesce(p_payload->>''source'',''current'')');
 definition := replace(definition,old_variants,new_variants);
 definition := replace(definition,'''source'',''saved'',''rows''','''source'',coalesce(p_payload->>''source'',''current''),''rows''');
 execute definition;
end $migration$;
commit;
