-- Deletion hides and disables a promo, keeping its identity and existing uses.
-- Existing order snapshots remain authoritative for previously placed orders.
do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_parts text[] := array[
    $old$if p_action='admin_bootstrap' then$old$,
    $old$return jsonb_build_object('role',role_name,$old$,
    $old$from tlb.outbox order by created_at desc limit 100) e));$old$,
    $old$row_data:=p_payload->'promo'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid()); row_data:=jsonb_build_object('active',true,'min_subtotal_cents',0,'cap_cents',null)||row_data||jsonb_build_object('id',rid,'code',upper(trim(row_data->>'code')));$old$
  ];
  new_parts text[] := array[
    $new$-- TLB_PROMO_DELETION_V1
 if p_action='delete_promo' then
  perform tlb.assert_staff(u,true);
  rid:=(p_payload->>'id')::uuid;
  select data into row_data from tlb.promos where id=rid;
  perform tlb.require(row_data is not null,'Promo code not found.');
  if row_data->>'deleted_at' is null then
   update tlb.promos set data=data||jsonb_build_object('active',false,'deleted_at',clock_timestamp(),'deleted_by',u) where id=rid;
  end if;
  return jsonb_build_object('id',rid,'deleted',true);
 end if;
 if p_action='admin_bootstrap' then$new$,
    $new$result:=jsonb_build_object('role',role_name,$new$,
    $new$from tlb.outbox order by created_at desc limit 100) e));
  return result||jsonb_build_object('promos',(select coalesce(jsonb_agg(promo),'[]'::jsonb) from jsonb_array_elements(result->'promos') promo where promo->>'deleted_at' is null));$new$,
    $new$row_data:=(p_payload->'promo')-'deleted_at'-'deleted_by'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());
   perform tlb.require(not exists(select 1 from tlb.promos where id=rid and data->>'deleted_at' is not null),'This promo code was deleted and cannot be reactivated. Create a new code with a different name.');
   perform tlb.require(not exists(select 1 from tlb.promos where code=upper(trim(row_data->>'code')) and id<>rid and data->>'deleted_at' is not null),'This promo code was deleted and its name cannot be reused. Choose a different code.');
   row_data:=jsonb_build_object('active',true,'min_subtotal_cents',0,'cap_cents',null)||row_data||jsonb_build_object('id',rid,'code',upper(trim(row_data->>'code')));$new$
  ];
  i integer;
begin
  if position('-- TLB_PROMO_DELETION_V1' in definition)>0 then
    for i in 1..array_length(new_parts,1) loop
      if position(new_parts[i] in definition)=0 then
        raise exception 'Unexpected promo deletion definition; review public.shop_api before replaying this migration.';
      end if;
    end loop;
    return;
  end if;
  for i in 1..array_length(old_parts,1) loop
    if length(definition)-length(replace(definition,old_parts[i],''))<>length(old_parts[i]) then
      raise exception 'Unexpected promo deletion anchor %; review public.shop_api before applying this migration.',i;
    end if;
    definition:=replace(definition,old_parts[i],new_parts[i]);
  end loop;
  execute definition;
end;
$migration$;
