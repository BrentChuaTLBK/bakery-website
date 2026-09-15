-- Delivery restrictions and zone details for future bookings.
-- Existing orders, deadlines, fees and snapshots are not rewritten. Legacy
-- products without pickup_only and zones without description retain defaults.
-- Existing date_supported already enforces delivery_blocked_dates independently
-- of pickup and global blocked_dates; no settings values are changed here.
-- Guarded edits preserve the complete current API, grants and stock locking,
-- including the 15-minute payment deadline and contact validation migration.
-- For an existing delivery order, the same product/date/quantity may be retained
-- after marking that product pickup only, just as inactive products are retained.
-- New allocations and changes of date or method must satisfy the new restriction.
-- Reapplying is a no-op; every guarded replacement must match before execution.

do $migration$
declare
  definition text := pg_get_functiondef('tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)'::regprocedure);
  patch record;
begin
  if position('TLB_DELIVERY_OPTIONS_V1' in definition)=0 then
    for patch in select * from (values
    ($old$declare
 s jsonb; o tlb.orders;$old$,$new$declare
 -- TLB_DELIVERY_OPTIONS_V1
 delivery_zone_name text := ''; delivery_zone_description text := '';
 s jsonb; o tlb.orders;$new$,1),
    ($old$  if require_item then
   perform tlb.require(coalesce((p->>'active')::boolean,false)$old$,$new$  if require_item then
   perform tlb.require(method<>'delivery' or not coalesce((p->>'pickup_only')::boolean,false),(p->>'name')||' is pickup only. Choose pickup or remove this product to use delivery.');
   perform tlb.require(coalesce((p->>'active')::boolean,false)$new$,1),
    ($old$   delivery:=(o.data->>'delivery_cents')::integer;$old$,$new$   delivery:=(o.data->>'delivery_cents')::integer;
   delivery_zone_name:=coalesce(o.data->>'delivery_zone_name','');
   delivery_zone_description:=coalesce(o.data->>'delivery_zone_description','');$new$,1),
    ($old$   delivery:=(z.data->>'fee_cents')::integer;$old$,$new$   delivery:=(z.data->>'fee_cents')::integer;
   delivery_zone_name:=coalesce(z.data->>'name','');
   delivery_zone_description:=coalesce(z.data->>'description','');$new$,1),
    ($old$'earliest_date',earliest);$old$,$new$'earliest_date',earliest,'delivery_zone_name',delivery_zone_name,'delivery_zone_description',delivery_zone_description);$new$,1)
    ) as patches(old_value,new_value,expected_count)
    loop
      -- Dashboard-installed SQL may retain CRLF line endings. Match those
      -- exact anchors without rewriting unrelated function text.
      if position(patch.old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
        patch.old_value:=replace(patch.old_value,chr(10),chr(13)||chr(10));
        patch.new_value:=replace(patch.new_value,chr(10),chr(13)||chr(10));
      end if;
      if length(definition)-length(replace(definition,patch.old_value,'')) <> length(patch.old_value)*patch.expected_count then
        raise exception 'Unexpected function definition in % delivery migration; review before applying.', 'tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)';
      end if;
      definition:=replace(definition,patch.old_value,patch.new_value);
    end loop;
    execute definition;
  end if;
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  patch record;
begin
  if position('TLB_DELIVERY_OPTIONS_V1' in definition)=0 then
    for patch in select * from (values
    ($old$ -- One transaction-wide lock keeps low-volume bakery capacity, promo and edit operations serializable.$old$,$new$ -- TLB_DELIVERY_OPTIONS_V1
 -- One transaction-wide lock keeps low-volume bakery capacity, promo and edit operations serializable.$new$,1),
    ($old$'promo_snapshot',q->'promo_snapshot'$old$,$new$'promo_snapshot',q->'promo_snapshot','delivery_zone_name',q->'delivery_zone_name','delivery_zone_description',q->'delivery_zone_description'$new$,2),
    ($old$   row_data:=p_payload->'product'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$old$,$new$   row_data:=p_payload->'product';
   perform tlb.require(not (row_data ? 'pickup_only') or jsonb_typeof(row_data->'pickup_only')='boolean','Pickup only must be enabled or disabled.');
   rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$new$,1),
    ($old$jsonb_build_object('description','','category_id',null,'min_quantity',1$old$,$new$jsonb_build_object('pickup_only',false,'description','','category_id',null,'min_quantity',1$new$,1),
    ($old$   row_data:=p_payload->'zone'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$old$,$new$   row_data:=p_payload->'zone';
   perform tlb.require(not (row_data ? 'description') or (jsonb_typeof(row_data->'description')='string' and length(row_data->>'description')<=2000),'Delivery zone description must be text with at most 2000 characters.');
   rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$new$,1),
    ($old$   row_data:=jsonb_build_object('active',true)||row_data||jsonb_build_object('id',rid); insert into tlb.zones$old$,$new$   row_data:=jsonb_build_object('active',true,'description','')||row_data||jsonb_build_object('id',rid); insert into tlb.zones$new$,1),
    ($old$jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents')$old$,$new$(jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents')
    || case when (p_payload->'expected_quote') ? 'delivery_zone_name' then jsonb_build_object('delivery_zone_name',q->'delivery_zone_name') else '{}'::jsonb end
    || case when (p_payload->'expected_quote') ? 'delivery_zone_description' then jsonb_build_object('delivery_zone_description',q->'delivery_zone_description') else '{}'::jsonb end)$new$,1),
    ($old$jsonb_build_object('items',merged->'items','subtotal_cents',merged->'subtotal_cents','discount_cents',merged->'discount_cents','delivery_cents',merged->'delivery_cents','total_cents',merged->'total_cents')$old$,$new$(jsonb_build_object('items',merged->'items','subtotal_cents',merged->'subtotal_cents','discount_cents',merged->'discount_cents','delivery_cents',merged->'delivery_cents','total_cents',merged->'total_cents')
    || case when (p_payload->'expected_quote') ? 'delivery_zone_name' then jsonb_build_object('delivery_zone_name',merged->'delivery_zone_name') else '{}'::jsonb end
    || case when (p_payload->'expected_quote') ? 'delivery_zone_description' then jsonb_build_object('delivery_zone_description',merged->'delivery_zone_description') else '{}'::jsonb end)$new$,1)
    ) as patches(old_value,new_value,expected_count)
    loop
      -- Dashboard-installed SQL may retain CRLF line endings. Match those
      -- exact anchors without rewriting unrelated function text.
      if position(patch.old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
        patch.old_value:=replace(patch.old_value,chr(10),chr(13)||chr(10));
        patch.new_value:=replace(patch.new_value,chr(10),chr(13)||chr(10));
      end if;
      if length(definition)-length(replace(definition,patch.old_value,'')) <> length(patch.old_value)*patch.expected_count then
        raise exception 'Unexpected function definition in % delivery migration; review before applying.', 'public.shop_api(text,jsonb,text)';
      end if;
      definition:=replace(definition,patch.old_value,patch.new_value);
    end loop;
    execute definition;
  end if;
end;
$migration$;
