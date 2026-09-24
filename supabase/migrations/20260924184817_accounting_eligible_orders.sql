begin;

-- One eligibility rule for website entries, courier expenses and comparisons.
-- Reports reflect the current order status, even when an earlier date is selected.
create or replace function tlb.accounting_order_included(p_order tlb.orders)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce((p_order).payment_status='paid' and not (p_order).refund_label
  and (p_order).fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed'),false)
$$;
revoke all on function tlb.accounting_order_included(tlb.orders) from public,anon,authenticated,service_role;

create or replace function tlb.accounting_rows(p_start date,p_end date)
returns table(id uuid,entry_date date,category_id uuid,amount_cents bigint,note text,source text,order_id uuid,reference text,revision integer)
language sql stable security invoker set search_path='' as $$
 select l.id,l.entry_date,l.category_id,l.amount_cents,l.note,'Website',l.order_id,o.reference,null::integer
 from tlb.accounting_ledger l join tlb.orders o on o.id=l.order_id
 where l.entry_date between p_start and p_end and tlb.accounting_order_included(o)
 union all
 select e.id,e.entry_date,e.category_id,e.amount_cents,e.note,'Manual',null::uuid,null::text,e.revision
 from tlb.accounting_entries e where e.deleted_at is null and e.entry_date between p_start and p_end
 union all
 select d.order_id,d.cost_date,c.id,d.amount_cents,d.note,'Delivery cost',d.order_id,o.reference,d.revision
 from tlb.accounting_delivery_costs d join tlb.orders o on o.id=d.order_id
 cross join tlb.accounting_categories c where c.system_key='delivery_cost' and d.amount_cents is not null
  and d.cost_date between p_start and p_end and tlb.accounting_order_included(o)
$$;
revoke all on function tlb.accounting_rows(date,date) from public,anon,authenticated,service_role;

do $$ declare definition text; patch record; begin
 definition:=pg_get_functiondef('tlb.accounting_api(uuid,text,jsonb)'::regprocedure);
 for patch in select * from (values
  ('where (ord.method=''delivery'' or dc.amount_cents is not null) and',
   'where tlb.accounting_order_included(ord) and (ord.method=''delivery'' or dc.amount_cents is not null) and'),
  ('from tlb.accounting_order_state where imported_without_history)',
   'from tlb.accounting_order_state legacy join tlb.orders legacy_order on legacy_order.id=legacy.order_id where legacy.imported_without_history and tlb.accounting_order_included(legacy_order))')
 ) changes(old_text,new_text) loop
  if position(patch.new_text in definition)=0 then
   perform tlb.require(position(patch.old_text in definition)>0,'Accounting eligibility marker missing.');
   definition:=replace(definition,patch.old_text,patch.new_text);
  end if;
 end loop;
 execute definition;
end $$;
-- Existing saved order, cost and audit records are deliberately not deleted.
commit;
