begin;

-- Only the existing shop gateway can call this private, read-only helper.
-- Keep saved item configurations: the current catalog may have changed since
-- an order was placed. Never expose order access tokens or payment proofs.
create or replace function tlb.admin_production(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
 first_date date; last_date date;
 today_date date:=(now() at time zone 'Asia/Manila')::date;
 entries jsonb;
begin
 perform tlb.assert_staff(auth.uid(),false);
 perform tlb.require(tlb.is_verified(auth.uid()),'Verify your staff email before viewing production.');
 perform tlb.require(jsonb_typeof(p_payload)='object','Invalid request payload.');
 perform tlb.require(p_payload->>'from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and p_payload->>'to' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$','Choose valid production dates in YYYY-MM-DD format.');
 begin
  first_date:=(p_payload->>'from')::date;
  last_date:=(p_payload->>'to')::date;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'Choose valid production dates in YYYY-MM-DD format.' using errcode='22023';
 end;
 perform tlb.require(last_date>=first_date and last_date-first_date<=365,'Choose a production range of up to 366 days, with the start on or before the end.');

 -- orders_due already indexes fulfillment_date and fulfillment_status. There
 -- is no LIMIT: production quantities must not depend on dashboard pagination.
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'reference',o.reference,'fulfillment_date',o.fulfillment_date,
  'method',o.method,'source',o.source,'payment_status',o.payment_status,
  'fulfillment_status',o.fulfillment_status,'refund_label',o.refund_label,
  'buyer',jsonb_build_object('name',o.data#>>'{buyer,name}'),
  'instructions',o.data->>'instructions',
  'items',coalesce((select jsonb_agg(jsonb_build_object(
   'product_id',v.item->'product_id','name',v.item->>'name','quantity',v.item->'quantity',
   'selections',coalesce(v.item->'selections','{}'::jsonb),
   'selection_labels',coalesce(v.item->'selection_labels','[]'::jsonb),
   'flavor_contents',coalesce(v.item->'flavor_contents','[]'::jsonb),
   'custom',v.item->'custom','description',v.item->>'description') order by v.position)
   from jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) with ordinality as v(item,position)), '[]'::jsonb)
  ) order by o.fulfillment_date,o.reference,o.id),'[]'::jsonb) into entries
 from tlb.orders o
 where o.source in ('website','direct_message') and not o.refund_label
  and o.fulfillment_status not in ('cancelled','expired')
  and (o.fulfillment_date between first_date and last_date
   or (o.fulfillment_date<least(first_date,today_date) and o.payment_status='paid'
    and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery')));
 return jsonb_build_object('today',today_date,'orders',entries);
end $$;
revoke all on function tlb.admin_production(jsonb) from public,anon,authenticated,service_role;

-- Dispatch before the gateway's expiry/maintenance writes and order lock.
-- Viewing a production report must not alter unpaid orders, stock or queues.
do $patch$
declare
 definition text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 anchor text:=' perform pg_advisory_xact_lock(841721950318::bigint);';
 branch text:=' if p_action=''admin_production'' then return tlb.admin_production(p_payload);end if;';
begin
 perform tlb.require((length(definition)-length(replace(definition,anchor,'')))/length(anchor)=1,'Missing production read dispatch hook.');
 if position(branch in definition)=0 then
  execute replace(definition,anchor,branch||chr(10)||anchor);
 end if;
end $patch$;

commit;
