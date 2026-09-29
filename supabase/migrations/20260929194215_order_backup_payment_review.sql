begin;
create or replace function tlb.backup_eligible(o tlb.orders) returns boolean
language sql immutable security invoker set search_path='' as $$
 select not o.refund_label and o.source in ('website','direct_message') and (
  (o.payment_status='paid' and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery'))
  or (o.payment_status='under_review' and o.fulfillment_status in ('pending_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery'))
 )
$$;
-- Refresh the destination even if already-existing review orders did not change.
update tlb.order_backup_connection set revision=revision+1 where id;
commit;
