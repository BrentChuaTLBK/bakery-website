begin;
set local lock_timeout='3s';

-- Do not rewrite historical JSON. Reject duplicate interactive identities on
-- future saves; legacy method records without IDs remain readable/restorable.
do $$ declare source text;hook text; begin
 source:=pg_get_functiondef('tlb.recipe_validate(jsonb)'::regprocedure);
 hook:='  for g in select value from jsonb_array_elements(coalesce(v->''methods'',''[]'')) loop';
 perform tlb.require(strpos(source,hook)>0,'Missing method validation hook.');
 source:=replace(source,hook,$new$
  perform tlb.require(not exists(select 1 from jsonb_array_elements(coalesce(v->'methods','[]')) m
    where nullif(m->>'id','') is not null group by m->>'id' having count(*)>1),'Procedure IDs must be unique within each size.');
  for g in select value from jsonb_array_elements(coalesce(v->'methods','[]')) loop$new$);
 hook:='   for s in select value from jsonb_array_elements(g->''steps'') loop';
 perform tlb.require(strpos(source,hook)>0,'Missing step validation hook.');
 source:=replace(source,hook,$new$   for s in select value from jsonb_array_elements(g->'steps') loop
    if nullif(s->>'id','') is not null then
     perform tlb.require(length(s->>'id')<=100 and not(s->>'id'=any(ids)),'Ingredient and method step IDs must be unique.');ids:=array_append(ids,s->>'id');
    end if;$new$);
 execute source;

 source:=pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure);
 hook:='  data:=p_payload->''data'';perform tlb.require(jsonb_typeof(data)=''object'' and octet_length(data::text)<=524288,''Enter a valid testing log.'');';
 perform tlb.require(strpos(source,hook)>0,'Missing testing log validation hook.');
 source:=replace(source,hook,$new$
  if nullif(p_payload->>'version_id','') is not null then
   perform tlb.require(exists(select 1 from tlb.recipe_versions where id=(p_payload->>'version_id')::uuid and recipe_id=rid),'Choose a saved version of this recipe for the testing log.');
  end if;
  data:=p_payload->'data';perform tlb.require(jsonb_typeof(data)='object' and octet_length(data::text)<=524288,'Enter a valid testing log.');$new$);
 execute source;
end $$;
commit;
