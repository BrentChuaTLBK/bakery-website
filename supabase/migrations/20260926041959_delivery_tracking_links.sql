begin;

-- Tracking is entered by staff through the existing revision-checked order edit.
-- It is never accepted from customer checkout and never exposed in the catalog.
create or replace function tlb.delivery_tracking_url(value jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare url text; authority text; port text; tail text;
begin
 if value is null then return ''; end if;
 perform tlb.require(jsonb_typeof(value)='string','Enter the delivery tracking link as text.');
 url:=value#>>'{}';
 perform tlb.require(length(url)<=2048,'Keep the delivery tracking link to 2,048 characters or fewer.');
 if url='' then return ''; end if;
 perform tlb.require(url !~ '[[:space:][:cntrl:]<>"''\\]',
   'Use a valid HTTPS delivery tracking link without spaces or control characters.');
 perform tlb.require(url ~* '^https://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?([/?#].*)?$',
   'Use a valid HTTPS delivery tracking link without a username or password.');
 authority:=substring(url from '(?i)^https://([^/?#]+)');
 port:=(regexp_match(authority,':([0-9]+)$'))[1];
 perform tlb.require(port is null or port::integer between 0 and 65535,'Use a valid delivery tracking URL port.');
 tail:=substring(url from 9+length(authority));
 authority:=lower(authority);
 if port is not null and port::integer=443 then authority:=regexp_replace(authority,':[0-9]+$',''); end if;
 return 'https://'||authority||case when left(tail,1)='/' then tail else '/'||tail end;
end $$;
revoke all on function tlb.delivery_tracking_url(jsonb) from public,anon,authenticated,service_role;

-- Reuse a not-yet-attempted dispatch/update email when staff adds a link just
-- after marking an order out for delivery. Provider attempts are immutable.
create or replace function tlb.queue_delivery_tracking_update(p_id uuid,p_before jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare o tlb.orders; pending tlb.outbox; v_payload jsonb; settings jsonb; previous_url text; current_url text; previous_tracking jsonb;
begin
 select * into strict o from tlb.orders where id=p_id;
 previous_url:=tlb.delivery_tracking_url(p_before->'delivery_tracking_url');
 current_url:=tlb.delivery_tracking_url(o.data->'delivery_tracking_url');
 if o.method<>'delivery' or o.fulfillment_status in ('cancelled','expired','completed') or o.refund_label
   or current_url=previous_url or (previous_url='' and o.fulfillment_status<>'out_for_delivery') then return; end if;
 previous_tracking:=jsonb_build_object('delivery_tracking_url',previous_url);
 select * into pending from tlb.outbox
 where order_id=p_id and event_type in ('out_for_delivery','delivery_tracking_updated')
   and status='pending' and attempts=0 and first_attempt_at is null
 order by created_at desc,id desc limit 1 for update;
 if pending.id is not null then
  select data-'owner_email' into settings from tlb.settings where id;
  v_payload:=jsonb_build_object('event_type',pending.event_type,'order',tlb.order_json(p_id,false,true),'settings',settings,'old_order',previous_tracking);
  update tlb.outbox set payload=v_payload,
    to_email=o.data#>>'{buyer,email}',available_at=now(),last_error=null where id=pending.id;
 else
  perform tlb.queue_email(p_id,'delivery_tracking_updated','delivery-tracking:'||p_id||':'||o.revision,null,previous_tracking);
  update tlb.outbox set subject='Your delivery tracking has been updated · '||o.reference
    where event_key='delivery-tracking:'||p_id||':'||o.revision;
 end if;
end $$;
revoke all on function tlb.queue_delivery_tracking_update(uuid,jsonb) from public,anon,authenticated,service_role;

-- Preserve all current authorization, stock, accounting and retry behavior.
-- Guarded anchors also make reapplication a no-op.
do $migration$
declare definition text; patch record; old_value text; new_value text;
begin
 for patch in select * from (values
  ('public.shop_api(text,jsonb,text)',
   $old$'instructions','delivery_cents'),'Unsupported order edit field: '$old$,
   $new$'instructions','delivery_cents','delivery_tracking_url'),'Unsupported order edit field: '$new$),
  ('public.shop_api(text,jsonb,text)',
   $old$  perform tlb.validate_contact(merged);$old$,
   $new$  -- TLB_DELIVERY_TRACKING_V1: only a staff edit may set this saved link.
  if changes ? 'delivery_tracking_url' then
   perform tlb.delivery_tracking_url(changes->'delivery_tracking_url');
   perform tlb.require(merged->>'method'='delivery' or coalesce(changes->>'delivery_tracking_url','')='',
     'Delivery tracking links apply to delivery orders only.');
  end if;
  if merged->>'method'='delivery' and merged ? 'delivery_tracking_url' then
   merged:=jsonb_set(merged,'{delivery_tracking_url}',to_jsonb(tlb.delivery_tracking_url(merged->'delivery_tracking_url')));
  elsif merged->>'method'<>'delivery' then merged:=merged-'delivery_tracking_url'; end if;
  perform tlb.validate_contact(merged);$new$),
  ('public.shop_api(text,jsonb,text)',
   $old$ if p_action='approve_payment' then perform tlb.queue_email(oid,'payment_approved','approved:'||oid);$old$,
   $new$ if p_action='edit_order' then perform tlb.queue_delivery_tracking_update(oid,before_order); end if;
 if p_action='approve_payment' then perform tlb.queue_email(oid,'payment_approved','approved:'||oid);$new$),
  ('tlb.order_json(uuid,boolean,boolean)',
   $old$ return o.data || jsonb_build_object('id',o.id$old$,
   $new$ return (case when o.method='delivery' then o.data else o.data-'delivery_tracking_url' end) || jsonb_build_object('id',o.id$new$),
  ('public.shop_service(text,jsonb)',
   $old$   return jsonb_build_object('id',e.id,'event_key',e.event_key$old$,
   $new$   if e.event_type='delivery_tracking_updated' and e.attempts=1 then
    select * into o from tlb.orders where id=e.order_id;
    good:=o.method='delivery' and o.fulfillment_status not in ('cancelled','expired','completed')
      and not o.refund_label and o.data#>>'{buyer,email}'=e.to_email
      and coalesce(o.data->>'delivery_tracking_url','')=coalesce(e.payload#>>'{order,delivery_tracking_url}','');
    if good is distinct from true then
      update tlb.outbox set status='skipped',last_error='Tracking update no longer matches an active delivery.',
        lease_token=null,leased_until=null where id=e.id;
      return jsonb_build_object('skip',true);
    end if;
   end if;
   return jsonb_build_object('id',e.id,'event_key',e.event_key$new$)
 ) as patches(signature,old_text,new_text)
 loop
  definition:=pg_get_functiondef(patch.signature::regprocedure);
  old_value:=replace(patch.old_text,E'\r\n',E'\n');new_value:=replace(patch.new_text,E'\r\n',E'\n');
  if position(E'\r\n' in definition)>0 then old_value:=replace(old_value,chr(10),chr(13)||chr(10));new_value:=replace(new_value,chr(10),chr(13)||chr(10)); end if;
  if position(new_value in definition)>0 then continue; end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
   raise exception 'Unexpected definition for %; review delivery tracking migration.',patch.signature;
  end if;
  execute replace(definition,old_value,new_value);
 end loop;
end $migration$;

commit;
