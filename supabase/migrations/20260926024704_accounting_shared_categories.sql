begin;
-- Preserve the original category type for compatibility with older saved forms.
-- New manual entries own their type; manual categories are shared by both types.
alter table tlb.accounting_entries add column if not exists kind text check(kind in ('sale','expense'));
update tlb.accounting_entries e set kind=c.kind from tlb.accounting_categories c where c.id=e.category_id and e.kind is null;
alter table tlb.accounting_entries alter column kind set not null;
alter table tlb.accounting_categories add column if not exists merged_into uuid references tlb.accounting_categories(id);
create index if not exists accounting_category_merged_into on tlb.accounting_categories(merged_into) where merged_into is not null;

-- Retain duplicate category records and old audit snapshots. Entries are moved
-- only after their original sale/expense type has been copied onto each entry.
do $$ declare duplicate record; begin
 for duplicate in
  select id,first_value(id) over(partition by lower(trim(name)) order by archived,case kind when 'sale' then 0 else 1 end,id) canonical
  from tlb.accounting_categories where system_key is null and merged_into is null
 loop
  if duplicate.id<>duplicate.canonical then
   update tlb.accounting_entries set category_id=duplicate.canonical,revision=revision+1 where category_id=duplicate.id;
   update tlb.accounting_categories set merged_into=duplicate.canonical,archived=true,revision=revision+1 where id=duplicate.id;
  end if;
 end loop;
end $$;
-- Merged aliases must not reserve an old name after the shared category is renamed.
drop index if exists tlb.accounting_category_name;
create unique index if not exists accounting_shared_category_name on tlb.accounting_categories(lower(trim(name))) where merged_into is null;

create or replace function tlb.accounting_rows_v2(p_start date,p_end date)
returns table(id uuid,entry_date date,category_id uuid,amount_cents bigint,note text,source text,order_id uuid,reference text,revision integer,kind text,client_name text,payment_method text)
language sql stable security invoker set search_path='' as $$
 select l.id,l.entry_date,l.category_id,l.amount_cents,l.note,'Website',l.order_id,o.reference,null::integer,c.kind,''::text,''::text
 from tlb.accounting_ledger l join tlb.orders o on o.id=l.order_id join tlb.accounting_categories c on c.id=l.category_id
 where l.entry_date between p_start and p_end and tlb.accounting_order_included(o)
 union all
 select e.id,e.entry_date,e.category_id,e.amount_cents,e.note,'Manual',null::uuid,null::text,e.revision,e.kind,e.client_name,e.payment_method
 from tlb.accounting_entries e where e.deleted_at is null and e.entry_date between p_start and p_end
 union all
 select d.order_id,d.cost_date,c.id,d.amount_cents,d.note,'Delivery cost',d.order_id,o.reference,d.revision,'expense','',''
 from tlb.accounting_delivery_costs d join tlb.orders o on o.id=d.order_id
 cross join tlb.accounting_categories c where c.system_key='delivery_cost' and d.amount_cents is not null
  and d.cost_date between p_start and p_end and tlb.accounting_order_included(o)
$$;
revoke all on function tlb.accounting_rows_v2(date,date) from public,anon,authenticated,service_role;

create or replace function tlb.accounting_report_v2(p_user uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare start_date date;end_date date;entries jsonb;categories jsonb;reports jsonb;deliveries jsonb;
begin
 perform tlb.assert_staff(p_user,true);
 -- Never let an old tab misclassify a shared category using its old fixed type.
 perform tlb.require(p_payload->>'report_version'='2','Accounting has been updated. Refresh the website to load shared categories.');
 start_date:=(p_payload->>'start')::date;end_date:=(p_payload->>'end')::date;
 perform tlb.require(start_date is not null and end_date is not null and start_date<=end_date,'Choose a valid start and end date.');
 select coalesce(jsonb_agg(to_jsonb(c)-'kind' order by c.name,c.id),'[]') into categories from tlb.accounting_categories c where c.merged_into is null;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.entry_date,r.source,r.id),'[]') into entries from tlb.accounting_rows_v2(start_date,end_date) r;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into reports from (
  select c.id,c.name,coalesce(sum(r.amount_cents) filter(where r.kind='sale'),0) sales_cents,
   coalesce(sum(r.amount_cents) filter(where r.kind='expense'),0) expense_cents,count(r.id)::int entry_count
  from tlb.accounting_categories c left join tlb.accounting_rows_v2(start_date,end_date) r on r.category_id=c.id
  where c.merged_into is null group by c.id having not c.archived or count(r.id)>0
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('order_id',ord.id,'reference',ord.reference,
  'approval_date',(p.approved_at at time zone 'Asia/Manila')::date,'fee_cents',s.delivery_cents,
  'cost_cents',dc.amount_cents,'cost_date',dc.cost_date,'revision',coalesce(dc.revision,0),
  'status',ord.fulfillment_status,'refund_label',ord.refund_label) order by p.approved_at,ord.reference),'[]') into deliveries
 from tlb.orders ord join tlb.payments p on p.order_id=ord.id join tlb.accounting_order_state s on s.order_id=ord.id
 left join tlb.accounting_delivery_costs dc on dc.order_id=ord.id
 where tlb.accounting_order_included(ord) and (ord.method='delivery' or dc.amount_cents is not null)
  and (p.approved_at at time zone 'Asia/Manila')::date between start_date and end_date;
 return jsonb_build_object('report_version',2,'start',start_date,'end',end_date,'categories',categories,'entries',entries,'summary',reports,'deliveries',deliveries,
  'legacy_count',(select count(*) from tlb.accounting_order_state legacy join tlb.orders o on o.id=legacy.order_id where legacy.imported_without_history and tlb.accounting_order_included(o)),'generated_at',clock_timestamp());
end $$;
revoke all on function tlb.accounting_report_v2(uuid,jsonb) from public,anon,authenticated,service_role;

do $$ declare definition text; patch record; begin
 definition:=pg_get_functiondef('tlb.accounting_api(uuid,text,jsonb)'::regprocedure);
 for patch in select * from (values
  ('client_value text; method_value text; val bigint;','client_value text; method_value text; entry_kind text; val bigint;'),
  ($old$if p_action='accounting_report' then$old$,$new$if p_action='accounting_report' then return tlb.accounting_report_v2(p_user,p_payload);$new$),
  ($old$perform tlb.require(cat.system_key is null,'Automatic categories cannot be edited.');$old$,
   $new$perform tlb.require(cat.system_key is null,'Automatic categories cannot be edited.');
   perform tlb.require(cat.merged_into is null,'This category was combined. Refresh before editing.');$new$),
  ($old$length(trim(p_payload->>'name')) between 1 and 80 and p_payload->>'kind' in ('sale','expense'),'Enter a category name and type.'$old$,
   $new$length(trim(p_payload->>'name')) between 1 and 80,'Enter a category name.'$new$),
  ($old$and cat.kind=p_payload->>'kind' and cat.archived$old$,$new$and /* shared category */ cat.archived$new$),
  ($old$perform tlb.require(cat.id is null or cat.kind=p_payload->>'kind','An existing category cannot change between sales and expenses.');$old$,
   $new$-- Category type is chosen on each entry.$new$),
  ($old$where id<>target and kind=p_payload->>'kind' and lower(trim(name))$old$,
   $new$where id<>target and merged_into is null and lower(trim(name))$new$),
  ($old$values(target,trim(p_payload->>'name'),p_payload->>'kind',coalesce((p_payload->>'archived')::boolean,false))$old$,
   $new$values(target,trim(p_payload->>'name'),coalesce(p_payload->>'kind','sale'),coalesce((p_payload->>'archived')::boolean,false))$new$),
  ($old$cat.id is not null and cat.system_key is null and not cat.archived$old$,
   $new$cat.id is not null and cat.system_key is null and cat.merged_into is null and (not cat.archived or e.category_id=cat.id)$new$),
  ($old$perform tlb.require(e.deleted_at is null,'This entry has been removed.');$old$,
   $new$entry_kind:=case when p_payload ? 'kind' then p_payload->>'kind' else coalesce(e.kind,cat.kind) end;
   perform tlb.require(entry_kind in ('sale','expense'),'Choose Sales / income or Expense.');
   perform tlb.require(e.deleted_at is null,'This entry has been removed.');$new$),
  ($old$(e.entry_date,e.category_id,e.amount_cents,e.note,e.client_name,e.payment_method) is not distinct from (date_value,category_uuid,val,note_value,client_value,method_value)$old$,
   $new$(e.entry_date,e.category_id,e.amount_cents,e.note,e.client_name,e.payment_method,e.kind) is not distinct from (date_value,category_uuid,val,note_value,client_value,method_value,entry_kind)$new$),
  ($old$insert into tlb.accounting_entries(id,entry_date,category_id,amount_cents,note,client_name,payment_method) values(target,date_value,category_uuid,val,note_value,client_value,method_value)$old$,
   $new$insert into tlb.accounting_entries(id,entry_date,category_id,amount_cents,note,client_name,payment_method,kind) values(target,date_value,category_uuid,val,note_value,client_value,method_value,entry_kind)$new$),
  ($old$payment_method=excluded.payment_method,revision=tlb.accounting_entries.revision+1$old$,
   $new$payment_method=excluded.payment_method,kind=excluded.kind,revision=tlb.accounting_entries.revision+1$new$)
 ) changes(old_text,new_text) loop
  if position(patch.new_text in definition)=0 then
   perform tlb.require(position(patch.old_text in definition)>0,'Shared accounting migration marker missing.');
   definition:=replace(definition,patch.old_text,patch.new_text);
  end if;
 end loop;
 execute definition;
end $$;
revoke all on function tlb.accounting_api(uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
