begin;
set local lock_timeout='3s';

-- Linked labels are resolved from the catalog. Quantities, units, notes,
-- ingredient IDs, version rows and saved price/cost snapshots remain intact.
create function tlb.recipe_linked_ingredient_document(p_doc jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
 select p_doc||jsonb_build_object('variants',coalesce((
  select jsonb_agg(v.value||jsonb_build_object('groups',coalesce((
   select jsonb_agg(g.value||jsonb_build_object('ingredients',coalesce((
    select jsonb_agg(case when r.id is null then i.value else i.value||jsonb_build_object('name',r.name,'brand',coalesce(r.data->>'brand','')) end order by i.n)
    from jsonb_array_elements(coalesce(g.value->'ingredients','[]')) with ordinality i(value,n)
    left join tlb.recipe_resources r on r.id::text=i.value->>'ingredient_id' and r.kind='ingredient'
   ),'[]')) order by g.n) from jsonb_array_elements(coalesce(v.value->'groups','[]')) with ordinality g(value,n)
  ),'[]')) order by v.n) from jsonb_array_elements(coalesce(p_doc->'variants','[]')) with ordinality v(value,n)
 ),'[]'))
$$;
revoke all on function tlb.recipe_linked_ingredient_document(jsonb) from public,anon,authenticated,service_role;

create function tlb.recipe_linked_ingredient_matches(p_doc jsonb,p_query text,p_brands boolean default true) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(coalesce(p_doc->'variants','[]')) v
  cross join lateral jsonb_array_elements(coalesce(v->'groups','[]')) g
  cross join lateral jsonb_array_elements(coalesce(g->'ingredients','[]')) i
  join tlb.recipe_resources r on r.id::text=i->>'ingredient_id' and r.kind='ingredient'
  where r.name ilike '%'||p_query||'%' or (p_brands and r.data->>'brand' ilike '%'||p_query||'%'))
$$;
revoke all on function tlb.recipe_linked_ingredient_matches(jsonb,text,boolean) from public,anon,authenticated,service_role;

do $$ declare source text;hook text;begin
 source:=pg_get_functiondef('tlb.recipe_detail(uuid,uuid,boolean)'::regprocedure);
 hook:='v.document:=tlb.recipe_packaging_document(v.document,false);';
 perform tlb.require(strpos(source,hook)>0,'Missing linked ingredient detail hook.');
 execute replace(source,hook,'v.document:=tlb.recipe_packaging_document(tlb.recipe_linked_ingredient_document(v.document),false);');

 -- Resolve before the protected kitchen projection and optional brand removal.
 source:=pg_get_functiondef('tlb.recipe_staff_detail(uuid,uuid,boolean)'::regprocedure);
 hook:='doc:=tlb.recipe_kitchen_document(tlb.recipe_packaging_document(v.document,false));';
 perform tlb.require(strpos(source,hook)>0,'Missing linked ingredient staff hook.');
 execute replace(source,hook,'doc:=tlb.recipe_kitchen_document(tlb.recipe_packaging_document(tlb.recipe_linked_ingredient_document(v.document),false));');

 source:=pg_get_functiondef('tlb.recipe_save_version(uuid,bigint,jsonb,text,text,jsonb)'::regprocedure);
 hook:=' perform tlb.recipe_validate(doc);';
 perform tlb.require(strpos(source,hook)>0,'Missing linked ingredient save hook.');
 execute replace(source,hook,E' doc:=tlb.recipe_linked_ingredient_document(doc);\n'||hook);

 source:=pg_get_functiondef('tlb.recipe_capture_costs_current(jsonb,boolean,integer)'::regprocedure);
 hook:='p_doc:=tlb.recipe_packaging_document(p_doc,true);';
 perform tlb.require(strpos(source,hook)>0,'Missing linked ingredient costing hook.');
 execute replace(source,hook,'p_doc:=tlb.recipe_packaging_document(tlb.recipe_linked_ingredient_document(p_doc),true);');

 source:=pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure);
 hook:=$hook$v.document->>'name' ilike '%'||q||'%'$hook$;
 perform tlb.require(strpos(source,hook)>0,'Missing linked ingredient search hook.');
 execute replace(source,hook,hook||' or tlb.recipe_linked_ingredient_matches(v.document,q)');

 source:=pg_get_functiondef('public.recipe_api(text,jsonb)'::regprocedure);
 perform tlb.require(strpos(source,hook)>0,'Missing linked ingredient staff search hook.');
 execute replace(source,hook,hook||' or tlb.recipe_linked_ingredient_matches(v.document,q,show_brands)');
end $$;
commit;
