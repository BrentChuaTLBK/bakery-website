begin;
set local lock_timeout='3s';
create function tlb.recipe_validate_scaling(p_yield jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare option jsonb; ids text[]:=array[]::text[];
begin
 if p_yield ? 'scale_options' then
  perform tlb.require(jsonb_typeof(p_yield->'scale_options')='array' and jsonb_array_length(p_yield->'scale_options')<=12,'Use up to 12 scaling options per size.');
  for option in select value from jsonb_array_elements(p_yield->'scale_options') loop
   perform tlb.require(jsonb_typeof(option)='object' and coalesce(option->>'id','') ~ '^[a-zA-Z0-9_-]{1,64}$' and not(option->>'id'=any(ids)),'Scaling options need unique IDs within each size.');
   ids:=array_append(ids,option->>'id');
   perform tlb.require(length(btrim(option->>'label')) between 1 and 60,'Name each scaling option, such as Yield or Pcs.');
   perform tlb.require(tlb.recipe_quantity(option->>'quantity')>0,'Each scaling option needs a positive base amount.');
   perform tlb.require(length(btrim(option->>'unit')) between 1 and 60,'Set the unit for each scaling option.');
  end loop;
 end if;
 perform tlb.require(coalesce(p_yield->>'scale_default','multiplier')='multiplier'
  or (left(p_yield->>'scale_default',7)='custom:' and substr(p_yield->>'scale_default',8)=any(ids)),'Choose an available default scaling option.');
end $$;
revoke all on function tlb.recipe_validate_scaling(jsonb) from public,anon,authenticated,service_role;

do $$ declare source text;hook text;begin
 source:=pg_get_functiondef('tlb.recipe_validate(jsonb)'::regprocedure);
 hook:=$hook$  perform tlb.require(length(btrim(v#>>'{yield,unit}')) between 1 and 60,'Add a yield unit.');$hook$;
 perform tlb.require(strpos(source,hook)>0,'Missing recipe scaling validation hook.');
 execute replace(source,hook,hook||E'\n  perform tlb.recipe_validate_scaling(v->''yield'');');

 -- Only the four safe scaling fields are sent to Kitchen Staff.
 source:=pg_get_functiondef('tlb.recipe_kitchen_document(jsonb)'::regprocedure);
 hook:=$hook$'yield',tlb.recipe_pick(v->'yield',array['quantity','unit','portions','portion_weight','batch_weight','finished_weight','pan_size','pans','loss_percent'])$hook$;
 perform tlb.require(strpos(source,hook)>0,'Missing kitchen scaling projection hook.');
 execute replace(source,hook,hook||$extra$||jsonb_build_object('scale_default',coalesce(v#>>'{yield,scale_default}','multiplier'),'scale_options',tlb.recipe_pick_array(v#>'{yield,scale_options}',array['id','label','quantity','unit']))$extra$);

 source:=pg_get_functiondef('tlb.recipe_api_before_rd_access(text,jsonb)'::regprocedure);
 hook:=$hook$coalesce(p_payload->>'scaling_mode','multiplier') in ('multiplier','yield','pieces','portions','portion','weight','pans')$hook$;
 perform tlb.require(strpos(source,hook)>0,'Missing costing scaling-mode hook.');
 execute replace(source,hook,'('||hook||$extra$ or p_payload->>'scaling_mode' ~ '^custom:[a-zA-Z0-9_-]{1,64}$')$extra$);

 source:=pg_get_functiondef('tlb.recipe_enrich_snapshot(jsonb,jsonb,numeric,text)'::regprocedure);
 hook:='begin';
 execute replace(source,hook,$extra$begin
 if left(p_scaling_mode,7)='custom:' then
  perform tlb.require(exists(select 1 from jsonb_array_elements(p_doc->'variants') scale_variant(value) cross join lateral jsonb_array_elements(coalesce(scale_variant.value#>'{yield,scale_options}','[]')) scale_option(value) where 'custom:'||(scale_option.value->>'id')=p_scaling_mode),'This scaling option is no longer available.');
 end if;$extra$);
end $$;
commit;
