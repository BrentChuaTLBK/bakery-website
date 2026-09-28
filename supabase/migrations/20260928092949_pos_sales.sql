-- Two staff-operated sales channels. Public website checkout retains its rules.
begin;
set local lock_timeout='3s';
create table tlb.pos_events (
 id uuid primary key, name text not null check(length(trim(name)) between 1 and 120),
 location text not null default '' check(length(location)<=500),
 starts_on date not null, ends_on date not null check(ends_on>=starts_on),
 closed boolean not null default false, revision integer not null default 1,
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null references auth.users(id)
);
create index pos_events_dates on tlb.pos_events(starts_on desc);
create index pos_events_creator on tlb.pos_events(created_by);
create table tlb.pos_stock (
 event_id uuid not null references tlb.pos_events(id), product_id uuid not null references tlb.products(id),
 capacity integer not null check(capacity between 0 and 100000),
 price_cents integer not null check(price_cents between 0 and 100000000),
 active boolean not null default true, primary key(event_id,product_id)
);
create index pos_stock_product on tlb.pos_stock(product_id);
create table tlb.pos_allocations (
 order_id uuid not null references tlb.orders(id), event_id uuid not null,
 product_id uuid not null, quantity integer not null check(quantity>0),
 primary key(order_id,product_id),
 foreign key(event_id,product_id) references tlb.pos_stock(event_id,product_id)
);
create index pos_allocations_stock on tlb.pos_allocations(event_id,product_id);
create table tlb.pos_event_audit (
 id bigint generated always as identity primary key, event_id uuid not null references tlb.pos_events(id),
 actor uuid not null references auth.users(id), at timestamptz not null default clock_timestamp(), before_data jsonb, after_data jsonb not null
);
create index pos_event_audit_event on tlb.pos_event_audit(event_id,id);
create index pos_event_audit_actor on tlb.pos_event_audit(actor);
do $$ declare t text; begin
 foreach t in array array['pos_events','pos_stock','pos_allocations','pos_event_audit'] loop
  execute format('alter table tlb.%I enable row level security',t);
  execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on sequence tlb.pos_event_audit_id_seq from public,anon,authenticated,service_role;

alter table tlb.orders add column source text not null default 'website' check(source in ('website','popup','direct_message'));
alter table tlb.orders add column pos_event_id uuid references tlb.pos_events(id);
alter table tlb.orders add constraint orders_source_snapshot check(coalesce(data->>'source','website')=source);
alter table tlb.orders add constraint orders_pos_event check((source='popup')=(pos_event_id is not null));
alter table tlb.orders alter column payment_deadline drop not null;
alter table tlb.orders add constraint orders_payment_deadline check((source='direct_message')=(payment_deadline is null));
create index orders_pos_event on tlb.orders(pos_event_id,created_at desc) where pos_event_id is not null;
create index orders_source_created on tlb.orders(source,created_at desc);

create function tlb.pos_integer(value jsonb, maximum bigint, message text) returns bigint
language plpgsql immutable set search_path='' as $$
begin
 perform tlb.require(jsonb_typeof(value)='number' and value::text ~ '^[0-9]{1,10}$',message);
 perform tlb.require(value::text::bigint<=maximum,message);
 return value::text::bigint;
end $$;

create function tlb.pos_event_json(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select to_jsonb(e)||jsonb_build_object('stock',coalesce((
  select jsonb_agg(to_jsonb(s)||jsonb_build_object('used',coalesce(a.used,0),'remaining',s.capacity-coalesce(a.used,0)) order by p.data->>'name')
  from tlb.pos_stock s join tlb.products p on p.id=s.product_id
  left join (select product_id,sum(quantity) used from tlb.pos_allocations where event_id=p_id group by product_id) a using(product_id)
  where s.event_id=e.id),'[]'::jsonb),
  'sales',coalesce((select jsonb_agg(to_jsonb(x)) from (
   select coalesce(data->>'payment_method','unknown') payment_method,count(*) orders,
    sum((data->>'total_cents')::bigint) total_cents,sum((data->>'discount_cents')::bigint) discount_cents
   from tlb.orders where pos_event_id=p_id and payment_status='paid' and fulfillment_status='completed' and not refund_label
   group by data->>'payment_method') x),'[]'::jsonb)) from tlb.pos_events e where e.id=p_id
$$;

create function tlb.pos_quote(p_payload jsonb,p_user uuid,p_original uuid default null) returns jsonb
language plpgsql set search_path='' as $$
declare
 channel text:=p_payload->>'source'; event tlb.pos_events; stock tlb.pos_stock; settings jsonb;
 line jsonb; product jsonb; items jsonb:='[]'; item jsonb; sels jsonb; group_sels jsonb; g jsonb; choice jsonb; labels jsonb;
 key text; chosen jsonb; qty integer; n integer; chosen_count integer; surcharge bigint; price bigint; subtotal bigint:=0;
 discount bigint:=0; delivery bigint:=0; total bigint; discount_value bigint; discount_kind text:=coalesce(p_payload#>>'{discount,kind}','none');
 day date:=(p_payload->>'fulfillment_date')::date; today date:=(clock_timestamp() at time zone 'Asia/Manila')::date;
 method text:=p_payload->>'method'; override_dates boolean:=coalesce((p_payload->>'override_dates')::boolean,false);
 earliest date; requested bigint; remaining bigint; v_product_id uuid; existing tlb.orders;
begin
 perform tlb.assert_staff(p_user);
 perform tlb.require(channel in ('popup','direct_message'),'Choose a pop-up sale or direct-message order.');
 perform tlb.require(jsonb_typeof(p_payload->'items')='array' and jsonb_array_length(p_payload->'items') between 1 and 100,'Add 1 to 100 items.');
 select data into settings from tlb.settings where id;
 if p_original is not null then select * into strict existing from tlb.orders where id=p_original; end if;
 if channel='popup' then
  select * into event from tlb.pos_events where id=(p_payload->>'event_id')::uuid;
  perform tlb.require(event.id is not null and not event.closed,'Choose an open pop-up event.');
  perform tlb.require(today between event.starts_on and event.ends_on,'This event is not scheduled for today. Update its dates before recording sales.');
  day:=today; method:='pickup';
 else
  perform tlb.require(day between today and today+730,'Choose a fulfillment date from today to two years ahead.');
  perform tlb.require(method in ('pickup','delivery'),'Choose pickup or delivery.');
  if override_dates then
   perform tlb.assert_staff(p_user,true);
   perform tlb.require(length(trim(coalesce(p_payload->>'override_reason',''))) between 3 and 500,'Explain the owner date override.');
  else
   perform tlb.require(tlb.date_supported(day,method,settings),'This fulfillment date is closed. The owner can explicitly override the date.');
  end if;
 end if;
 for line in select value from jsonb_array_elements(p_payload->'items') loop
  qty:=tlb.pos_integer(line->'quantity',10000,'Use a whole quantity from 1 to 10000.');
  perform tlb.require(qty>0,'Quantity must be at least 1.');
  v_product_id:=nullif(line->>'product_id','')::uuid;
  sels:=coalesce(line->'selections','{}'); labels:='[]'; surcharge:=0;
  if v_product_id is null then
   perform tlb.require(channel='direct_message','Pop-up items must come from the event stock.');
   perform tlb.require(length(trim(coalesce(line->>'name',''))) between 1 and 160,'Enter a custom item name.');
   perform tlb.require(length(coalesce(line->>'description',''))<=2000,'Custom item details must be at most 2000 characters.');
   price:=tlb.pos_integer(line->'unit_price_cents',100000000,'Enter a valid custom item price.');
   item:=jsonb_build_object('product_id',null,'name',trim(line->>'name'),'description',coalesce(line->>'description',''),'custom',true,'selections','{}'::jsonb,'selection_labels','[]'::jsonb);
  else
   select data into product from tlb.products where id=v_product_id;
   perform tlb.require(product is not null,'A selected product no longer exists.');
   perform tlb.require(jsonb_typeof(sels)='object','Invalid product options.');
   for key in select jsonb_object_keys(sels) loop
    perform tlb.require(exists(select 1 from jsonb_array_elements(coalesce(product->'option_groups','[]')) where value->>'id'=key),'Unknown product option group.');
   end loop;
   for g in select value from jsonb_array_elements(coalesce(product->'option_groups','[]')) loop
    group_sels:=coalesce(sels->(g->>'id'),'{}');chosen_count:=0;
    perform tlb.require(jsonb_typeof(group_sels)='object','Invalid product option choices.');
    for key,chosen in select * from jsonb_each(group_sels) loop
     n:=tlb.pos_integer(chosen,10000,'Option quantities must be whole numbers.');
     select value into choice from jsonb_array_elements(g->'choices') where value->>'id'=key;
     perform tlb.require(choice is not null,'Unknown product option.');
     if n>0 then
      perform tlb.require(coalesce((choice->>'active')::boolean,true),'This product option is unavailable.');
      chosen_count:=chosen_count+n; surcharge:=surcharge+(choice->>'surcharge_cents')::bigint*n;
      labels:=labels||jsonb_build_array(jsonb_build_object('group',g->>'label','label',choice->>'label','quantity',n,'surcharge_cents',(choice->>'surcharge_cents')::integer));
     end if;
    end loop;
    perform tlb.require(chosen_count=(g->>'required_count')::integer,'Choose exactly '||(g->>'required_count')||' for '||(g->>'label')||'.');
   end loop;
   select sum(tlb.pos_integer(v->'quantity',10000,'Invalid item quantity.')) into requested from jsonb_array_elements(p_payload->'items') v where v->>'product_id'=v_product_id::text;
   if channel='popup' then
    select * into stock from tlb.pos_stock s where s.event_id=event.id and s.product_id=v_product_id;
    perform tlb.require(stock.event_id is not null and stock.active,'This product is not available at this event.');
    select stock.capacity-coalesce(sum(a.quantity),0) into remaining from tlb.pos_allocations a where a.event_id=event.id and a.product_id=v_product_id;
    price:=stock.price_cents+surcharge;
   else
    perform tlb.require(coalesce((product->>'active')::boolean,false),'Product unavailable: '||(product->>'name'));
    perform tlb.require(requested>=coalesce((product->>'min_quantity')::integer,1),'The product minimum quantity has not been met.');
    perform tlb.require(method<>'delivery' or not coalesce((product->>'pickup_only')::boolean,false),'This product is pickup only.');
    if not override_dates then
     earliest:=tlb.earliest_lead_date(clock_timestamp(),coalesce((product->>'lead_days')::integer,0),settings);
     if day=today then
      perform tlb.require(coalesce((product->>'lead_days')::integer,0)=0 and coalesce((product->>'allow_same_day')::boolean,false) and tlb.is_production(today,settings),'This product needs an owner override for same-day fulfillment.');
      perform tlb.require(nullif(settings->>'cutoff_time','') is null or (clock_timestamp() at time zone 'Asia/Manila')::time<(settings->>'cutoff_time')::time,'The same-day cutoff has passed. An owner date override is required.');
     else perform tlb.require(day>=earliest,'This product needs more production time. Earliest lead-time date: '||earliest::text); end if;
    end if;
    perform tlb.require(not exists(select 1 from tlb.inventory i where i.product_id=v_product_id and i.date=day and not i.available),'This product is unavailable on that date.');
    remaining:=tlb.capacity_remaining(v_product_id,day,p_original);
    price:=(product->>'price_cents')::bigint+surcharge;
    if line ? 'unit_price_cents' then price:=tlb.pos_integer(line->'unit_price_cents',100000000,'Enter a valid item price.'); end if;
   end if;
   perform tlb.require(remaining is null or requested<=remaining,'Not enough stock for '||(product->>'name')||'. Refresh quantities and try again.');
   item:=jsonb_build_object('product_id',v_product_id,'name',product->>'name','custom',false,'selections',sels,'selection_labels',labels);
  end if;
  perform tlb.require(price between 0 and 100000000,'Item price is outside the supported range.');
  subtotal:=subtotal+price*qty;
  items:=items||jsonb_build_array(item||jsonb_build_object('quantity',qty,'unit_price_cents',price,'line_total_cents',price*qty));
 end loop;
 perform tlb.require(subtotal<=1000000000,'Order subtotal exceeds the supported amount.');
 perform tlb.require(discount_kind in ('none','fixed','percent'),'Choose a fixed or percentage discount.');
 if discount_kind<>'none' then
  discount_value:=tlb.pos_integer(p_payload#>'{discount,value}',case when discount_kind='percent' then 100 else 1000000000 end,'Enter a valid discount.');
  discount:=case when discount_kind='percent' then round(subtotal*discount_value/100.0)::bigint else discount_value end;
  perform tlb.require(discount<=subtotal,'The discount cannot exceed the product subtotal.');
 end if;
 if channel='direct_message' and method='delivery' then
  delivery:=tlb.pos_integer(p_payload->'delivery_cents',100000000,'Enter a valid delivery fee.');
  perform tlb.require(length(coalesce(p_payload#>>'{address,line1}',''))<=1000,'Delivery address is too long.');
  perform tlb.require(length(coalesce(p_payload#>>'{recipient,name}',''))<=200 and length(coalesce(p_payload#>>'{recipient,phone}',''))<=40,'Recipient details are too long.');
 end if;
 total:=subtotal-discount+delivery;
 perform tlb.require(total between 0 and 1000000000,'Order total exceeds the supported amount.');
 return jsonb_build_object('source',channel,'event_id',event.id,'event_revision',event.revision,'fulfillment_date',day,'method',method,'items',items,'subtotal_cents',subtotal,'discount_cents',discount,'delivery_cents',delivery,'total_cents',total);
end $$;

create function tlb.pos_receive_payment(p_id uuid,p_user uuid,p_payment jsonb) returns void
language plpgsql set search_path='' as $$
declare o tlb.orders; v_method text:=p_payment->>'method'; received bigint; total bigint;
begin
 select * into strict o from tlb.orders where id=p_id for update;
 perform tlb.require(o.source in ('popup','direct_message') and o.payment_status in ('awaiting_payment','under_review') and o.fulfillment_status='pending_confirmation' and not o.refund_label,'Only an unpaid active POS order can receive payment.');
 perform tlb.require(v_method in ('cash','gcash','bdo','eastwest'),'Choose Cash, GCash, BDO or EastWest.');
 total:=(o.data->>'total_cents')::bigint;
 perform tlb.require(tlb.pos_integer(p_payment->'amount_cents',1000000000,'Confirm the full payment amount.')=total,'Only full payment is supported.');
 received:=total;
 if v_method='cash' then
  received:=tlb.pos_integer(p_payment->'received_cents',1000000000,'Enter the cash received.');
  perform tlb.require(received>=total,'Cash received must cover the full total.');
 end if;
 perform tlb.require(length(coalesce(p_payment->>'reference',''))<=200,'Payment reference must be at most 200 characters.');
 insert into tlb.payments(order_id,amount_cents,proof_path,payment_reference,approved_by)
 values(p_id,total,coalesce(o.proof_path,''),coalesce(nullif(p_payment->>'reference',''),o.payment_reference,''),p_user);
 update tlb.orders set payment_status='paid',paid_amount_cents=total,
  fulfillment_status=case when source='popup' then 'completed' else 'confirmed' end,
  payment_reference=coalesce(nullif(p_payment->>'reference',''),o.payment_reference),revision=revision+1,
  data=data||jsonb_build_object('payment_method',v_method,'cash_received_cents',case when v_method='cash' then received end,'change_cents',case when v_method='cash' then received-total end)
 where id=p_id;
 update tlb.allocations set state='committed' where order_id=p_id and state='held';
end $$;

create function tlb.pos_api(p_user uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare e tlb.pos_events; old_event jsonb; row_data jsonb; x jsonb; q jsonb; s jsonb; o tlb.orders;
 eid uuid; oid uuid; pid uuid; cap integer; price integer; used bigint; token text; v_key uuid; hashed text;
 prior tlb.action_keys; before_order jsonb; v_email text; notify boolean; reason text;
begin
 perform tlb.assert_staff(p_user);
 perform tlb.require(tlb.is_verified(p_user),'Verify your staff email before using POS.');
 if p_action='pos_find_submission' then
  select * into o from tlb.orders where idempotency_key=(p_payload->>'idempotency_key')::uuid and source<>'website' and data->>'created_by'=p_user::text;
  if found then return tlb.order_json(o.id,true,true); end if;
  return null;
 end if;
 if p_action='pos_bootstrap' then
  return jsonb_build_object('events',(select coalesce(jsonb_agg(tlb.pos_event_json(id) order by starts_on desc),'[]') from tlb.pos_events),
   'orders',(select coalesce(jsonb_agg(tlb.order_json(id,true,false) order by created_at desc),'[]') from (select id,created_at from tlb.orders where source<>'website' order by created_at desc limit 100) r));
 elsif p_action='pos_quote' then return tlb.pos_quote(p_payload,p_user);
 elsif p_action='pos_save_event' then
  perform tlb.assert_staff(p_user,true);
  eid:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  select * into e from tlb.pos_events where id=eid for update;
  if found then
   perform tlb.require((p_payload->>'revision')::integer=e.revision,'This event changed. Refresh before saving.');
   old_event:=tlb.pos_event_json(eid);
  end if;
  perform tlb.require(length(trim(coalesce(p_payload->>'name',''))) between 1 and 120,'Enter the event name.');
  perform tlb.require((p_payload->>'ends_on')::date>=(p_payload->>'starts_on')::date,'Event end date must be on or after its start date.');
  perform tlb.require(jsonb_typeof(p_payload->'stock')='array' and jsonb_array_length(p_payload->'stock')<=500,'Use up to 500 event products.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements(p_payload->'stock') v group by v->>'product_id' having count(*)>1),'Add each product to event stock only once.');
  insert into tlb.pos_events(id,name,location,starts_on,ends_on,closed,created_by)
  values(eid,trim(p_payload->>'name'),coalesce(p_payload->>'location',''),(p_payload->>'starts_on')::date,(p_payload->>'ends_on')::date,coalesce((p_payload->>'closed')::boolean,false),p_user)
  on conflict(id) do update set name=excluded.name,location=excluded.location,starts_on=excluded.starts_on,ends_on=excluded.ends_on,closed=excluded.closed,revision=tlb.pos_events.revision+1;
  -- Omitted products are hidden, not deleted: historic stock allocations remain valid.
  update tlb.pos_stock set active=false where event_id=eid;
  for x in select value from jsonb_array_elements(p_payload->'stock') loop
   pid:=(x->>'product_id')::uuid;
   perform tlb.require(exists(select 1 from tlb.products where id=pid),'Event product not found.');
   cap:=tlb.pos_integer(x->'capacity',100000,'Enter a whole event stock count.');
   price:=tlb.pos_integer(x->'price_cents',100000000,'Enter a valid event price.');
   select coalesce(sum(quantity),0) into used from tlb.pos_allocations where event_id=eid and product_id=pid;
   perform tlb.require(cap>=used,'Event stock cannot be below units already sold or retained.');
   insert into tlb.pos_stock(event_id,product_id,capacity,price_cents,active) values(eid,pid,cap,price,coalesce((x->>'active')::boolean,true))
   on conflict(event_id,product_id) do update set capacity=excluded.capacity,price_cents=excluded.price_cents,active=excluded.active;
  end loop;
  row_data:=tlb.pos_event_json(eid);
  insert into tlb.pos_event_audit(event_id,actor,before_data,after_data) values(eid,p_user,old_event,row_data);
  return row_data;
 elsif p_action='pos_create_order' then
  v_key:=(p_payload->>'idempotency_key')::uuid;
  perform tlb.require(v_key is not null,'A unique submission key is required.');
  hashed:=encode(extensions.digest((p_payload-'idempotency_key')::text||p_user::text,'sha256'),'hex');
  select * into o from tlb.orders where idempotency_key=v_key;
  if found then
   perform tlb.require(o.request_hash=hashed,'This submission key belongs to a different sale.');
   return tlb.order_json(o.id,true,true);
  end if;
  q:=tlb.pos_quote(p_payload,p_user);
  perform tlb.require(p_payload->'expected_quote'=q,'Review the latest prices and stock before confirming this order.');
  v_email:=lower(trim(coalesce(p_payload#>>'{buyer,email}','')));
  notify:=coalesce((p_payload->>'email_notifications')::boolean,false);
  perform tlb.require(v_email='' or (length(v_email)<=254 and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),'Enter a valid customer email.');
  perform tlb.require(not notify or v_email<>'','Enter an email address to send confirmations.');
  perform tlb.require(length(coalesce(p_payload#>>'{buyer,name}',''))<=200 and length(coalesce(p_payload#>>'{buyer,phone}',''))<=40,'Customer contact details are too long.');
  select data into s from tlb.settings where id;
  oid:=gen_random_uuid(); token:=encode(extensions.gen_random_bytes(32),'hex');
  row_data:=q||jsonb_build_object('buyer',jsonb_build_object('name',coalesce(trim(p_payload#>>'{buyer,name}'),''),'email',v_email,'phone',left(coalesce(p_payload#>>'{buyer,phone}',''),40),'social_platform',left(coalesce(p_payload#>>'{buyer,social_platform}',''),40),'social_username',left(coalesce(p_payload#>>'{buyer,social_username}',''),100)),
   'recipient',jsonb_build_object('name',left(coalesce(p_payload#>>'{recipient,name}',''),200),'phone',left(coalesce(p_payload#>>'{recipient,phone}',''),40)),'address',jsonb_build_object('line1',left(coalesce(p_payload#>>'{address,line1}',''),1000)),'instructions',left(coalesce(p_payload->>'instructions',''),2000),
   'email_notifications',notify,'created_by',p_user,'discount',p_payload->'discount','override_dates',coalesce((p_payload->>'override_dates')::boolean,false),'override_reason',left(coalesce(p_payload->>'override_reason',''),500),
   'payment_options',tlb.active_payment_options(s->'payment_options'),'payment_note',s->>'payment_note','payment_instructions',s->>'payment_instructions',
   'pickup_address',s->>'pickup_address','pickup_hours',s->>'pickup_hours','pickup_instructions',s->>'pickup_instructions','delivery_window',s->>'delivery_window','contact_email',s->>'contact_email','contact_phone',s->>'contact_phone',
   'event_name',(select name from tlb.pos_events where id=(q->>'event_id')::uuid),'event_location',(select location from tlb.pos_events where id=(q->>'event_id')::uuid));
  insert into tlb.orders(id,reference,access_digest,access_encrypted,payment_deadline,fulfillment_date,method,data,idempotency_key,request_hash,source,pos_event_id)
  values(oid,'TLB-'||upper(substr(replace(oid::text,'-',''),1,10)),extensions.digest(token,'sha256'),extensions.pgp_sym_encrypt(token,(select token_key from tlb.secrets where id)),
   case when q->>'source'='popup' then clock_timestamp() else null end,(q->>'fulfillment_date')::date,q->>'method',row_data,v_key,hashed,q->>'source',(q->>'event_id')::uuid);
  if q->>'source'='popup' then
   insert into tlb.pos_allocations(order_id,event_id,product_id,quantity)
   select oid,(q->>'event_id')::uuid,(v->>'product_id')::uuid,sum((v->>'quantity')::integer) from jsonb_array_elements(q->'items') v group by v->>'product_id';
   perform tlb.require(jsonb_typeof(p_payload->'payment')='object','Record full payment for this pop-up sale.');
  else
   insert into tlb.allocations(order_id,product_id,date,quantity,state)
   select oid,(v->>'product_id')::uuid,(q->>'fulfillment_date')::date,sum((v->>'quantity')::integer),'held' from jsonb_array_elements(q->'items') v where v->>'product_id' is not null group by v->>'product_id';
  end if;
  if jsonb_typeof(p_payload->'payment')='object' then perform tlb.pos_receive_payment(oid,p_user,p_payload->'payment'); end if;
  perform tlb.audit(oid,p_user,'pos_order_created',null,null,tlb.order_json(oid,true,false)-'history');
  perform tlb.queue_email(oid,case when q->>'source'='popup' then 'pos_receipt' when jsonb_typeof(p_payload->'payment')='object' then 'payment_approved' else 'order_submitted' end,'pos-created:'||oid);
  return tlb.order_json(oid,true,true);
 end if;
 perform tlb.require(p_action in ('pos_payment','pos_void_sale','pos_order_link','pos_update_details'),'Unknown POS action.');
 select * into o from tlb.orders where id=(p_payload->>'order_id')::uuid for update;
 perform tlb.require(o.id is not null and o.source<>'website','POS order not found.');
 if p_action='pos_order_link' then return tlb.order_json(o.id,true,true); end if;
 v_key:=(p_payload->>'idempotency_key')::uuid;
 perform tlb.require(v_key is not null,'A unique action key is required.');
 hashed:=encode(extensions.digest((p_payload-'revision')::text,'sha256'),'hex');
 select * into prior from tlb.action_keys where user_id=p_user and action=p_action and key=v_key;
 if found then
  perform tlb.require(prior.order_id=o.id and prior.request_hash=hashed,'This action key belongs to a different request.');
  return tlb.order_json(o.id,true,true);
 end if;
 perform tlb.require((p_payload->>'revision')::integer=o.revision,'This order changed. Refresh before saving.');
 before_order:=tlb.order_json(o.id,true,false)-'history';
 if p_action='pos_payment' then
  perform tlb.pos_receive_payment(o.id,p_user,p_payload->'payment');
  perform tlb.queue_email(o.id,'payment_approved','pos-paid:'||o.id);
 elsif p_action='pos_update_details' then
  v_email:=lower(trim(coalesce(p_payload#>>'{buyer,email}','')));
  notify:=coalesce((p_payload->>'email_notifications')::boolean,false);
  perform tlb.require(v_email='' or (length(v_email)<=254 and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),'Enter a valid client email.');
  perform tlb.require(not notify or v_email<>'','Enter an email address to send confirmations.');
  perform tlb.require(length(coalesce(p_payload#>>'{buyer,name}',''))<=200 and length(coalesce(p_payload#>>'{buyer,phone}',''))<=40 and length(coalesce(p_payload#>>'{buyer,social_platform}',''))<=40 and length(coalesce(p_payload#>>'{buyer,social_username}',''))<=100,'Client details are too long.');
  perform tlb.require(length(coalesce(p_payload#>>'{recipient,name}',''))<=200 and length(coalesce(p_payload#>>'{recipient,phone}',''))<=40 and length(coalesce(p_payload#>>'{address,line1}',''))<=1000,'Delivery details are too long.');
  row_data:=jsonb_build_object('buyer',jsonb_build_object('name',coalesce(p_payload#>>'{buyer,name}',''),'email',v_email,'phone',coalesce(p_payload#>>'{buyer,phone}',''),'social_platform',coalesce(p_payload#>>'{buyer,social_platform}',''),'social_username',coalesce(p_payload#>>'{buyer,social_username}','')),
   'recipient',jsonb_build_object('name',coalesce(p_payload#>>'{recipient,name}',''),'phone',coalesce(p_payload#>>'{recipient,phone}','')),'address',jsonb_build_object('line1',coalesce(p_payload#>>'{address,line1}','')),'instructions',left(coalesce(p_payload->>'instructions',''),2000),'email_notifications',notify);
  update tlb.orders set data=data||row_data,revision=revision+1 where id=o.id;
  -- Replace only notifications that have never been attempted. A provider
  -- retry with an uncertain outcome must retain its original saved payload.
  update tlb.outbox set status='skipped',last_error='Superseded by updated POS client details.'
   where order_id=o.id and status='pending' and attempts=0 and first_attempt_at is null and event_type<>'order_review_required';
  perform tlb.queue_email(o.id,case when o.fulfillment_status='cancelled' then 'order_cancelled' when o.source='popup' then 'pos_receipt' when o.payment_status='awaiting_payment' then 'order_submitted' else 'order_amended' end,'pos-details:'||o.id||':'||(o.revision+1));
 else
  perform tlb.assert_staff(p_user,true);
  reason:=trim(p_payload->>'reason');
  perform tlb.require(o.source='popup' and o.fulfillment_status='completed','Only a completed pop-up sale can be voided here.');
  perform tlb.require(length(reason) between 3 and 500,'Enter a reason for voiding this sale.');
  perform tlb.require(jsonb_typeof(p_payload->'restore_stock')='boolean','Choose whether to return these items to event stock.');
  update tlb.orders set fulfillment_status='cancelled',revision=revision+1 where id=o.id;
  if (p_payload->>'restore_stock')::boolean then delete from tlb.pos_allocations where order_id=o.id; end if;
  perform tlb.queue_email(o.id,'order_cancelled','pos-void:'||o.id);
 end if;
 perform tlb.audit(o.id,p_user,p_action,reason,before_order,tlb.order_json(o.id,true,false)-'history');
 insert into tlb.action_keys(user_id,action,key,order_id,request_hash) values(p_user,p_action,v_key,o.id,hashed);
 return tlb.order_json(o.id,true,true);
end $$;

-- Guarded patches keep every unrelated checkout and order-management rule intact.
do $$
declare def text; patch record;
begin
 for patch in select * from (values
  ('public.shop_api(text,jsonb,text)',
   ' if p_action=''catalog'' then',
   ' if left(p_action,4)=''pos_'' then return tlb.pos_api(u,p_action,p_payload); end if; if p_action=''catalog'' then'),
  ('public.shop_api(text,jsonb,text)',
   ' elsif p_action in (''edit_order'',''preview_edit_order'') then',
   ' elsif p_action in (''edit_order'',''preview_edit_order'') then perform tlb.require(o.source=''website'',''POS orders keep their saved prices. Cancel and recreate an unpaid DM order to change its items, or add a staff note.'');'),
  ('public.shop_service(text,jsonb)',
   'clock_timestamp()<o.payment_deadline',
   '(clock_timestamp()<o.payment_deadline or (o.source=''direct_message'' and o.payment_deadline is null))'),
  ('tlb.queue_email(uuid,text,text,date,jsonb)',
   ' select * into strict o from tlb.orders where id=p_id;',
   ' select * into strict o from tlb.orders where id=p_id; if o.source<>''website'' and not coalesce((o.data->>''email_notifications'')::boolean,false) then return; end if;'),
  ('tlb.order_json(uuid,boolean,boolean)',
   ' select * into strict o from tlb.orders where id=p_id;',
   ' select * into strict o from tlb.orders where id=p_id; if not coalesce(p_private,false) then o.data:=o.data-''created_by''-''override_reason''-''override_dates''; end if;'),
  ('tlb.delete_product(jsonb)',
   'not exists(select 1 from tlb.allocations a where a.product_id=p.id)',
   'not exists(select 1 from tlb.pos_stock ps where ps.product_id=p.id) and not exists(select 1 from tlb.allocations a where a.product_id=p.id)'),
  ('tlb.accounting_api(uuid,text,jsonb)',
   'method_value in ('''',''gcash'',''cash'',''bank_transfer'')',
   'method_value in ('''',''gcash'',''cash'',''bdo'',''eastwest'',''bank_transfer'')')
 ) p(signature,old_text,new_text) loop
  def:=pg_get_functiondef(patch.signature::regprocedure);
  perform tlb.require(position(patch.old_text in def)>0,'POS migration marker missing: '||patch.signature);
  execute replace(def,patch.old_text,patch.new_text);
 end loop;
end $$;

insert into tlb.accounting_categories(name,kind,system_key) values('Pop-up sales','sale','pos_popup'),('Direct message sales','sale','pos_direct_message');
alter table tlb.accounting_entries drop constraint accounting_entries_payment_method_check;
alter table tlb.accounting_entries add constraint accounting_entries_payment_method_check check(payment_method in ('','gcash','cash','bdo','eastwest','bank_transfer'));
do $$ declare def text; old_text text:='(''website'',sales-s.sales_cents)'; begin
 def:=pg_get_functiondef('tlb.accounting_sync_order(uuid,jsonb,timestamptz,boolean)'::regprocedure);
 perform tlb.require(position(old_text in def)>0,'POS accounting marker missing.');
 execute replace(def,old_text,'(case p_snapshot->>''source'' when ''popup'' then ''pos_popup'' when ''direct_message'' then ''pos_direct_message'' else ''website'' end,sales-s.sales_cents)');
 def:=pg_get_functiondef('tlb.accounting_rows_v2(date,date)'::regprocedure);
 perform tlb.require(position('''Website'',l.order_id' in def)>0,'POS accounting report marker missing.');
 def:=replace(def,'''Website'',l.order_id','case o.source when ''popup'' then ''Pop-up'' when ''direct_message'' then ''Direct message'' else ''Website'' end,l.order_id');
 def:=replace(def,'c.kind,''''::text,''''::text','c.kind,case when o.source<>''website'' then coalesce(o.data#>>''{buyer,name}'','''') else '''' end,case when o.source<>''website'' then coalesce(o.data->>''payment_method'','''') else '''' end');
 execute def;
end $$;

revoke all on function tlb.pos_integer(jsonb,bigint,text),tlb.pos_event_json(uuid),tlb.pos_quote(jsonb,uuid,uuid),tlb.pos_receive_payment(uuid,uuid,jsonb),tlb.pos_api(uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
