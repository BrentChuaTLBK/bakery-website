-- Event-only products have their own stock; website products and allocations are unchanged.
create table tlb.pos_custom_stock (
 id uuid primary key, event_id uuid not null references tlb.pos_events(id),
 name text not null check(length(trim(name)) between 1 and 160),
 description text not null default '' check(length(description)<=2000),
 capacity integer not null check(capacity between 0 and 100000),
 price_cents integer not null check(price_cents between 0 and 100000000),
 active boolean not null default true, unique(event_id,id)
);
create table tlb.pos_custom_allocations (
 order_id uuid not null references tlb.orders(id), event_id uuid not null,
 custom_event_item_id uuid not null, quantity integer not null check(quantity>0),
 primary key(order_id,custom_event_item_id),
 foreign key(event_id,custom_event_item_id) references tlb.pos_custom_stock(event_id,id)
);
create index pos_custom_allocations_stock on tlb.pos_custom_allocations(event_id,custom_event_item_id);
alter table tlb.pos_custom_stock enable row level security;
alter table tlb.pos_custom_allocations enable row level security;
revoke all on tlb.pos_custom_stock,tlb.pos_custom_allocations from public,anon,authenticated,service_role;

create function tlb.pos_save_custom_stock(p_event uuid,p_payload jsonb) returns void
language plpgsql set search_path='' as $$
declare x jsonb; cid uuid; cap integer; price integer; used bigint;
begin
 -- Old clients omit this key: preserve any custom stock they cannot display.
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
  perform tlb.require(cap>=used,'Event stock cannot be below units already sold or retained.');
  insert into tlb.pos_custom_stock(id,event_id,name,description,capacity,price_cents,active)
  values(cid,p_event,trim(x->>'name'),coalesce(x->>'description',''),cap,price,coalesce((x->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,description=excluded.description,capacity=excluded.capacity,price_cents=excluded.price_cents,active=excluded.active;
 end loop;
end $$;

create function tlb.pos_custom_item_quote(p_line jsonb,p_payload jsonb,p_event uuid) returns jsonb
language plpgsql set search_path='' as $$
declare s tlb.pos_custom_stock; requested bigint; remaining bigint;
begin
 perform tlb.require(p_payload->>'source'='popup' and nullif(p_line->>'product_id','') is null,'Custom event products can only be sold at their event.');
 select * into s from tlb.pos_custom_stock where event_id=p_event and id=(p_line->>'custom_event_item_id')::uuid;
 perform tlb.require(s.id is not null and s.active,'This custom product is not available at this event.');
 select sum(tlb.pos_integer(v->'quantity',10000,'Invalid item quantity.')) into requested
 from jsonb_array_elements(p_payload->'items') v where nullif(v->>'custom_event_item_id','')::uuid=s.id;
 select s.capacity-coalesce(sum(quantity),0) into remaining from tlb.pos_custom_allocations where event_id=p_event and custom_event_item_id=s.id;
 perform tlb.require(requested<=remaining,'Not enough stock for '||s.name||'. Refresh quantities and try again.');
 return jsonb_build_object('product_id',null,'custom_event_item_id',s.id,'name',s.name,'description',s.description,'custom',true,'selections','{}'::jsonb,'selection_labels','[]'::jsonb,'unit_price_cents',s.price_cents);
end $$;

-- Guarded additions preserve the delivery-fee changes already installed on POS functions.
do $migration$
declare fn text; old text; replacement text;
begin
 fn:=pg_get_functiondef('tlb.pos_event_json(uuid)'::regprocedure);
 old:=$old$'sales',coalesce($old$;
 replacement:=$new$'custom_stock',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('used',coalesce(a.used,0),'remaining',s.capacity-coalesce(a.used,0)) order by s.name)
  from tlb.pos_custom_stock s left join (select custom_event_item_id,sum(quantity) used from tlb.pos_custom_allocations where event_id=p_id group by custom_event_item_id) a on a.custom_event_item_id=s.id where s.event_id=p_id),'[]'::jsonb),
  'sales',coalesce($new$;
 if position(old in fn)=0 then raise exception 'POS event JSON marker missing'; end if;
 execute replace(fn,old,replacement);

 fn:=pg_get_functiondef('tlb.pos_quote(jsonb,uuid,uuid)'::regprocedure);
 old:=$old$if v_product_id is null then$old$;
 replacement:=$new$if nullif(line->>'custom_event_item_id','') is not null then
   item:=tlb.pos_custom_item_quote(line,p_payload,event.id);
   price:=(item->>'unit_price_cents')::bigint;
  elsif v_product_id is null then$new$;
 if position(old in fn)=0 then raise exception 'POS quote marker missing'; end if;
 fn:=replace(fn,old,replacement);
 old:=$old$if line ? 'unit_price_cents' then price:=tlb.pos_integer(line->'unit_price_cents',100000000,'Enter a valid item price.'); end if;$old$;
 if position(old in fn)=0 then raise exception 'POS catalog price marker missing'; end if;
 -- Catalog price plus selected options is authoritative; custom items keep their own prices.
 execute replace(fn,old,'-- Website product prices cannot be overridden in direct orders.');

 fn:=pg_get_functiondef('tlb.pos_api(uuid,text,jsonb)'::regprocedure);
 old:=$old$row_data:=tlb.pos_event_json(eid);$old$;
 if position(old in fn)=0 then raise exception 'POS save event marker missing'; end if;
 fn:=replace(fn,old,'perform tlb.pos_save_custom_stock(eid,p_payload); '||old);
 old:=$old$from jsonb_array_elements(q->'items') v group by v->>'product_id';$old$;
 replacement:=$new$from jsonb_array_elements(q->'items') v where v->>'product_id' is not null group by v->>'product_id';
   insert into tlb.pos_custom_allocations(order_id,event_id,custom_event_item_id,quantity)
   select oid,(q->>'event_id')::uuid,(v->>'custom_event_item_id')::uuid,sum((v->>'quantity')::integer) from jsonb_array_elements(q->'items') v where v->>'custom_event_item_id' is not null group by v->>'custom_event_item_id';$new$;
 if position(old in fn)=0 then raise exception 'POS allocation marker missing'; end if;
 fn:=replace(fn,old,replacement);
 old:=$old$delete from tlb.pos_allocations where order_id=o.id;$old$;
 if position(old in fn)=0 then raise exception 'POS void stock marker missing'; end if;
 fn:=replace(fn,old,old||' delete from tlb.pos_custom_allocations where order_id=o.id;');
 execute fn;
end $migration$;

revoke all on function tlb.pos_save_custom_stock(uuid,jsonb),tlb.pos_custom_item_quote(jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
