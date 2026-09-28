-- Flavor stock belongs to an event product, never to the public catalog.
-- Null preserves the behavior of events created before flavor tracking existed.
alter table tlb.pos_stock add column option_groups jsonb
 check(option_groups is null or jsonb_typeof(option_groups)='array');

-- Use the saved sale selections and retained product allocations as the ledger.
-- Voiding with stock restoration removes that allocation; a no-restock void keeps it.
create function tlb.pos_flavor_usage(p_event uuid,p_product uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_object_agg(group_id,choices),'{}'::jsonb) from (
  select group_id,jsonb_object_agg(choice_id,used) choices from (
   select g.key group_id,c.key choice_id,sum((i->>'quantity')::bigint*(c.value::text)::bigint) used
   from tlb.pos_allocations a join tlb.orders o on o.id=a.order_id
   cross join lateral jsonb_array_elements(o.data->'items') i
   cross join lateral jsonb_each(coalesce(i->'selections','{}')) g
   cross join lateral jsonb_each(g.value) c
   where a.event_id=p_event and a.product_id=p_product and (i->>'product_id')::uuid=p_product
   group by g.key,c.key
  ) counts group by group_id
 ) groups
$$;

create function tlb.pos_event_options(p_event uuid,p_product uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare groups jsonb; usage jsonb; g jsonb; c jsonb; choices jsonb; result jsonb:='[]'; used bigint;
begin
 select coalesce(s.option_groups,p.data->'option_groups','[]') into groups
 from tlb.pos_stock s join tlb.products p on p.id=s.product_id where s.event_id=p_event and s.product_id=p_product;
 if coalesce(jsonb_array_length(groups),0)=0 then return '[]'::jsonb; end if;
 usage:=tlb.pos_flavor_usage(p_event,p_product);
 for g in select value from jsonb_array_elements(groups) loop
  choices:='[]';
  for c in select value from jsonb_array_elements(g->'choices') loop
   used:=coalesce((usage#>>array[g->>'id',c->>'id'])::bigint,0);
   choices:=choices||jsonb_build_array(c||jsonb_build_object('used',used,'remaining',(c->>'capacity')::bigint-used));
  end loop;
  result:=result||jsonb_build_array(g||jsonb_build_object('choices',choices));
 end loop;
 return result;
end $$;

create function tlb.pos_save_flavor_stock(p_event uuid,p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare s jsonb; pid uuid; baseline jsonb; submitted jsonb; usage jsonb; g jsonb; oldg jsonb;
 c jsonb; oldc jsonb; choices jsonb; result jsonb; cap integer; used bigint; label text; surcharge integer; custom boolean;
begin
 for s in select value from jsonb_array_elements(p_payload->'stock') loop
  -- A legacy client cannot erase settings it does not know how to display.
  if not coalesce((s->>'options_tracked')::boolean,false) then continue; end if;
  pid:=(s->>'product_id')::uuid; submitted:=s->'option_groups';
  select coalesce(ps.option_groups,p.data->'option_groups','[]') into baseline
  from tlb.pos_stock ps join tlb.products p on p.id=ps.product_id where ps.event_id=p_event and ps.product_id=pid;
  perform tlb.require(jsonb_typeof(submitted)='array','Event flavors must be a list.');
  perform tlb.require(jsonb_array_length(submitted)=jsonb_array_length(baseline),'Keep every product option group.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements(submitted) v group by v->>'id' having count(*)>1),'Use each option group once.');
  usage:=tlb.pos_flavor_usage(p_event,pid); result:='[]';
  for g in select value from jsonb_array_elements(submitted) loop
   select value into oldg from jsonb_array_elements(baseline) where value->>'id'=g->>'id';
   perform tlb.require(oldg is not null,'Unknown product option group.');
   perform tlb.require(jsonb_typeof(g->'choices')='array' and jsonb_array_length(g->'choices') between 1 and 100,'Use 1 to 100 flavors per group.');
   perform tlb.require(not exists(select 1 from jsonb_array_elements(g->'choices') v group by v->>'id' having count(*)>1),'Use each flavor once.');
   -- Keep IDs for historical stock. Uncheck availability instead of dropping a flavor.
   perform tlb.require(not exists(select 1 from jsonb_array_elements(oldg->'choices') v where not exists(select 1 from jsonb_array_elements(g->'choices') n where n->>'id'=v->>'id')),'Keep existing flavors and turn off those not offered.');
   choices:='[]';
   for c in select value from jsonb_array_elements(g->'choices') loop
    select value into oldc from jsonb_array_elements(oldg->'choices') where value->>'id'=c->>'id';
    custom:=oldc is null or coalesce((oldc->>'custom')::boolean,false);
    if oldc is null then
     perform tlb.require(coalesce(c->>'id','') ~ '^event-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','New event flavors need a unique event ID.');
    end if;
    label:=case when custom then trim(coalesce(c->>'label','')) else oldc->>'label' end;
    perform tlb.require(length(label) between 1 and 120,'Enter a flavor name (up to 120 characters).');
    surcharge:=case when custom then tlb.pos_integer(c->'surcharge_cents',100000000,'Enter a valid flavor surcharge.') else (oldc->>'surcharge_cents')::integer end;
    cap:=tlb.pos_integer(c->'capacity',100000,'Enter a whole flavor stock count.');
    used:=coalesce((usage#>>array[g->>'id',c->>'id'])::bigint,0);
    perform tlb.require(cap>=used,'Stock for '||label||' cannot be below units already sold or retained.');
    choices:=choices||jsonb_build_array(jsonb_build_object('id',c->>'id','label',label,'custom',custom,'surcharge_cents',surcharge,'capacity',cap,'active',coalesce((c->>'active')::boolean,true)));
   end loop;
   perform tlb.require(not exists(select 1 from jsonb_array_elements(choices) v group by lower(v->>'label') having count(*)>1),'Use different names for each flavor.');
   result:=result||jsonb_build_array(jsonb_build_object('id',oldg->>'id','label',oldg->>'label','required_count',(oldg->>'required_count')::integer,'choices',choices));
  end loop;
  update tlb.pos_stock set option_groups=result where event_id=p_event and product_id=pid;
 end loop;
end $$;

create function tlb.pos_check_flavor_stock(p_event uuid,p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare s record; g jsonb; c jsonb; usage jsonb; requested bigint; used bigint;
begin
 for s in select ps.* from tlb.pos_stock ps where ps.event_id=p_event and ps.option_groups is not null
  and exists(select 1 from jsonb_array_elements(p_payload->'items') v where nullif(v->>'product_id','')::uuid=ps.product_id) loop
  usage:=tlb.pos_flavor_usage(p_event,s.product_id);
  for g in select value from jsonb_array_elements(s.option_groups) loop
   for c in select value from jsonb_array_elements(g->'choices') loop
    select coalesce(sum((v->>'quantity')::bigint*coalesce((v#>>array['selections',g->>'id',c->>'id'])::bigint,0)),0) into requested
    from jsonb_array_elements(p_payload->'items') v where nullif(v->>'product_id','')::uuid=s.product_id;
    used:=coalesce((usage#>>array[g->>'id',c->>'id'])::bigint,0);
    perform tlb.require(requested<=(c->>'capacity')::bigint-used,'Not enough stock for '||(c->>'label')||'. Refresh quantities and try again.');
   end loop;
  end loop;
 end loop;
end $$;

-- Extend the installed functions, including all previous delivery and custom-item fixes.
do $migration$
declare fn text; old text; replacement text;
begin
 fn:=pg_get_functiondef('tlb.pos_event_json(uuid)'::regprocedure);
 old:=$old$'remaining',s.capacity-coalesce(a.used,0)$old$;
 replacement:=$new$'remaining',s.capacity-coalesce(a.used,0),'options_tracked',s.option_groups is not null,'option_groups',tlb.pos_event_options(s.event_id,s.product_id)$new$;
 -- Only catalog stock has product_id; custom stock uses its own JSON aggregation.
 if position(old in fn)=0 then raise exception 'POS stock JSON marker missing'; end if;
 fn:=overlay(fn placing replacement from position(old in fn) for length(old));
 execute fn;

 fn:=pg_get_functiondef('tlb.pos_quote(jsonb,uuid,uuid)'::regprocedure);
 old:=$old$perform tlb.require(product is not null,'A selected product no longer exists.');$old$;
 replacement:=old||$new$
   if channel='popup' then
    select * into stock from tlb.pos_stock s where s.event_id=event.id and s.product_id=v_product_id;
    if stock.option_groups is not null then product:=product||jsonb_build_object('option_groups',stock.option_groups); end if;
   end if;$new$;
 if position(old in fn)=0 then raise exception 'POS options quote marker missing'; end if;
 fn:=replace(fn,old,replacement);
 -- Aggregate canonical UUIDs so alternate casing cannot bypass total stock limits.
 old:=$old$where v->>'product_id'=v_product_id::text;$old$;
 if position(old in fn)=0 then raise exception 'POS product quantity marker missing'; end if;
 fn:=replace(fn,old,$new$where nullif(v->>'product_id','')::uuid=v_product_id;$new$);
 old:=$old$perform tlb.require(subtotal<=1000000000,$old$;
 if position(old in fn)=0 then raise exception 'POS subtotal marker missing'; end if;
 fn:=replace(fn,old,'if channel=''popup'' then perform tlb.pos_check_flavor_stock(event.id,p_payload); end if; '||old);
 execute fn;

 fn:=pg_get_functiondef('tlb.pos_api(uuid,text,jsonb)'::regprocedure);
 old:=$old$perform tlb.pos_save_custom_stock(eid,p_payload);$old$;
 if position(old in fn)=0 then raise exception 'POS event save marker missing'; end if;
 execute replace(fn,old,old||' perform tlb.pos_save_flavor_stock(eid,p_payload);');
end $migration$;

revoke all on function tlb.pos_flavor_usage(uuid,uuid),tlb.pos_event_options(uuid,uuid),tlb.pos_save_flavor_stock(uuid,jsonb),tlb.pos_check_flavor_stock(uuid,jsonb) from public,anon,authenticated,service_role;
