begin;

create table tlb.order_preparation_checks (
  order_id uuid primary key references tlb.orders(id) on delete cascade,
  content_key text not null
);
alter table tlb.order_preparation_checks enable row level security;
revoke all on tlb.order_preparation_checks from public, anon, authenticated, service_role;

-- Both actions use the same eligibility, saved kitchen details and content key.
create view tlb.order_checklist_rows with (security_invoker=true) as
select o.id, o.reference, o.fulfillment_date, o.payment_status,
  jsonb_build_object('name',o.data#>>'{buyer,name}') as buyer,
  kitchen.items, coalesce(o.data->>'instructions','') as instructions,
  encode(sha256(convert_to(jsonb_build_array(kitchen.items,coalesce(o.data->>'instructions',''))::text,'UTF8')),'hex') as content_key
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
revoke all on tlb.order_checklist_rows from public, anon, authenticated, service_role;

create function tlb.order_checklist(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  oid uuid;
  current_key text;
  mark boolean;
begin
  perform tlb.assert_staff(auth.uid(),false);
  perform tlb.require(tlb.is_verified(auth.uid()),'Verify your staff email to use the order checklist.');
  if p_action='order_checklist' then
    return (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('prepared',c.order_id is not null)
                                      order by r.fulfillment_date,r.reference,r.id),'[]'::jsonb)
            from tlb.order_checklist_rows r
            left join tlb.order_preparation_checks c on c.order_id=r.id and c.content_key=r.content_key);
  end if;
  perform tlb.require(p_action='set_order_prepared' and jsonb_typeof(p_payload->'prepared')='boolean'
    and p_payload->>'content_key' ~ '^[0-9a-f]{64}$','Choose a valid order and preparation state.');
  oid := (p_payload->>'order_id')::uuid;
  mark := (p_payload->>'prepared')::boolean;
  perform 1 from tlb.orders where id=oid for update;
  select content_key into current_key from tlb.order_checklist_rows where id=oid;
  perform tlb.require(found,'This order is no longer on the checklist.');
  perform tlb.require(current_key=p_payload->>'content_key','Order details changed. Refresh the checklist and review the updated order.');
  if mark then
    insert into tlb.order_preparation_checks as c(order_id,content_key) values(oid,current_key)
    on conflict(order_id) do update set content_key=excluded.content_key where c.content_key<>excluded.content_key;
  else
    delete from tlb.order_preparation_checks where order_id=oid;
  end if;
  return jsonb_build_object('prepared',mark);
end $$;
revoke all on function tlb.order_checklist(text,jsonb) from public, anon, authenticated, service_role;

-- Checklist reads and marks do not run general shop expiry or fulfillment actions.
do $patch$
declare
  definition text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  anchor text:=' perform pg_advisory_xact_lock(841721950318::bigint);';
  branch text:=' if p_action in (''order_checklist'',''set_order_prepared'') then return tlb.order_checklist(p_action,p_payload);end if;';
begin
  perform tlb.require((length(definition)-length(replace(definition,anchor,'')))/length(anchor)=1,'Missing order checklist dispatch hook.');
  execute replace(definition,anchor,branch||chr(10)||anchor);
end $patch$;

commit;
