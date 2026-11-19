-- Include the saved fulfillment method in the staff checklist response.
create or replace view tlb.order_checklist_rows with (security_invoker=true) as
select o.id, o.reference, o.fulfillment_date, o.payment_status,
  jsonb_build_object('name',o.data#>>'{buyer,name}') as buyer,
  kitchen.items, coalesce(o.data->>'instructions','') as instructions,
  encode(sha256(convert_to(jsonb_build_array(kitchen.items,coalesce(o.data->>'instructions',''))::text,'UTF8')),'hex') as content_key,
  o.method
from tlb.orders o
cross join lateral (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',i.item->'product_id',
    'name',coalesce(nullif(i.item->>'name',''),i.item->>'custom_name'),
    'quantity',i.item->'quantity',
    'description',coalesce(nullif(i.item->>'description',''),i.item->>'custom_description'),
    'selection_labels',coalesce(i.item->'selection_labels','[]'::jsonb),
    'flavor_contents',coalesce(i.item->'flavor_contents','[]'::jsonb),
    'selections',coalesce(i.item->'selections','{}'::jsonb)
  ) order by i.position),'[]'::jsonb) as items
  from jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) with ordinality i(item,position)
) kitchen
where o.source in ('website','direct_message') and not o.refund_label
  and o.fulfillment_status not in ('cancelled','expired','completed')
  and o.payment_status in ('awaiting_payment','under_review','paid')
  and (o.payment_status <> 'awaiting_payment' or o.fulfillment_status <> 'pending_confirmation'
       or o.payment_deadline is null
       or tlb.maintenance_deadline(o.payment_deadline,o.created_at,statement_timestamp()) > statement_timestamp());
