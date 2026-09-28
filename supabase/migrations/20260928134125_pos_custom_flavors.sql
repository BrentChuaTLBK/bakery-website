-- Custom event products keep flavor stock outside the public product catalog.
alter table tlb.pos_custom_stock add column option_groups jsonb
 check(option_groups is null or jsonb_typeof(option_groups)='array');

create function tlb.pos_custom_flavor_usage(p_event uuid,p_item uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_object_agg(choice_id,used),'{}'::jsonb) from (
  select c.key choice_id,sum((i->>'quantity')::bigint*(c.value::text)::bigint) used
  from tlb.pos_custom_allocations a join tlb.orders o on o.id=a.order_id
  cross join lateral jsonb_array_elements(o.data->'items') i
  cross join lateral jsonb_each(coalesce(i#>'{selections,flavor}','{}')) c
  where a.event_id=p_event and a.custom_event_item_id=p_item
   and nullif(i->>'custom_event_item_id','')::uuid=p_item
  group by c.key
 ) counts
$$;

create function tlb.pos_custom_options(p_event uuid,p_item uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare groups jsonb; usage jsonb; c jsonb; choices jsonb:='[]'; used bigint;
begin
 select option_groups into groups from tlb.pos_custom_stock where event_id=p_event and id=p_item;
 if groups is null then return '[]'::jsonb; end if;
 usage:=tlb.pos_custom_flavor_usage(p_event,p_item);
 for c in select value from jsonb_array_elements(groups#>'{0,choices}') loop
  used:=coalesce((usage->>(c->>'id'))::bigint,0);
  choices:=choices||jsonb_build_array(c||jsonb_build_object('used',used,'remaining',(c->>'capacity')::bigint-used));
 end loop;
 return jsonb_set(groups,'{0,choices}',choices);
end $$;

create or replace function tlb.pos_save_custom_stock(p_event uuid,p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare x jsonb; cid uuid; cap integer; price integer; used bigint; baseline jsonb; groups jsonb;
 usage jsonb; oldc jsonb; c jsonb; choices jsonb; label text; flavor_cap integer; flavor_used bigint; total_cap bigint; unassigned bigint;
begin
 if not p_payload ? 'custom_stock' then return; end if;
 perform tlb.require(jsonb_typeof(p_payload->'custom_stock')='array','Custom stock must be a list.');
 perform tlb.require(jsonb_array_length(p_payload->'stock')+jsonb_array_length(p_payload->'custom_stock')<=500,'Use up to 500 event products.');
 perform tlb.require(not exists(select 1 from jsonb_array_elements(p_payload->'custom_stock') v group by (v->>'id')::uuid having count(*)>1),'Add each custom event product only once.');
 update tlb.pos_custom_stock set active=false where event_id=p_event;
 for x in select value from jsonb_array_elements(p_payload->'custom_stock') loop
  cid:=(x->>'id')::uuid;
  perform tlb.require(cid is not null,'A custom event product needs an ID.');
  perform tlb.require(not exists(select 1 from tlb.pos_custom_stock where id=cid and event_id<>p_event),'This custom product belongs to another event.');
  perform tlb.require(length(trim(coalesce(x->>'name',''))) between 1 and 160,'Enter a custom event product name.');
  perform tlb.require(length(coalesce(x->>'description',''))<=2000,'Custom item details must be at most 2000 characters.');
  cap:=tlb.pos_integer(x->'capacity',100000,'Enter a whole event stock count.');
  price:=tlb.pos_integer(x->'price_cents',100000000,'Enter a valid event price.');
  select coalesce(sum(quantity),0) into used from tlb.pos_custom_allocations where event_id=p_event and custom_event_item_id=cid;
  select option_groups into baseline from tlb.pos_custom_stock where event_id=p_event and id=cid;
  -- Older clients cannot clear or bypass flavor tracking by omitting it.
  groups:=case when coalesce((x->>'options_tracked')::boolean,false) then x->'option_groups' else baseline end;
  if coalesce((x->>'options_tracked')::boolean,false) then perform tlb.require(groups is not null,'Custom flavors must be a list.'); end if;
  if groups is not null then
   perform tlb.require(jsonb_typeof(groups)='array' and jsonb_array_length(groups)=1,'Use one flavor group for a custom event product.');
   perform tlb.require(groups#>>'{0,id}'='flavor' and groups#>>'{0,required_count}'='1','Custom products use exactly one flavor per item.');
   perform tlb.require(jsonb_typeof(groups#>'{0,choices}')='array' and jsonb_array_length(groups#>'{0,choices}')<=100,'Use up to 100 custom flavors.');
   perform tlb.require(not exists(select 1 from jsonb_array_elements(groups#>'{0,choices}') v group by v->>'id' having count(*)>1),'Use each flavor once.');
   usage:=tlb.pos_custom_flavor_usage(p_event,cid);
   perform tlb.require(not exists(select 1 from jsonb_array_elements(baseline#>'{0,choices}') v
    where coalesce((usage->>(v->>'id'))::bigint,0)>0
     and not exists(select 1 from jsonb_array_elements(groups#>'{0,choices}') n where n->>'id'=v->>'id')
   ),'Keep flavors with sold or retained stock. Turn off those not offered.');
   select greatest(0,used-coalesce(sum((v.value::text)::bigint),0)) into unassigned from jsonb_each(usage) v;
   total_cap:=unassigned;choices:='[]';
   for c in select value from jsonb_array_elements(groups#>'{0,choices}') loop
    perform tlb.require(coalesce(c->>'id','') ~ '^event-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','New event flavors need a unique event ID.');
    label:=trim(coalesce(c->>'label',''));perform tlb.require(length(label) between 1 and 120,'Enter a flavor name (up to 120 characters).');
    flavor_cap:=tlb.pos_integer(c->'capacity',100000,'Enter a whole flavor stock count.');
    flavor_used:=coalesce((usage->>(c->>'id'))::bigint,0);
    perform tlb.require(flavor_cap>=flavor_used,'Stock for '||label||' cannot be below units already sold or retained.');
    total_cap:=total_cap+flavor_cap;
    choices:=choices||jsonb_build_array(jsonb_build_object('id',c->>'id','label',label,'custom',true,'capacity',flavor_cap,
     'surcharge_cents',tlb.pos_integer(c->'surcharge_cents',100000000,'Enter a valid flavor surcharge.'),'active',coalesce((c->>'active')::boolean,true)));
   end loop;
   perform tlb.require(total_cap<=100000,'Use up to 100000 total units per event product.');
   perform tlb.require(not exists(select 1 from jsonb_array_elements(choices) v group by lower(v->>'label') having count(*)>1),'Use different names for each flavor.');
   groups:=jsonb_build_array(jsonb_build_object('id','flavor','label','Flavor','required_count',1,'choices',choices));cap:=total_cap;
  end if;
  perform tlb.require(cap>=used,'Event stock cannot be below units already sold or retained.');
  insert into tlb.pos_custom_stock(id,event_id,name,description,capacity,price_cents,active,option_groups)
  values(cid,p_event,trim(x->>'name'),coalesce(x->>'description',''),cap,price,coalesce((x->>'active')::boolean,true),groups)
  on conflict(id) do update set name=excluded.name,description=excluded.description,capacity=excluded.capacity,price_cents=excluded.price_cents,active=excluded.active,option_groups=excluded.option_groups;
 end loop;
end $$;

create or replace function tlb.pos_custom_item_quote(p_line jsonb,p_payload jsonb,p_event uuid) returns jsonb
language plpgsql set search_path='' as $$
declare s tlb.pos_custom_stock; requested bigint; remaining bigint; usage jsonb; sels jsonb; group_sels jsonb;
 key text; chosen jsonb; c jsonb; n integer; chosen_count integer:=0; surcharge bigint:=0; labels jsonb:='[]';
begin
 perform tlb.require(p_payload->>'source'='popup' and nullif(p_line->>'product_id','') is null,'Custom event products can only be sold at their event.');
 select * into s from tlb.pos_custom_stock where event_id=p_event and id=(p_line->>'custom_event_item_id')::uuid;
 perform tlb.require(s.id is not null and s.active,'This custom product is not available at this event.');
 select sum(tlb.pos_integer(v->'quantity',10000,'Invalid item quantity.')) into requested
 from jsonb_array_elements(p_payload->'items') v where nullif(v->>'custom_event_item_id','')::uuid=s.id;
 select s.capacity-coalesce(sum(quantity),0) into remaining from tlb.pos_custom_allocations where event_id=p_event and custom_event_item_id=s.id;
 perform tlb.require(requested<=remaining,'Not enough stock for '||s.name||'. Refresh quantities and try again.');
 sels:=coalesce(p_line->'selections','{}');perform tlb.require(jsonb_typeof(sels)='object','Invalid product options.');
 for key in select jsonb_object_keys(sels) loop
  perform tlb.require(s.option_groups is not null and key='flavor','Unknown product option group.');
 end loop;
 if s.option_groups is not null then
  group_sels:=coalesce(sels->'flavor','{}');perform tlb.require(jsonb_typeof(group_sels)='object','Invalid flavor choices.');
  for key,chosen in select * from jsonb_each(group_sels) loop
   n:=tlb.pos_integer(chosen,10000,'Option quantities must be whole numbers.');
   select value into c from jsonb_array_elements(s.option_groups#>'{0,choices}') where value->>'id'=key;
   perform tlb.require(c is not null,'Unknown product option.');
   if n>0 then
    perform tlb.require(coalesce((c->>'active')::boolean,true),'This flavor is unavailable.');
    chosen_count:=chosen_count+n;surcharge:=surcharge+(c->>'surcharge_cents')::bigint*n;
    labels:=labels||jsonb_build_array(jsonb_build_object('group','Flavor','label',c->>'label','quantity',n,'surcharge_cents',(c->>'surcharge_cents')::integer));
   end if;
  end loop;
  perform tlb.require(chosen_count=1,'Choose exactly 1 flavor.');
  usage:=tlb.pos_custom_flavor_usage(p_event,s.id);
  for c in select value from jsonb_array_elements(s.option_groups#>'{0,choices}') loop
   select coalesce(sum(tlb.pos_integer(v->'quantity',10000,'Invalid item quantity.')::bigint*
    tlb.pos_integer(coalesce(v#>array['selections','flavor',c->>'id'],'0'::jsonb),10000,'Option quantities must be whole numbers.')),0) into requested
   from jsonb_array_elements(p_payload->'items') v where nullif(v->>'custom_event_item_id','')::uuid=s.id;
   perform tlb.require(requested<=(c->>'capacity')::bigint-coalesce((usage->>(c->>'id'))::bigint,0),'Not enough stock for '||(c->>'label')||'. Refresh quantities and try again.');
  end loop;
 end if;
 return jsonb_build_object('product_id',null,'custom_event_item_id',s.id,'name',s.name,'description',s.description,'custom',true,'selections',sels,'selection_labels',labels,'unit_price_cents',s.price_cents+surcharge);
end $$;

do $migration$
declare fn text; old text; replacement text;
begin
 fn:=pg_get_functiondef('tlb.pos_event_json(uuid)'::regprocedure);
 old:=$before$'custom_stock',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('used',coalesce(a.used,0),'remaining',s.capacity-coalesce(a.used,0))$before$;
 replacement:=$after$'custom_stock',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('used',coalesce(a.used,0),'remaining',s.capacity-coalesce(a.used,0),
  'options_tracked',s.option_groups is not null,'option_groups',tlb.pos_custom_options(s.event_id,s.id),
  'unassigned_used',greatest(0,coalesce(a.used,0)-coalesce((select sum((v.value::text)::bigint) from jsonb_each(tlb.pos_custom_flavor_usage(s.event_id,s.id)) v),0)))$after$;
 if position(old in fn)=0 then raise exception 'Custom stock JSON marker missing'; end if;
 execute replace(fn,old,replacement);
end $migration$;
revoke all on function tlb.pos_custom_flavor_usage(uuid,uuid),tlb.pos_custom_options(uuid,uuid),tlb.pos_save_custom_stock(uuid,jsonb),tlb.pos_custom_item_quote(jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
