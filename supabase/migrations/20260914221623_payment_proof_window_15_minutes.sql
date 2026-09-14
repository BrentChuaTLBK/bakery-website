-- New orders have 15 minutes to submit their first valid payment proof.
-- Already-issued deadlines, timely proofs under review, paid orders and the
-- existing stock/expiry transaction are deliberately left unchanged.
do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := 'submitted_at,submitted_at+interval ''60 minutes'',';
  new_value text := 'submitted_at,submitted_at+interval ''15 minutes'',';
begin
  -- Keep the complete live API, its ownership, grants and validation. Abort
  -- instead of silently changing a different path if this insertion changes.
  if length(definition) - length(replace(definition, old_value, '')) = length(old_value) then
    execute replace(definition, old_value, new_value);
  elsif position(old_value in definition) = 0
    and length(definition) - length(replace(definition, new_value, '')) = length(new_value) then
    null; -- Safe to replay; do not recalculate any existing order deadline.
  else
    raise exception 'Unexpected create_order payment deadline expression; review public.shop_api before applying this migration.';
  end if;
end;
$migration$;

alter table tlb.orders alter column payment_deadline set default now() + interval '15 minutes';

-- The actual saved deadline remains authoritative, including for older orders.
-- Successful shop API calls already run this inside the shared advisory lock
-- before reading or reserving stock, so checkout need not wait for cron.
create or replace function tlb.expire_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare o tlb.orders; n integer := 0;
begin
  for o in select * from tlb.orders
    where payment_status = 'awaiting_payment'
      and fulfillment_status = 'pending_confirmation'
      and payment_deadline <= clock_timestamp()
    for update
  loop
    update tlb.orders set fulfillment_status = 'expired', revision = revision + 1 where id = o.id;
    delete from tlb.allocations where order_id = o.id and state = 'held';
    delete from tlb.promo_usage where order_id = o.id and state = 'reserved';
    perform tlb.audit(o.id, null, 'expired', 'No valid payment proof was submitted before the payment deadline.');
    perform tlb.queue_email(o.id, 'order_expired', 'expired:' || o.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
