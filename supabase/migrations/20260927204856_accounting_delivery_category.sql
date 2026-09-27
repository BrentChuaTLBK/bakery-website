begin;
set local lock_timeout = '3s';
-- Keep the fee category's stable ID and internal system key so existing order
-- posting and reversal logic continues to write exactly the same ledger rows.
-- The former cost category remains an alias for historical references.
lock table tlb.accounting_categories in share row exclusive mode;
do $$
declare delivery_id uuid; alias record;
begin
 select id into delivery_id from tlb.accounting_categories where system_key='delivery_fee';
 perform tlb.require(delivery_id is not null,'The automatic delivery category is missing.');
 for alias in select id from tlb.accounting_categories
  where id<>delivery_id and merged_into is null
   and (system_key='delivery_cost' or lower(trim(name))='delivery')
 loop
  -- Every manual entry already owns its sale/expense type. Retain that type,
  -- amount, date and audit snapshots when merging an existing manual Delivery.
  update tlb.accounting_entries set category_id=delivery_id,revision=revision+1 where category_id=alias.id;
  update tlb.accounting_categories set merged_into=delivery_id,archived=true,revision=revision+1 where id=alias.id;
 end loop;
 update tlb.accounting_categories set name='Delivery',archived=false,revision=revision+1
  where id=delivery_id and (name<>'Delivery' or archived);
end $$;

create or replace function tlb.accounting_rows_v2(p_start date,p_end date)
returns table(id uuid,entry_date date,category_id uuid,amount_cents bigint,note text,source text,order_id uuid,reference text,revision integer,kind text,client_name text,payment_method text)
language sql stable security invoker set search_path='' as $$
 select l.id,l.entry_date,coalesce(c.merged_into,c.id),l.amount_cents,l.note,'Website',l.order_id,o.reference,null::integer,c.kind,''::text,''::text
 from tlb.accounting_ledger l join tlb.orders o on o.id=l.order_id join tlb.accounting_categories c on c.id=l.category_id
 where l.entry_date between p_start and p_end and tlb.accounting_order_included(o)
 union all
 select e.id,e.entry_date,e.category_id,e.amount_cents,e.note,'Manual',null::uuid,null::text,e.revision,e.kind,e.client_name,e.payment_method
 from tlb.accounting_entries e where e.deleted_at is null and e.entry_date between p_start and p_end
 union all
 select d.order_id,d.cost_date,coalesce(c.merged_into,c.id),d.amount_cents,d.note,'Delivery cost',d.order_id,o.reference,d.revision,'expense','',''
 from tlb.accounting_delivery_costs d join tlb.orders o on o.id=d.order_id
 cross join tlb.accounting_categories c where c.system_key='delivery_cost' and d.amount_cents is not null
  and d.cost_date between p_start and p_end and tlb.accounting_order_included(o)
$$;
revoke all on function tlb.accounting_rows_v2(date,date) from public,anon,authenticated,service_role;

-- Delivery also accepts manual income/expenses; other automatic categories
-- remain protected. The Delivery category itself cannot be renamed or archived.
do $$
declare definition text; old_text text:='cat.id is not null and cat.system_key is null and cat.merged_into is null and (not cat.archived or e.category_id=cat.id)';
 new_text text;
begin
 new_text:='('||old_text||') or (cat.id is not null and cat.system_key=''delivery_fee'' and cat.merged_into is null and not cat.archived)';
 definition:=pg_get_functiondef('tlb.accounting_api(uuid,text,jsonb)'::regprocedure);
 if position(new_text in definition)=0 then
  perform tlb.require(position(old_text in definition)>0,'Delivery accounting migration marker missing.');
  execute replace(definition,old_text,new_text);
 end if;
end $$;
revoke all on function tlb.accounting_api(uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
