begin;
set local lock_timeout='3s';

-- Configuration lives inside the immutable recipe version, so restoring a
-- formula also restores its selling basis and allowance. No default selling
-- price or saleable yield is inferred from an ingredient/component yield.
create function tlb.recipe_profit_metrics(p_variant jsonb,p_ingredients numeric,p_packaging numeric,p_direct numeric,p_complete boolean,p_factor numeric,p_yield_factor numeric default null)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare c jsonb:=coalesce(p_variant->'costing','{}');base numeric:=p_ingredients+p_packaging+p_direct;
 allowance numeric;adjusted numeric;units numeric;revenue numeric;profit numeric;labor numeric:=tlb.recipe_quantity(coalesce(nullif(c->>'labor_percent',''),'0'));
 saleable boolean:=coalesce(c->>'mode','costing_only')='saleable';price numeric;
begin
 allowance:=base*labor/100;adjusted:=base+allowance;
 if saleable then
  units:=tlb.recipe_quantity(c->>'saleable_yield')*coalesce(p_yield_factor,p_factor);
  price:=tlb.recipe_quantity(c->>'selling_price');
  revenue:=price*case when c->>'price_basis'='batch' then coalesce(p_yield_factor,p_factor) else units end;
  profit:=revenue-adjusted;
 end if;
 return jsonb_build_object('mode',case when saleable then 'saleable' else 'costing_only' end,
  'ingredient_cost',p_ingredients::text,'packaging_cost',p_packaging::text,'other_direct_cost',p_direct::text,
  'known_total',base::text,'base_cost',case when p_complete then base::text end,
  'labor_percent',labor::text,'labor_allowance',case when p_complete then allowance::text end,
  'adjusted_cost',case when p_complete then adjusted::text end,
  'sale_unit',coalesce(c->>'sale_unit','each'),'price_basis',coalesce(c->>'price_basis','unit'),
  'selling_price',price::text,'saleable_yield',units::text,'revenue',revenue::text,
  'profit',case when p_complete then profit::text end,
  'margin',case when p_complete and revenue>0 then (profit/revenue*100)::text end,
  'markup',case when p_complete and adjusted>0 then (profit/adjusted*100)::text end,
  'unit_base',case when p_complete and units>0 then (base/units)::text end,
  'unit_adjusted',case when p_complete and units>0 then (adjusted/units)::text end,
  'unit_revenue',case when units>0 then (revenue/units)::text end,
  'unit_profit',case when p_complete and units>0 then (profit/units)::text end,
  'break_even',case when p_complete and saleable then (adjusted/case when c->>'price_basis'='batch' then coalesce(p_yield_factor,p_factor) else units end)::text end,
  'below_cost',p_complete and saleable and profit<0,'factor',p_factor::text,'yield_factor',coalesce(p_yield_factor,p_factor)::text);
end $$;
revoke all on function tlb.recipe_profit_metrics(jsonb,numeric,numeric,numeric,boolean,numeric,numeric) from public,anon,authenticated,service_role;

-- Reconstruct old snapshots from their saved amounts and pinned component
-- versions. This helper never consults current supplier prices.
create function tlb.recipe_snapshot_variant(p_doc jsonb,p_snapshot jsonb,p_variant text,p_factor numeric default 1,p_depth integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;c jsonb;l jsonb;extra jsonb;link jsonb;child tlb.recipe_versions;child_v jsonb;child_c jsonb;inline_c jsonb;
 ingredients numeric:=0;packaging numeric:=0;direct numeric:=0;amount numeric;ratio numeric;f numeric;total numeric;
 missing jsonb;lines jsonb:='[]';extra_index integer:=0;complete boolean;result jsonb;
begin
 perform tlb.require(p_depth<=32,'Component nesting exceeds 32 levels.');
 perform tlb.require(p_factor>0 and p_factor<=1000000000000,'Costing multiplier must be positive and at most 1 trillion.');
 select value into v from jsonb_array_elements(p_doc->'variants') where value->>'id'=p_variant;
 perform tlb.require(v is not null,'Costing size was not found.');
 select value into c from jsonb_array_elements(coalesce(p_snapshot->'variants','[]')) where value->>'variant_id'=p_variant;
 missing:=coalesce(c->'missing','[]');
 if c is null then missing:=missing||jsonb_build_array(jsonb_build_object('name',v->>'name','reason','Saved cost snapshot is unavailable'));end if;
 for l in select value from jsonb_array_elements(coalesce(c->'lines','[]')) loop
  f:=p_factor;
  if coalesce((l->>'additional')::boolean,false) then
   extra:=coalesce(v->'additional_costs','[]')->extra_index;extra_index:=extra_index+1;
   if coalesce((extra->>'per_batch')::boolean,true)=false then f:=1;end if;
  elsif nullif(l->>'component_version_id','') is null then
   ingredients:=ingredients+coalesce((l->>'amount')::numeric,0)*p_factor;
  end if;
  lines:=lines||jsonb_build_array(l||jsonb_build_object('amount',(coalesce((l->>'amount')::numeric,0)*f)::text));
 end loop;
 for extra in select value from jsonb_array_elements(coalesce(v->'additional_costs','[]')) loop
  amount:=tlb.recipe_quantity(extra->>'amount')*case when coalesce((extra->>'per_batch')::boolean,true) then p_factor else 1 end;
  if nullif(extra->>'resource_id','') is not null or extra->>'kind'='packaging' then packaging:=packaging+amount;
  else direct:=direct+amount;end if;
 end loop;
 for link in select value from jsonb_array_elements(coalesce(v->'components','[]')) loop
  select value->'component_cost' into inline_c from jsonb_array_elements(coalesce(c->'lines','[]'))
   where value->>'link_id'=link->>'id' and value->>'component_version_id'=link->>'version_id' limit 1;
  if inline_c is not null then
   ingredients:=ingredients+coalesce((inline_c->>'ingredient_cost')::numeric,0)*p_factor;
   packaging:=packaging+coalesce((inline_c->>'packaging_cost')::numeric,0)*p_factor;
   direct:=direct+coalesce((inline_c->>'other_direct_cost')::numeric,0)*p_factor;
  else
   select * into child from tlb.recipe_versions where id=(link->>'version_id')::uuid;
   select value into child_v from jsonb_array_elements(coalesce(child.document->'variants','[]')) where nullif(link->>'variant_id','') is null or value->>'id'=link->>'variant_id' limit 1;
   if child_v is not null and child.cost_snapshot->>'currency'=p_snapshot->>'currency' then
    child_c:=tlb.recipe_snapshot_variant(child.document,child.cost_snapshot,child_v->>'id',1,p_depth+1);
    ratio:=tlb.recipe_quantity(link->>'quantity')/tlb.recipe_quantity(child_v#>>'{yield,quantity}')*p_factor;
    ingredients:=ingredients+coalesce((child_c->>'ingredient_cost')::numeric,0)*ratio;
    packaging:=packaging+coalesce((child_c->>'packaging_cost')::numeric,0)*ratio;
    direct:=direct+coalesce((child_c->>'other_direct_cost')::numeric,0)*ratio;
   end if;
  end if;
 end loop;
 total:=ingredients+packaging+direct;
 complete:=c is not null and coalesce((c->>'complete')::boolean,false) and jsonb_array_length(missing)=0;
 result:=tlb.recipe_profit_metrics(v,ingredients,packaging,direct,complete,p_factor);
 return coalesce(c,'{}')||result||jsonb_build_object('variant_id',p_variant,'variant_name',v->>'name','complete',complete,'missing',missing,'lines',lines,
  'total',total::text,'per_yield',(total/(tlb.recipe_quantity(v#>>'{yield,quantity}')*p_factor))::text,
  'per_portion',case when nullif(v#>>'{yield,portions}','') is not null and tlb.recipe_quantity(v#>>'{yield,portions}')>0 then (total/(tlb.recipe_quantity(v#>>'{yield,portions}')*p_factor))::text end);
end $$;
revoke all on function tlb.recipe_snapshot_variant(jsonb,jsonb,text,numeric,integer) from public,anon,authenticated,service_role;

create function tlb.recipe_enrich_snapshot(p_doc jsonb,p_snapshot jsonb,p_factor numeric default 1,p_scaling_mode text default 'multiplier') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;summary jsonb;items jsonb:='[]';begin
 for v in select value from jsonb_array_elements(p_doc->'variants') loop
  summary:=tlb.recipe_snapshot_variant(p_doc,p_snapshot,v->>'id',p_factor);
  if p_scaling_mode='portion' then
   summary:=summary||tlb.recipe_profit_metrics(v,(summary->>'ingredient_cost')::numeric,(summary->>'packaging_cost')::numeric,(summary->>'other_direct_cost')::numeric,(summary->>'complete')::boolean,p_factor,1);
   if tlb.recipe_unit(v#>>'{yield,unit}')->>0 not in ('mass','volume') then summary:=summary||jsonb_build_object('per_yield',((summary->>'total')::numeric/tlb.recipe_quantity(v#>>'{yield,quantity}'))::text);end if;
   if nullif(v#>>'{yield,portions}','') is not null and tlb.recipe_quantity(v#>>'{yield,portions}')>0 then summary:=summary||jsonb_build_object('per_portion',((summary->>'total')::numeric/tlb.recipe_quantity(v#>>'{yield,portions}'))::text);end if;
  end if;
  items:=items||jsonb_build_array(summary);
 end loop;
 return p_snapshot||jsonb_build_object('format_version',2,'variants',items,'factor',p_factor::text);
end $$;
revoke all on function tlb.recipe_enrich_snapshot(jsonb,jsonb,numeric,text) from public,anon,authenticated,service_role;

-- Keep the existing price selection, file validation and allergen capture.
-- The explicit current-price path recursively costs the same pinned formulas
-- using current prices, without adopting new formulas or persisting changes.
do $$ declare source text;hook text; begin
 source:=pg_get_functiondef('tlb.recipe_capture_costs(jsonb)'::regprocedure);
 source:=replace(source,'tlb.recipe_capture_costs(p_doc jsonb)','tlb.recipe_capture_costs_current(p_doc jsonb,p_current boolean default false,p_depth integer default 0)');
 source:=replace(source,'component jsonb;child tlb.recipe_versions;','child_result jsonb;component_cost jsonb;component jsonb;child tlb.recipe_versions;');
 hook:='begin'||chr(10);
 source:=replace(source,hook,hook||' perform tlb.require(p_depth<=32,''Component nesting exceeds 32 levels.'');'||chr(10));
 hook:='   perform tlb.require(child.id is not null,''A component version no longer exists.'');';
 perform tlb.require(strpos(source,hook)>0,'Missing component costing hook.');
 source:=replace(source,hook,hook||$new$
   if p_current then
    child_result:=tlb.recipe_capture_costs_current(child.document,true,p_depth+1);
    child.document:=child_result->'document';child.cost_snapshot:=child_result->'snapshot';
   end if;$new$);
 hook:='    line_cost:=(child_cost->>''total'')::numeric*ratio;total:=total+line_cost;';
 perform tlb.require(strpos(source,hook)>0,'Missing component total hook.');
 source:=replace(source,hook,hook||$new$
    component_cost:=tlb.recipe_snapshot_variant(child.document,child.cost_snapshot,size->>'id',1,p_depth+1);
    component_cost:=jsonb_build_object('ingredient_cost',((component_cost->>'ingredient_cost')::numeric*ratio)::text,
     'packaging_cost',((component_cost->>'packaging_cost')::numeric*ratio)::text,
     'other_direct_cost',((component_cost->>'other_direct_cost')::numeric*ratio)::text);$new$);
 hook:='''component_version_id'',child.id,''amount'',line_cost::text,''multiplier'',ratio::text';
 perform tlb.require(strpos(source,hook)>0,'Missing component price line hook.');
 source:=replace(source,hook,hook||',''link_id'',component->>''id'',''variant_id'',size->>''id'',''component_cost'',component_cost');
 hook:='''snapshot'',jsonb_build_object(''format_version'',1,''currency'',currency,''calculated_at'',now(),''variants'',totals)';
 perform tlb.require(strpos(source,hook)>0,'Missing saved cost snapshot hook.');
 source:=replace(source,hook,$new$'snapshot',tlb.recipe_enrich_snapshot(p_doc||jsonb_build_object('variants',variants),jsonb_build_object('format_version',1,'currency',currency,'calculated_at',now(),'price_source',case when p_current then 'current' else 'saved_with_pinned_components' end,'variants',totals))$new$);
 execute source;
end $$;
revoke all on function tlb.recipe_capture_costs_current(jsonb,boolean,integer) from public,anon,authenticated,service_role;
create or replace function tlb.recipe_capture_costs(p_doc jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$ select tlb.recipe_capture_costs_current(p_doc,false,0) $$;

do $$ declare source text;hook text;begin
 source:=pg_get_functiondef('tlb.recipe_validate(jsonb)'::regprocedure);
 source:=replace(source,'k text;ids text[]','c jsonb;k text;ids text[]');
 hook:='    for s in select value from jsonb_array_elements';
 -- Validation applies to API writes and preview alike, even if a client skips UI checks.
 hook:='  perform tlb.require(length(btrim(v->>''name'')) between 1 and 150,''Name each size variant.'');';
 perform tlb.require(strpos(source,hook)>0,'Missing profitability validation hook.');
 source:=replace(source,hook,hook||$new$
  if v ? 'costing' then
   c:=v->'costing';perform tlb.require(jsonb_typeof(c)='object','Costing settings must be an object.');
   perform tlb.require(c->>'mode' in ('costing_only','saleable'),'Choose Costing Only or Saleable Product Costing.');
   perform tlb.require(tlb.recipe_quantity(coalesce(nullif(c->>'labor_percent',''),'0'))<=10000,'Labor and utilities allowance must be between 0% and 10,000%.');
   if c->>'mode'='saleable' then
    perform tlb.require(tlb.recipe_quantity(c->>'saleable_yield')>0,'Enter a positive saleable yield.');
    perform tlb.recipe_quantity(c->>'selling_price');
    perform tlb.require(c->>'price_basis' in ('unit','batch'),'Choose a selling price per saleable unit or per batch.');
    perform tlb.require(c->>'sale_unit' in ('each','box','whole_cake','tray','set'),'Choose each, box, whole cake, tray or set as the saleable unit.');
   end if;
  end if;$new$);
 execute source;
end $$;

alter function public.recipe_api(text,jsonb) rename to recipe_api_before_profitability;
alter function public.recipe_api_before_profitability(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_profitability(text,jsonb) from public,anon,authenticated,service_role;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare record jsonb;cost jsonb;current_cost jsonb;factor numeric:=1;rows jsonb;version tlb.recipe_versions;
begin
 if p_action in ('costing','cost_preview','costing_overview') then
  perform tlb.recipe_assert(true);
  factor:=tlb.recipe_quantity(coalesce(nullif(p_payload->>'factor',''),'1'));
  perform tlb.require(factor>0,'Costing multiplier must be positive.');
  perform tlb.require(coalesce(p_payload->>'scaling_mode','multiplier') in ('multiplier','yield','pieces','portions','portion','weight','pans'),'Choose a valid costing scaling mode.');
  perform tlb.require(coalesce(p_payload->>'source','saved') in ('saved','current'),'Choose saved or current prices.');
 end if;
 if p_action='cost_preview' then
  perform tlb.recipe_validate(p_payload->'document');
  cost:=tlb.recipe_capture_costs_current(p_payload->'document',coalesce(p_payload->>'source','current')='current',0);
  return cost||jsonb_build_object('snapshot',tlb.recipe_enrich_snapshot(cost->'document',cost->'snapshot',factor,coalesce(p_payload->>'scaling_mode','multiplier')));
 elsif p_action='costing' then
  record:=tlb.recipe_detail((p_payload->>'id')::uuid,nullif(p_payload->>'version_id','')::uuid,false);
  cost:=tlb.recipe_enrich_snapshot(record->'document',record->'cost_snapshot',factor,coalesce(p_payload->>'scaling_mode','multiplier'));
  if coalesce(p_payload->>'source','saved')='current' then
   current_cost:=tlb.recipe_capture_costs_current(record->'document',true,0);
   current_cost:=tlb.recipe_enrich_snapshot(current_cost->'document',current_cost->'snapshot',factor,coalesce(p_payload->>'scaling_mode','multiplier'));
  end if;
  return jsonb_build_object('recipe_id',record->>'id','version_id',record->>'version_id','version',record->'version',
   'source',coalesce(p_payload->>'source','saved'),'saved',cost,'snapshot',coalesce(current_cost,cost),
   'prices_changed',case when current_cost is not null then (current_cost->'variants') is distinct from (cost->'variants') else null end);
 elsif p_action='costing_overview' then
  with selected as (
   select r.id,r.name,r.code,r.updated_at,r.category_id,v.id version_id,v.number,v.status,v.document,v.cost_snapshot
   from tlb.recipes r join tlb.recipe_versions v on v.id=r.current_version_id
   where r.deleted_at is null and
    (case when nullif(p_payload->>'status','') is null then v.status<>'archived' else tlb.recipe_status(v.status)=tlb.recipe_status(p_payload->>'status') end)
    and (coalesce(p_payload->>'query','')='' or r.name ilike '%'||(p_payload->>'query')||'%' or r.code ilike '%'||(p_payload->>'query')||'%')
    and (nullif(p_payload->>'category_id','') is null or r.category_id=(p_payload->>'category_id')::uuid)
    and (coalesce(p_payload->>'product_line','')='' or v.document->>'product_line'=p_payload->>'product_line')
    and (not coalesce((p_payload->>'recent')::boolean,false) or r.updated_at>=now()-interval '30 days')
  ), variants as (
   select s.*,x.value size from selected s cross join lateral jsonb_array_elements(s.document->'variants') x
   where coalesce(p_payload->>'mode','saleable')='all' or coalesce(x.value#>>'{costing,mode}','costing_only')=coalesce(p_payload->>'mode','saleable')
  ), calculated as materialized (
   select v.*,tlb.recipe_snapshot_variant(v.document,v.cost_snapshot,v.size->>'id',1) summary from variants v
  ), filtered as (
   select jsonb_build_object('id',id,'name',name,'code',code,'category_id',category_id,'product_line',document->>'product_line',
    'version_id',version_id,'version',number,'status',tlb.recipe_status(status),'updated_at',updated_at,
    'costed_at',cost_snapshot->>'calculated_at','currency',cost_snapshot->>'currency','yield',size->'yield','summary',summary-'lines') row,
    name,number,updated_at,summary
   from calculated
   where (coalesce(p_payload->>'condition','')<>'missing' or not (summary->>'complete')::boolean)
    and (coalesce(p_payload->>'condition','')<>'negative' or (summary->>'profit')::numeric<0)
    and (coalesce(p_payload->>'condition','')<>'profitable' or (summary->>'profit')::numeric>0)
  ), ordered as (
   select row,row_number() over(order by
    case when p_payload->>'sort'='highest_cost' then (summary->>'adjusted_cost')::numeric end desc nulls last,
    case when p_payload->>'sort'='lowest_cost' then (summary->>'adjusted_cost')::numeric end asc nulls last,
    case when p_payload->>'sort'='highest_profit' then (summary->>'profit')::numeric end desc nulls last,
    case when p_payload->>'sort'='lowest_margin' then (summary->>'margin')::numeric end asc nulls last,
    case when p_payload->>'sort'='highest_margin' then (summary->>'margin')::numeric end desc nulls last,
    case when p_payload->>'sort'='updated' then updated_at end desc nulls last,
    lower(name),row->>'id',summary->>'variant_id') n from filtered
  ) select jsonb_build_object('total',(select count(*) from ordered),'source','saved','rows',coalesce(jsonb_agg(row order by n),'[]')) into rows
   from ordered where n>greatest(coalesce((p_payload->>'offset')::integer,0),0)
    and n<=greatest(coalesce((p_payload->>'offset')::integer,0),0)+least(greatest(coalesce((p_payload->>'limit')::integer,24),1),100);
  return rows;
 end if;
 return tlb.recipe_api_before_profitability(p_action,p_payload);
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;
commit;
