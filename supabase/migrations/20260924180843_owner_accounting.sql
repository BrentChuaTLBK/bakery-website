begin;

create table if not exists tlb.accounting_categories (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 80),
 kind text not null check(kind in ('sale','expense')), system_key text unique,
 revision integer not null default 1, archived boolean not null default false
);
create unique index if not exists accounting_category_name on tlb.accounting_categories(kind,lower(trim(name)));
insert into tlb.accounting_categories(name,kind,system_key) values
 ('Website sales','sale','website'),('Discounts','expense','discount'),
 ('Delivery fees','sale','delivery_fee'),('Delivery costs','expense','delivery_cost')
 on conflict(system_key) do nothing;
insert into tlb.accounting_categories(name,kind) values ('Custom cakes','sale'),('Pastries','sale'),('Nori','sale')
 on conflict(kind,lower(trim(name))) do nothing;

create table if not exists tlb.accounting_entries (
 id uuid primary key, entry_date date not null, category_id uuid not null references tlb.accounting_categories(id),
 amount_cents bigint not null check(amount_cents between 1 and 999999999), note text not null default '' check(length(note)<=2000),
 revision integer not null default 1, deleted_at timestamptz, created_at timestamptz not null default clock_timestamp()
);
create index if not exists accounting_entries_date on tlb.accounting_entries(entry_date,category_id) where deleted_at is null;
create index if not exists accounting_entries_category on tlb.accounting_entries(category_id);
create table if not exists tlb.accounting_delivery_costs (
 order_id uuid primary key references tlb.orders(id), cost_date date not null,
 amount_cents bigint check(amount_cents between 0 and 999999999), note text not null default '' check(length(note)<=2000),
 revision integer not null default 1, updated_at timestamptz not null default clock_timestamp()
);
create index if not exists accounting_delivery_date on tlb.accounting_delivery_costs(cost_date);
create table if not exists tlb.accounting_order_state (
 order_id uuid primary key references tlb.orders(id), approved_at timestamptz not null,
 sales_cents bigint not null default 0, discount_cents bigint not null default 0,
 delivery_cents bigint not null default 0, version integer not null default 0,
 imported_without_history boolean not null default false
);
create table if not exists tlb.accounting_ledger (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references tlb.orders(id),
 category_id uuid not null references tlb.accounting_categories(id), entry_date date not null,
 amount_cents bigint not null check(amount_cents<>0), note text not null,
 version integer not null, created_at timestamptz not null default clock_timestamp(),
 unique(order_id,version,category_id)
);
create index if not exists accounting_ledger_date on tlb.accounting_ledger(entry_date,category_id);
create index if not exists accounting_ledger_category on tlb.accounting_ledger(category_id);
create table if not exists tlb.accounting_audit (
 id bigint generated always as identity primary key, target_id uuid not null, actor uuid not null,
 at timestamptz not null default clock_timestamp(), action text not null, before_data jsonb, after_data jsonb
);
create index if not exists accounting_audit_target on tlb.accounting_audit(target_id,id);
do $$ declare t text; begin
 foreach t in array array['accounting_categories','accounting_entries','accounting_delivery_costs','accounting_order_state','accounting_ledger','accounting_audit'] loop
  execute format('alter table tlb.%I enable row level security',t);
  execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on sequence tlb.accounting_audit_id_seq from public,anon,authenticated,service_role;

-- Append only the difference from the previously recorded order amounts. This
-- leaves the approval date intact and books later changes/reversals on their date.
create or replace function tlb.accounting_sync_order(p_id uuid,p_snapshot jsonb,p_at timestamptz,p_legacy boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare s tlb.accounting_order_state; approved timestamptz; eligible boolean;
 sales bigint:=0; discount bigint:=0; delivery bigint:=0; booking date; label text;
begin
 select approved_at into approved from tlb.payments where order_id=p_id;
 if approved is null then return; end if;
 insert into tlb.accounting_order_state(order_id,approved_at,imported_without_history)
 values(p_id,approved,p_legacy) on conflict(order_id) do nothing;
 select * into strict s from tlb.accounting_order_state where order_id=p_id for update;
 eligible:=p_snapshot->>'payment_status'='paid'
  and coalesce(p_snapshot->>'fulfillment_status','') not in ('cancelled','expired','refunded')
  and not coalesce((p_snapshot->>'refund_label')::boolean,false);
 if eligible then
  sales:=coalesce((p_snapshot->>'subtotal_cents')::bigint,0);
  discount:=coalesce((p_snapshot->>'discount_cents')::bigint,0);
  delivery:=coalesce((p_snapshot->>'delivery_cents')::bigint,0);
 end if;
 if (sales,discount,delivery) is not distinct from (s.sales_cents,s.discount_cents,s.delivery_cents) then return; end if;
 booking:=(case when s.version=0 then approved else p_at end at time zone 'Asia/Manila')::date;
 label:=case when s.version=0 then 'Payment approved' when not eligible then 'Order cancelled or refunded: reversal' else 'Paid order adjustment' end;
 if p_legacy then label:='Imported paid order (current saved amounts)'; end if;
 insert into tlb.accounting_ledger(order_id,category_id,entry_date,amount_cents,note,version)
 select p_id,c.id,booking,v.delta,label,s.version+1
 from (values ('website',sales-s.sales_cents),('discount',discount-s.discount_cents),('delivery_fee',delivery-s.delivery_cents)) v(key,delta)
 join tlb.accounting_categories c on c.system_key=v.key where v.delta<>0;
 update tlb.accounting_order_state set sales_cents=sales,discount_cents=discount,delivery_cents=delivery,version=s.version+1 where order_id=p_id;
end $$;
revoke all on function tlb.accounting_sync_order(uuid,jsonb,timestamptz,boolean) from public,anon,authenticated,service_role;

-- Import existing histories once, in order, so old adjustments retain their dates.
do $$ declare o record; h record; found_history boolean; snapshot jsonb; begin
 for o in select r.*,p.approved_at from tlb.orders r join tlb.payments p on p.order_id=r.id
  where not exists(select 1 from tlb.accounting_order_state s where s.order_id=r.id) loop
  found_history:=false;
  for h in select * from tlb.history where order_id=o.id and after_data->>'payment_status'='paid' order by at,id loop
   perform tlb.accounting_sync_order(o.id,h.after_data,h.at); found_history:=true;
  end loop;
  snapshot:=o.data||jsonb_build_object('payment_status',o.payment_status,'fulfillment_status',o.fulfillment_status,'refund_label',o.refund_label);
  perform tlb.accounting_sync_order(o.id,snapshot,clock_timestamp(),not found_history);
 end loop;
end $$;
create or replace function tlb.accounting_order_changed() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform tlb.accounting_sync_order(new.id,new.data||jsonb_build_object('payment_status',new.payment_status,'fulfillment_status',new.fulfillment_status,'refund_label',new.refund_label),clock_timestamp());
 return new;
end $$;
revoke all on function tlb.accounting_order_changed() from public,anon,authenticated,service_role;
drop trigger if exists accounting_order_changed on tlb.orders;
create trigger accounting_order_changed after insert or update on tlb.orders for each row execute function tlb.accounting_order_changed();

create or replace function tlb.accounting_rows(p_start date,p_end date)
returns table(id uuid,entry_date date,category_id uuid,amount_cents bigint,note text,source text,order_id uuid,reference text,revision integer)
language sql stable security invoker set search_path='' as $$
 select l.id,l.entry_date,l.category_id,l.amount_cents,l.note,'Website',l.order_id,o.reference,null::integer
 from tlb.accounting_ledger l join tlb.orders o on o.id=l.order_id where l.entry_date between p_start and p_end
 union all
 select e.id,e.entry_date,e.category_id,e.amount_cents,e.note,'Manual',null::uuid,null::text,e.revision
 from tlb.accounting_entries e where e.deleted_at is null and e.entry_date between p_start and p_end
 union all
 select d.order_id,d.cost_date,c.id,d.amount_cents,d.note,'Delivery cost',d.order_id,o.reference,d.revision
 from tlb.accounting_delivery_costs d join tlb.orders o on o.id=d.order_id
 cross join tlb.accounting_categories c where c.system_key='delivery_cost' and d.amount_cents is not null and d.cost_date between p_start and p_end
$$;
revoke all on function tlb.accounting_rows(date,date) from public,anon,authenticated,service_role;

create or replace function tlb.accounting_api(p_user uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 start_date date; end_date date; target uuid; cat tlb.accounting_categories; e tlb.accounting_entries;
 d tlb.accounting_delivery_costs; o tlb.orders; before_value jsonb; result jsonb; entries jsonb; categories jsonb;
 reports jsonb; deliveries jsonb; val bigint; note_value text; date_value date; category_uuid uuid;
begin
 perform tlb.assert_staff(p_user,true);
 if p_action='accounting_report' then
  start_date:=(p_payload->>'start')::date; end_date:=(p_payload->>'end')::date;
  perform tlb.require(start_date is not null and end_date is not null and start_date<=end_date,'Choose a valid start and end date.');
  select coalesce(jsonb_agg(to_jsonb(c) order by c.kind,c.system_key nulls last,c.name),'[]') into categories from tlb.accounting_categories c;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.entry_date,r.source,r.id),'[]') into entries from tlb.accounting_rows(start_date,end_date) r;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.kind,x.name),'[]') into reports from (
   select c.id,c.name,c.kind,coalesce(sum(r.amount_cents),0) as amount_cents,count(r.id)::int as entry_count
   from tlb.accounting_categories c left join tlb.accounting_rows(start_date,end_date) r on r.category_id=c.id
   group by c.id having not c.archived or count(r.id)>0
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('order_id',ord.id,'reference',ord.reference,
   'approval_date',(p.approved_at at time zone 'Asia/Manila')::date,'fee_cents',s.delivery_cents,
   'cost_cents',dc.amount_cents,'cost_date',dc.cost_date,'revision',coalesce(dc.revision,0),
   'status',ord.fulfillment_status,'refund_label',ord.refund_label) order by p.approved_at,ord.reference),'[]') into deliveries
  from tlb.orders ord join tlb.payments p on p.order_id=ord.id join tlb.accounting_order_state s on s.order_id=ord.id
  left join tlb.accounting_delivery_costs dc on dc.order_id=ord.id
  where (ord.method='delivery' or dc.amount_cents is not null) and (p.approved_at at time zone 'Asia/Manila')::date between start_date and end_date;
  return jsonb_build_object('start',start_date,'end',end_date,'categories',categories,'entries',entries,'summary',reports,'deliveries',deliveries,
   'legacy_count',(select count(*) from tlb.accounting_order_state where imported_without_history),'generated_at',clock_timestamp());
 elsif p_action='accounting_history' then
  select coalesce(jsonb_agg(jsonb_build_object('at',at,'action',action,'before',before_data,'after',after_data) order by id),'[]') into result
  from tlb.accounting_audit where target_id=(p_payload->>'id')::uuid;
  return result;
 elsif p_action='accounting_get_delivery' then
  select * into o from tlb.orders where id=(p_payload->>'order_id')::uuid;
  perform tlb.require(found,'Order not found.');
  select to_jsonb(x) into result from tlb.accounting_delivery_costs x where order_id=o.id;
  return jsonb_build_object('cost',result,'order_revision',o.revision);
 end if;
 -- Use the same lock ordering as shop mutations, followed by row revisions.
 perform pg_advisory_xact_lock(841721950318::bigint);
 target:=(p_payload->>'id')::uuid;
 if p_action='accounting_save_category' then
  perform tlb.require(target is not null,'A category ID is required.');
  select * into cat from tlb.accounting_categories where id=target for update;
  before_value:=case when found then to_jsonb(cat) end;
  perform tlb.require(cat.system_key is null,'Automatic categories cannot be edited.');
  perform tlb.require(length(trim(p_payload->>'name')) between 1 and 80 and p_payload->>'kind' in ('sale','expense'),'Enter a category name and type.');
  if cat.id is not null and cat.name=trim(p_payload->>'name') and cat.kind=p_payload->>'kind' and cat.archived=coalesce((p_payload->>'archived')::boolean,false) then return to_jsonb(cat); end if;
  perform tlb.require(coalesce(cat.revision,0)=(p_payload->>'revision')::int,'This category changed. Refresh before saving.');
  perform tlb.require(cat.id is null or cat.kind=p_payload->>'kind','An existing category cannot change between sales and expenses.');
  perform tlb.require(not exists(select 1 from tlb.accounting_categories where id<>target and kind=p_payload->>'kind' and lower(trim(name))=lower(trim(p_payload->>'name'))),'A category with this name already exists.');
  insert into tlb.accounting_categories(id,name,kind,archived) values(target,trim(p_payload->>'name'),p_payload->>'kind',coalesce((p_payload->>'archived')::boolean,false))
  on conflict(id) do update set name=excluded.name,archived=excluded.archived,revision=tlb.accounting_categories.revision+1 returning to_jsonb(tlb.accounting_categories.*) into result;
 elsif p_action in ('accounting_save_entry','accounting_delete_entry') then
  perform tlb.require(target is not null,'An entry ID is required.');
  select * into e from tlb.accounting_entries where id=target for update;
  before_value:=case when found then to_jsonb(e) end;
  if p_action='accounting_delete_entry' then
   perform tlb.require(e.id is not null,'Manual entry not found.');
   if e.deleted_at is not null then return to_jsonb(e); end if;
   perform tlb.require(e.revision=(p_payload->>'revision')::int,'This entry changed. Refresh before removing it.');
   update tlb.accounting_entries set deleted_at=clock_timestamp(),revision=revision+1 where id=target returning to_jsonb(tlb.accounting_entries.*) into result;
  else
   val:=(p_payload->>'amount_cents')::bigint; date_value:=(p_payload->>'entry_date')::date;
   category_uuid:=(p_payload->>'category_id')::uuid; note_value:=trim(coalesce(p_payload->>'note',''));
   perform tlb.require(val between 1 and 999999999 and date_value is not null and length(note_value)<=2000,'Enter a date and an amount from 0.01 to 9,999,999.99.');
   select * into cat from tlb.accounting_categories where id=category_uuid;
   perform tlb.require(cat.id is not null and cat.system_key is null and not cat.archived,'Choose an active manual category.');
   perform tlb.require(e.deleted_at is null,'This entry has been removed.');
   if e.id is not null and (e.entry_date,e.category_id,e.amount_cents,e.note) is not distinct from (date_value,category_uuid,val,note_value) then return to_jsonb(e); end if;
   perform tlb.require(coalesce(e.revision,0)=(p_payload->>'revision')::int,'This entry changed. Refresh before saving.');
   insert into tlb.accounting_entries(id,entry_date,category_id,amount_cents,note) values(target,date_value,category_uuid,val,note_value)
   on conflict(id) do update set entry_date=excluded.entry_date,category_id=excluded.category_id,amount_cents=excluded.amount_cents,note=excluded.note,revision=tlb.accounting_entries.revision+1
   returning to_jsonb(tlb.accounting_entries.*) into result;
  end if;
 elsif p_action='accounting_save_delivery' then
  target:=(p_payload->>'order_id')::uuid;
  select * into o from tlb.orders where id=target for update;
  perform tlb.require(found,'Order not found.');
  perform tlb.require(o.revision=(p_payload->>'order_revision')::int,'This order changed. Reopen it before saving the delivery cost.');
  select * into d from tlb.accounting_delivery_costs where order_id=target for update;
  before_value:=case when found then to_jsonb(d) end;
  val:=(p_payload->>'amount_cents')::bigint; date_value:=(p_payload->>'cost_date')::date; note_value:=trim(coalesce(p_payload->>'note',''));
  perform tlb.require((val is null or val between 0 and 999999999) and date_value is not null and length(note_value)<=2000,'Enter a cost date and a valid delivery cost. Leave the amount blank if unknown.');
  if d.order_id is not null and (d.amount_cents,d.cost_date,d.note) is not distinct from (val,date_value,note_value) then return to_jsonb(d); end if;
  perform tlb.require(coalesce(d.revision,0)=(p_payload->>'revision')::int,'The delivery cost changed. Refresh before saving.');
  insert into tlb.accounting_delivery_costs(order_id,cost_date,amount_cents,note) values(target,date_value,val,note_value)
  on conflict(order_id) do update set cost_date=excluded.cost_date,amount_cents=excluded.amount_cents,note=excluded.note,revision=tlb.accounting_delivery_costs.revision+1,updated_at=clock_timestamp()
  returning to_jsonb(tlb.accounting_delivery_costs.*) into result;
 else raise exception 'Unknown accounting action.' using errcode='22023';
 end if;
 insert into tlb.accounting_audit(target_id,actor,action,before_data,after_data) values(target,p_user,p_action,before_value,result);
 return result;
end $$;
revoke all on function tlb.accounting_api(uuid,text,jsonb) from public,anon,authenticated,service_role;

-- Owner-only operations stay behind the existing authenticated shop dispatcher.
do $$ declare definition text; marker text:=' -- Remaining actions operate on one existing order and use a revision plus retry key.'; replacement text;
begin
 definition:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 if position('return tlb.accounting_api(u,p_action,p_payload);' in definition)=0 then
  perform tlb.require(position(marker in definition)>0,'Accounting dispatcher marker missing.');
  replacement:=E' if left(p_action,11)=''accounting_'' then\n  return tlb.accounting_api(u,p_action,p_payload);\n end if;\n'||marker;
  if position(E'\r\n' in definition)>0 then replacement:=replace(replacement,E'\n',E'\r\n'); end if;
  execute replace(definition,marker,replacement);
 end if;
end $$;
commit;
