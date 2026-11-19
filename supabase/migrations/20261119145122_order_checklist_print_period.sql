begin;

create or replace function tlb.order_checklist_period(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  first_date date;
  last_date date;
  entries jsonb;
begin
  perform tlb.assert_staff(auth.uid(),false);
  perform tlb.require(tlb.is_verified(auth.uid()),'Verify your staff email to print the orders checklist.');
  perform tlb.require(p_payload->>'from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and p_payload->>'to' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$','Choose valid fulfillment dates.');
  first_date := (p_payload->>'from')::date;
  last_date := (p_payload->>'to')::date;
  perform tlb.require(last_date-first_date between 0 and 62,'Choose up to 63 consecutive fulfillment dates per request.');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'reference',o.reference,'date',o.fulfillment_date,'source',o.source,'method',o.method,
    'status',o.fulfillment_status,'payment_status',o.payment_status,
    'buyer',jsonb_build_object('name',o.data#>>'{buyer,name}'),
    'window',case when o.method='pickup' then o.data->>'pickup_hours' else o.data->>'delivery_window' end,
    'instructions',o.data->>'instructions',
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'product_id',i.item->'product_id','name',coalesce(nullif(i.item->>'name',''),i.item->>'custom_name'),
      'quantity',i.item->'quantity','description',coalesce(nullif(i.item->>'description',''),i.item->>'custom_description'),
      'selection_labels',i.item->'selection_labels','flavor_contents',i.item->'flavor_contents','selections',i.item->'selections'
    ) order by i.position) from jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb))
      with ordinality i(item,position)), '[]'::jsonb)
  ) order by o.fulfillment_date,o.reference,o.id),'[]'::jsonb) into entries
  from tlb.orders o where o.fulfillment_date between first_date and last_date;
  return jsonb_build_object('orders',entries);
end $$;
revoke all on function tlb.order_checklist_period(jsonb) from public,anon,authenticated,service_role;

-- Dispatch this report before the shop gateway's order expiry/maintenance writes.
do $patch$
declare
  definition text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  anchor text:=' perform pg_advisory_xact_lock(841721950318::bigint);';
  branch text:=' if p_action=''order_checklist_period'' then return tlb.order_checklist_period(p_payload);end if;';
begin
  perform tlb.require((length(definition)-length(replace(definition,anchor,'')))/length(anchor)=1,'Missing orders checklist report dispatch hook.');
  if position(branch in definition)=0 then
    execute replace(definition,anchor,branch||chr(10)||anchor);
  end if;
end $patch$;

commit;
