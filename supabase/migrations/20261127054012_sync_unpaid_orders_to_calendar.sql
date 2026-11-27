begin;
set local lock_timeout = '3s';

create or replace function tlb.calendar_order(o tlb.orders) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when not o.refund_label and o.source in ('website','direct_message') and (
    o.payment_status='paid' and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed')
    or o.fulfillment_status='pending_confirmation' and (
      o.payment_status='under_review'
      or o.payment_status='awaiting_payment' and (o.payment_deadline is null
        or tlb.maintenance_deadline(o.payment_deadline,o.created_at,statement_timestamp())>statement_timestamp())
    )
  ) then
 jsonb_build_object('id',o.id,'reference',o.reference,'date',o.fulfillment_date,'method',o.method,
  'status',o.fulfillment_status,'total_cents',o.data->'total_cents',
  'buyer',jsonb_build_object('name',o.data#>>'{buyer,name}','phone',o.data#>>'{buyer,phone}','email',o.data#>>'{buyer,email}',
   'social_platform',o.data#>>'{buyer,social_platform}','social_username',o.data#>>'{buyer,social_username}'),
  'recipient',jsonb_build_object('name',o.data#>>'{recipient,name}','phone',o.data#>>'{recipient,phone}'),
  'address',jsonb_build_object('line1',o.data#>>'{address,line1}','line2',o.data#>>'{address,line2}',
   'locality',o.data#>>'{address,locality}','postal_code',o.data#>>'{address,postal_code}'),
  'instructions',o.data->>'instructions','pickup_address',o.data->>'pickup_address',
  'photo_count',(select count(*) from tlb.order_photos where order_id=o.id),
  'window',case when o.method='pickup' then o.data->>'pickup_hours' else o.data->>'delivery_window' end,
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',v->>'name','quantity',v->'quantity','description',v->>'description',
   'selection_labels',coalesce(v->'selection_labels','[]'::jsonb),'flavor_contents',coalesce(v->'flavor_contents','[]'::jsonb)))
   from jsonb_array_elements(coalesce(o.data->'items','[]')) v),'[]'::jsonb))
  -- Preserve the paid payload so existing paid events do not need a refresh.
  || case when o.payment_status='paid' then '{}'::jsonb else jsonb_build_object('payment_status',o.payment_status) end
 end
$$;
revoke all on function tlb.calendar_order(tlb.orders) from public, anon, authenticated, service_role;

-- Populate the existing queue for active holds without editing any order rows.
-- Subsequent order changes and the scheduled expiry transaction use the same trigger.
with eligible as materialized (
  select o.id, tlb.calendar_order(o) as payload
  from tlb.orders o
  where o.fulfillment_status='pending_confirmation' and o.payment_status in ('awaiting_payment','under_review')
)
select tlb.refresh_calendar_order(id,payload) from eligible where payload is not null;

commit;
