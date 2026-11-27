begin;
set local lock_timeout = '3s';

alter table tlb.order_preparation_checks
  add column prepared_items integer[],
  add column prep_note text not null default '',
  add column prep_note_version integer not null default 0;

-- A null item array on a matching snapshot is the original whole-order mark.
create or replace function tlb.order_checklist(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  oid uuid;
  current_key text;
  item_count integer;
  item_number integer;
  item_marks integer[];
  mark boolean;
  saved_note text;
  saved_note_version integer;
  requested_note text;
begin
  perform tlb.assert_staff(auth.uid(),false);
  perform tlb.require(tlb.is_verified(auth.uid()),'Verify your staff email to use the order checklist.');
  if p_action='order_checklist' then
    return (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
               'prepared',case when c.content_key is distinct from r.content_key then false
                 else c.prepared_items is null or cardinality(c.prepared_items)=jsonb_array_length(r.items)
                   and jsonb_array_length(r.items)>0 end,
               'prepared_items',case
                 when c.content_key is distinct from r.content_key then array[]::integer[]
                 else coalesce(c.prepared_items,array(select generate_series(1,jsonb_array_length(r.items))))
               end,
               'prep_note',coalesce(c.prep_note,''),
               'prep_note_version',coalesce(c.prep_note_version,0))
                 order by r.fulfillment_date,r.reference,r.id),'[]'::jsonb)
            from tlb.order_checklist_rows r
            left join tlb.order_preparation_checks c on c.order_id=r.id);
  end if;

  if p_action='set_order_prep_note' then
    perform tlb.require(jsonb_typeof(p_payload->'note')='string' and char_length(p_payload->>'note')<=2000
      and jsonb_typeof(p_payload->'note_version')='number' and p_payload->>'note_version' ~ '^(0|[1-9][0-9]{0,8})$',
      'Enter a valid preparation note of up to 2,000 characters.');
    requested_note := p_payload->>'note';
  else
    perform tlb.require(p_action in ('set_order_prepared','set_order_item_prepared')
      and jsonb_typeof(p_payload->'prepared')='boolean'
      and p_payload->>'content_key' ~ '^[0-9a-f]{64}$','Choose a valid order and preparation state.');
    mark := (p_payload->>'prepared')::boolean;
  end if;

  oid := (p_payload->>'order_id')::uuid;
  -- Serialize checklist writes and re-check eligibility against the current order.
  perform 1 from tlb.orders where id=oid for update;
  select r.content_key,jsonb_array_length(r.items),
    case when c.content_key is distinct from r.content_key then array[]::integer[]
      else coalesce(c.prepared_items,array(select generate_series(1,jsonb_array_length(r.items)))) end,
    coalesce(c.prep_note,''),coalesce(c.prep_note_version,0)
    into current_key,item_count,item_marks,saved_note,saved_note_version
    from tlb.order_checklist_rows r
    left join tlb.order_preparation_checks c on c.order_id=r.id
    where r.id=oid;
  perform tlb.require(found,'This order is no longer on the checklist.');

  if p_action='set_order_prep_note' then
    if requested_note=saved_note then
      return jsonb_build_object('note',saved_note,'note_version',saved_note_version);
    end if;
    if saved_note_version<>(p_payload->>'note_version')::integer then
      return jsonb_build_object('note',saved_note,'note_version',saved_note_version,'conflict',true);
    end if;
    insert into tlb.order_preparation_checks(order_id,content_key,prepared_items,prep_note,prep_note_version)
      values(oid,current_key,array[]::integer[],requested_note,saved_note_version+1)
    on conflict(order_id) do update set prep_note=excluded.prep_note,prep_note_version=excluded.prep_note_version;
    return jsonb_build_object('note',requested_note,'note_version',saved_note_version+1);
  end if;

  perform tlb.require(current_key=p_payload->>'content_key','Order details changed. Refresh the checklist and review the updated order.');
  if p_action='set_order_item_prepared' then
    perform tlb.require(jsonb_typeof(p_payload->'item_number')='number'
      and p_payload->>'item_number' ~ '^[1-9][0-9]{0,8}$','Choose an item from this order.');
    item_number := (p_payload->>'item_number')::integer;
    perform tlb.require(item_number<=item_count,'Choose an item from this order.');
    if mark and not (item_number=any(item_marks)) then
      item_marks := array_append(item_marks,item_number);
    elsif not mark then
      item_marks := array_remove(item_marks,item_number);
    end if;
  else
    item_marks := case when mark then null else array[]::integer[] end;
  end if;

  insert into tlb.order_preparation_checks as c(order_id,content_key,prepared_items)
    values(oid,current_key,item_marks)
  on conflict(order_id) do update set content_key=excluded.content_key,prepared_items=excluded.prepared_items
    where (c.content_key,c.prepared_items) is distinct from (excluded.content_key,excluded.prepared_items);

  if p_action='set_order_prepared' then
    return jsonb_build_object('prepared',mark);
  end if;
  return jsonb_build_object('prepared',cardinality(item_marks)=item_count,'prepared_items',item_marks);
end $$;
revoke all on function tlb.order_checklist(text,jsonb) from public, anon, authenticated, service_role;

do $patch$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  previous text := $old$if p_action in ('order_checklist','set_order_prepared') then return tlb.order_checklist(p_action,p_payload);end if;$old$;
  updated text := $new$if p_action in ('order_checklist','set_order_prepared','set_order_item_prepared','set_order_prep_note') then return tlb.order_checklist(p_action,p_payload);end if;$new$;
begin
  perform tlb.require(length(definition)-length(replace(definition,previous,''))=length(previous),
    'Expected one order checklist dispatch hook.');
  execute replace(definition,previous,updated);
end $patch$;

commit;
