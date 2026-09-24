begin;

create index if not exists outbox_pickup_reminders
  on tlb.outbox(order_id,created_at desc) where event_type='pickup_reminder';

create or replace function tlb.pickup_reminder_status(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',id,'status',status,'requested_at',created_at,
    'sent_at',sent_at,'next_allowed_at',greatest(created_at,sent_at)+interval '15 minutes')
  from tlb.outbox where order_id=p_id and event_type='pickup_reminder'
  order by created_at desc limit 1
$$;
revoke all on function tlb.pickup_reminder_status(uuid) from public,anon,authenticated,service_role;

create or replace function tlb.send_pickup_reminder(p_user uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  o tlb.orders;
  previous tlb.outbox;
  existing tlb.action_keys;
  action_key uuid;
  request_hash text;
  v_event_key text;
begin
  perform tlb.assert_staff(p_user,false);
  perform pg_advisory_xact_lock(841721950318::bigint);
  select * into o from tlb.orders where id=(p_payload->>'order_id')::uuid for update;
  perform tlb.require(found,'Order not found.');
  action_key:=(p_payload->>'idempotency_key')::uuid;
  perform tlb.require(action_key is not null,'A unique action key is required.');
  request_hash:=encode(extensions.digest((p_payload-'revision')::text,'sha256'),'hex');
  select * into existing from tlb.action_keys
    where user_id=p_user and action='send_pickup_reminder' and key=action_key;
  if found then
    perform tlb.require(existing.order_id=o.id and existing.request_hash=request_hash,
      'This action key was already used for a different request.');
    return tlb.order_json(o.id,true,false);
  end if;
  perform tlb.require((p_payload->>'revision')::integer=o.revision,
    'This order changed. Refresh it and review the latest version before sending a reminder.');
  perform tlb.require(o.method='pickup' and o.payment_status='paid'
    and o.fulfillment_status='ready_for_pickup' and not o.refund_label,
    'Only paid orders that are ready for pickup can receive a pickup reminder.');
  perform tlb.require(nullif(trim(o.data#>>'{buyer,email}'),'') is not null,
    'This order needs a customer email address before a reminder can be sent.');
  select * into previous from tlb.outbox where order_id=o.id and event_type='pickup_reminder'
    order by created_at desc limit 1;
  if previous.id is not null and previous.status in ('pending','sending') then
    -- A second staff member or a retry cannot create another pending reminder.
    insert into tlb.action_keys(user_id,action,key,order_id,request_hash)
      values(p_user,'send_pickup_reminder',action_key,o.id,request_hash);
    return tlb.order_json(o.id,true,false);
  end if;
  perform tlb.require(previous.id is null or
    greatest(previous.created_at,previous.sent_at)+interval '15 minutes'<=clock_timestamp(),
    'A pickup reminder was requested recently. Please wait 15 minutes before sending another.');
  v_event_key:='pickup-reminder:'||o.id||':'||p_user||':'||action_key;
  perform tlb.queue_email(o.id,'pickup_reminder',v_event_key,o.fulfillment_date);
  update tlb.outbox set subject='Reminder: your order is ready for pickup · '||o.reference
    where tlb.outbox.event_key=v_event_key;
  insert into tlb.action_keys(user_id,action,key,order_id,request_hash)
    values(p_user,'send_pickup_reminder',action_key,o.id,request_hash);
  perform tlb.audit(o.id,p_user,'pickup_reminder_requested',
    'Pickup reminder email queued for the customer.',null,null,true);
  return tlb.order_json(o.id,true,false);
end $$;
revoke all on function tlb.send_pickup_reminder(uuid,jsonb) from public,anon,authenticated,service_role;

-- Extend the existing authorized dispatchers without adding a public RPC.
do $migration$
declare
  definition text;
  patch record;
  old_value text;
  new_value text;
begin
  for patch in select * from (values
    ('tlb.order_json(uuid,boolean,boolean)',
     $old$|| case when p_token then$old$,
     $new$|| case when p_private then jsonb_build_object('pickup_reminder',tlb.pickup_reminder_status(p_id)) else '{}'::jsonb end || case when p_token then$new$),
    ('public.shop_api(text,jsonb,text)',
     $old$ -- Remaining actions operate on one existing order and use a revision plus retry key.$old$,
     $new$ if p_action='send_pickup_reminder' then
  return tlb.send_pickup_reminder(u,p_payload);
 end if;
 -- Remaining actions operate on one existing order and use a revision plus retry key.$new$),
    ('public.shop_service(text,jsonb)',
     $old$   return jsonb_build_object('id',e.id,'event_key',e.event_key$old$,
     $new$   if e.event_type='pickup_reminder' then
    select * into o from tlb.orders where id=e.order_id;
    good:=o.method='pickup' and o.payment_status='paid'
      and o.fulfillment_status='ready_for_pickup' and not o.refund_label
      and o.fulfillment_date=e.target_date
      and o.revision=(e.payload#>>'{order,revision}')::integer
      and o.data#>>'{buyer,email}'=e.to_email;
    if good is distinct from true then
      update tlb.outbox set status='skipped',
        last_error='Pickup reminder no longer matches an unchanged ready pickup order.',
        lease_token=null,leased_until=null where id=e.id;
      return jsonb_build_object('skip',true);
    end if;
    -- Keep the queued body unchanged across provider retries.
   end if;
   return jsonb_build_object('id',e.id,'event_key',e.event_key$new$)
  ) as changes(signature,old_text,new_text)
  loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    old_value:=replace(patch.old_text,E'\r\n',E'\n');
    new_value:=replace(patch.new_text,E'\r\n',E'\n');
    if position(E'\r\n' in definition)>0 then
      old_value:=replace(old_value,chr(10),chr(13)||chr(10));
      new_value:=replace(new_value,chr(10),chr(13)||chr(10));
    end if;
    if position(new_value in definition)>0 then continue; end if;
    if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
      raise exception 'Unexpected definition for %; review before adding pickup reminders.',patch.signature;
    end if;
    execute replace(definition,old_value,new_value);
  end loop;
end $migration$;

commit;
