-- Refunds recorded from this release onward cancel fulfillment in the same
-- transaction. Existing orders and historical refund records are untouched.
begin;
set local lock_timeout = '3s';

-- shop_api has already checked staff access, locked this order and validated
-- the request's revision and idempotency key. Its footer writes one audit row.
create or replace function tlb.cancel_fulfillment_on_refund(p_order tlb.orders, p_staff uuid, p_payload jsonb)
returns void language plpgsql security invoker set search_path = '' as $function$
declare
  reason text := trim(p_payload->>'reason');
begin
  perform tlb.require(p_payload->'cancel_fulfillment' = 'true'::jsonb,
    'Refresh the dashboard and confirm that recording the refund will cancel this order.');
  perform tlb.require(length(reason) between 1 and 4000, 'Enter a reason for cancelling the refunded order.');
  if p_order.source = 'popup' then
    perform tlb.assert_staff(p_staff, true);
    perform tlb.require(tlb.is_verified(p_staff), 'Verify your owner email before voiding a pop-up sale.');
    perform tlb.require(length(reason) between 3 and 500, 'Enter a reason for voiding this sale (3–500 characters).');
  end if;
  if p_order.payment_status = 'paid' and p_order.fulfillment_status <> 'expired' then
    perform tlb.require(jsonb_typeof(p_payload->'restore_stock') = 'boolean',
      'Choose whether the refunded items can return to sellable stock.');
  end if;

  update tlb.orders set refund_label = true, fulfillment_status = 'cancelled',
    payment_status = case when payment_status in ('awaiting_payment','under_review') then 'cancelled' else payment_status end,
    revision = revision + 1
  where id = p_order.id;

  -- Expiration already released its reservations. Keep that disposition.
  if p_order.fulfillment_status = 'expired' then return; end if;
  if p_order.source = 'popup' then
    if p_payload->'restore_stock' = 'true'::jsonb then
      delete from tlb.pos_allocations where order_id = p_order.id;
      delete from tlb.pos_custom_allocations where order_id = p_order.id;
    end if;
  else
    if p_order.payment_status <> 'paid' or p_payload->'restore_stock' = 'true'::jsonb then
      delete from tlb.allocations where order_id = p_order.id;
    else
      update tlb.allocations set state = 'retained' where order_id = p_order.id;
    end if;
    delete from tlb.promo_usage where order_id = p_order.id and state = 'reserved';
  end if;
end
$function$;
revoke all on function tlb.cancel_fulfillment_on_refund(tlb.orders,uuid,jsonb) from public, anon, authenticated, service_role;

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  original text := $old$update tlb.orders set refund_label=(p_payload->>'enabled')::boolean,revision=revision+1 where id=oid;$old$;
  replacement text := $new$perform tlb.require(jsonb_typeof(p_payload->'enabled') = 'boolean', 'Choose whether to record the refund.');
  if p_payload->'enabled' = 'true'::jsonb and not o.refund_label and o.fulfillment_status <> 'cancelled' then
    perform tlb.cancel_fulfillment_on_refund(o, u, p_payload);
  else
    update tlb.orders set refund_label=(p_payload->>'enabled')::boolean,revision=revision+1 where id=oid;
  end if;$new$;
  email_marker text := $old$elsif p_action='cancel_order' then perform tlb.queue_email(oid,'order_cancelled','cancelled:'||oid);$old$;
  email_transition text := $new$elsif p_action='cancel_order' or (p_action='set_refund_label' and p_payload->'enabled' = 'true'::jsonb
      and not o.refund_label and o.fulfillment_status not in ('completed','expired','cancelled')) then
    perform tlb.queue_email(oid,'order_cancelled','cancelled:'||oid);$new$;
begin
  if strpos(definition, 'perform tlb.cancel_fulfillment_on_refund(o, u, p_payload);') > 0 then return; end if;
  perform tlb.require((length(definition) - length(replace(definition, original, ''))) / length(original) = 1,
    'Expected exactly one refund action in shop_api.');
  perform tlb.require((length(definition) - length(replace(definition, email_marker, ''))) / length(email_marker) = 1,
    'Expected exactly one cancellation notification in shop_api.');
  -- Queue only after the shared audit footer has saved the cancellation reason.
  execute replace(replace(definition, original, replacement), email_marker, email_transition);
end
$migration$;
commit;
