begin;
set local lock_timeout='3s';
alter table tlb.outbox
 add column if not exists alert_acknowledged_at timestamptz,
 add column if not exists alert_acknowledged_by uuid,
 add column if not exists alert_acknowledged_attempts integer,
 add column if not exists alert_acknowledged_error text,
 add column if not exists alert_acknowledged_status text;

-- Dismiss the exact failure reviewed, without deleting or cancelling delivery.
create or replace function tlb.acknowledge_email_alert(p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e tlb.outbox; u uuid:=auth.uid();
begin
 perform tlb.assert_staff(u,false);
 select * into e from tlb.outbox where id=(p_payload->>'id')::uuid for update;
 perform tlb.require(found,'Email notification not found.');
 perform tlb.require(e.status<>'sent' and length(coalesce(e.last_error,''))>0,'This alert has already been resolved. Refresh the dashboard.');
 perform tlb.require(e.attempts=(p_payload->>'attempts')::integer
  and e.last_error=p_payload->>'last_error' and e.status=p_payload->>'status',
  'This email status changed. Refresh the dashboard before acknowledging it.');
 if e.alert_acknowledged_at is null or e.alert_acknowledged_attempts is distinct from e.attempts
  or e.alert_acknowledged_error is distinct from e.last_error or e.alert_acknowledged_status is distinct from e.status then
  update tlb.outbox set alert_acknowledged_at=now(),alert_acknowledged_by=u,
   alert_acknowledged_attempts=e.attempts,alert_acknowledged_error=e.last_error,alert_acknowledged_status=e.status
   where id=e.id returning * into e;
 end if;
 return jsonb_build_object('id',e.id,'alert_acknowledged',true,'alert_acknowledged_at',e.alert_acknowledged_at);
end;
$$;
revoke all on function tlb.acknowledge_email_alert(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare def text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure); old text; new text;
begin
 if position('-- EMAIL_ALERT_ACKNOWLEDGEMENTS_V1' in def)=0 then
  old:=$old$elsif p_action='save_inventory' then$old$;
  new:=$new$elsif p_action='acknowledge_email_alert' then
  -- EMAIL_ALERT_ACKNOWLEDGEMENTS_V1
  return tlb.acknowledge_email_alert(p_payload);
 elsif p_action='save_inventory' then$new$;
  if position(old in def)=0 then raise exception 'Email alert action anchor missing'; end if;
  def:=replace(def,old,new);
  old:='select id,event_type,order_id,status,attempts,last_error,created_at,sent_at from tlb.outbox';
  new:='select id,event_type,order_id,status,attempts,last_error,created_at,sent_at,alert_acknowledged_at,
   (alert_acknowledged_at is not null and alert_acknowledged_attempts=attempts
    and alert_acknowledged_error is not distinct from last_error
    and alert_acknowledged_status=status) as alert_acknowledged from tlb.outbox';
  if position(old in def)=0 then raise exception 'Email alert report anchor missing'; end if;
  def:=replace(def,old,new);
  execute def;
 end if;
end $patch$;
commit;
