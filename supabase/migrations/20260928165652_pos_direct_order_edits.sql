-- Amend a direct order in place. Paid orders remain paid; differences are
-- settled manually. Original payment records and the private order link stay intact.
begin;
set local lock_timeout='3s';
create or replace function tlb.pos_edit_api(p_user uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare o tlb.orders; q jsonb; row_data jsonb; before_order jsonb; prior tlb.action_keys;
 v_key uuid; hashed text; v_email text; notify boolean; reason text; separately_paid boolean;
begin
 perform tlb.assert_staff(p_user);
 perform tlb.require(tlb.is_verified(p_user),'Verify your staff email before using POS.');
 perform tlb.require(p_action in ('pos_preview_edit','pos_update_order','pos_find_edit'),'Unknown direct-order edit action.');
 select * into o from tlb.orders where id=(p_payload->>'order_id')::uuid for update;
 perform tlb.require(o.id is not null and o.source='direct_message','Direct order not found.');
 if p_action='pos_find_edit' then
  if exists(select 1 from tlb.action_keys where user_id=p_user and action='pos_update_order' and key=(p_payload->>'idempotency_key')::uuid and order_id=o.id) then
   return tlb.order_json(o.id,true,true);
  end if;
  return null;
 end if;
 if p_action='pos_update_order' then
  v_key:=(p_payload->>'idempotency_key')::uuid;
  perform tlb.require(v_key is not null,'A unique action key is required.');
  hashed:=encode(extensions.digest((p_payload-'revision')::text,'sha256'),'hex');
  select * into prior from tlb.action_keys where user_id=p_user and action=p_action and key=v_key;
  if found then
   perform tlb.require(prior.order_id=o.id and prior.request_hash=hashed,'This action key belongs to a different request.');
   return tlb.order_json(o.id,true,true);
  end if;
 end if;
 perform tlb.require((p_payload->>'revision')::integer=o.revision,'This order changed. Reopen it to load the latest changes before editing.');
 perform tlb.require(not o.refund_label and o.fulfillment_status not in ('cancelled','expired','completed'),'Closed or completed orders allow client corrections only.');
 perform tlb.require(o.payment_status<>'under_review' and coalesce(o.data->>'delivery_payment_status','')<>'under_review','Review the submitted payment proof before changing this order.');
 perform tlb.require(p_payload->>'source'='direct_message','Only direct orders can be edited here.');
 q:=tlb.pos_quote(p_payload,p_user,o.id);
 -- A known, separately collected courier fee stays separate during an edit.
 -- Its paid state is backed by the existing payment row, never a client flag.
 select exists(select 1 from tlb.pos_delivery_payments where order_id=o.id) into separately_paid;
 if o.data->'deferred_delivery'='true'::jsonb and q->>'method'='delivery' then
  perform tlb.require(not separately_paid or q->'deferred_delivery'<>'true'::jsonb,'A paid delivery fee cannot become pending. Enter its revised amount and settle any difference manually.');
  q:=q||jsonb_build_object('deferred_delivery',true,'delivery_payment_status',case when separately_paid then 'paid' when q->'deferred_delivery'='true'::jsonb then 'pending' when (q->>'delivery_cents')::bigint=0 then 'paid' else 'awaiting_payment' end);
 end if;
 v_email:=lower(trim(coalesce(p_payload#>>'{buyer,email}','')));
 notify:=coalesce((p_payload->>'email_notifications')::boolean,false);
 perform tlb.require(v_email='' or (length(v_email)<=254 and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),'Enter a valid client email.');
 perform tlb.require(not notify or v_email<>'','Enter an email address to send confirmations.');
 perform tlb.require(length(coalesce(p_payload#>>'{buyer,name}',''))<=200 and length(coalesce(p_payload#>>'{buyer,phone}',''))<=40 and length(coalesce(p_payload#>>'{buyer,social_platform}',''))<=40 and length(coalesce(p_payload#>>'{buyer,social_username}',''))<=100,'Client details are too long.');
 perform tlb.require(length(coalesce(p_payload#>>'{recipient,name}',''))<=200 and length(coalesce(p_payload#>>'{recipient,phone}',''))<=40 and length(coalesce(p_payload#>>'{address,line1}',''))<=1000,'Delivery details are too long.');
 perform tlb.require(length(coalesce(p_payload->>'instructions',''))<=2000,'Order notes must be at most 2000 characters.');
 reason:=coalesce(nullif(trim(p_payload->>'reason'),''),'N/A');
 perform tlb.require(length(reason)<=4000,'The edit reason must be at most 4000 characters.');
 if p_action='pos_preview_edit' then return q; end if;
 perform tlb.require(p_payload->'expected_quote'=q,'Prices or availability changed. Review the latest order total before saving.');
 before_order:=tlb.order_json(o.id,true,false)-'history';
 row_data:=o.data||q||jsonb_build_object(
  'buyer',jsonb_build_object('name',coalesce(trim(p_payload#>>'{buyer,name}'),''),'email',v_email,'phone',coalesce(p_payload#>>'{buyer,phone}',''),'social_platform',coalesce(p_payload#>>'{buyer,social_platform}',''),'social_username',coalesce(p_payload#>>'{buyer,social_username}','')),
  'recipient',jsonb_build_object('name',coalesce(p_payload#>>'{recipient,name}',''),'phone',coalesce(p_payload#>>'{recipient,phone}','')),
  'address',jsonb_build_object('line1',coalesce(p_payload#>>'{address,line1}','')),'instructions',coalesce(p_payload->>'instructions',''),'email_notifications',notify,
  'discount',p_payload->'discount','override_dates',coalesce((p_payload->>'override_dates')::boolean,false),'override_reason',left(coalesce(p_payload->>'override_reason',''),500));
 if q->>'method'<>'delivery' then row_data:=row_data-'delivery_tracking_url'; end if;
 update tlb.orders set data=row_data,fulfillment_date=(q->>'fulfillment_date')::date,method=q->>'method',revision=revision+1 where id=o.id;
 -- Quote excludes this order's current reservation. Replace only its website
 -- allocations in the same serialized shop transaction; custom items have none.
 delete from tlb.allocations where order_id=o.id;
 insert into tlb.allocations(order_id,product_id,date,quantity,state)
 select o.id,(v->>'product_id')::uuid,(q->>'fulfillment_date')::date,sum((v->>'quantity')::integer),case when o.payment_status='paid' then 'committed' else 'held' end
 from jsonb_array_elements(q->'items') v where v->>'product_id' is not null group by v->>'product_id';
 perform tlb.audit(o.id,p_user,'pos_order_updated',reason,before_order,tlb.order_json(o.id,true,false)-'history');
 insert into tlb.action_keys(user_id,action,key,order_id,request_hash) values(p_user,p_action,v_key,o.id,hashed);
 -- Uncertain deliveries retain their payload and provider idempotency key.
 update tlb.outbox set status='skipped',last_error='Superseded by a direct-order amendment.'
  where order_id=o.id and status='pending' and attempts=0 and first_attempt_at is null and event_type<>'order_review_required';
 perform tlb.queue_email(o.id,case when o.payment_status='paid' then 'order_amended' else 'order_submitted' end,'pos-edit:'||o.id||':'||(o.revision+1),null,before_order);
 return tlb.order_json(o.id,true,true);
end $$;
revoke all on function tlb.pos_edit_api(uuid,text,jsonb) from public,anon,authenticated,service_role;

do $$
declare def text:=pg_get_functiondef('tlb.pos_api(uuid,text,jsonb)'::regprocedure);
 marker text:=$m$ if p_action in ('pos_cash_open'$m$;
 route text:=$r$ if p_action in ('pos_preview_edit','pos_update_order','pos_find_edit') then return tlb.pos_edit_api(p_user,p_action,p_payload); end if;
$r$;
begin
 if position('tlb.pos_edit_api(p_user,p_action,p_payload)' in def)=0 then
  perform tlb.require(position(marker in def)>0,'POS edit migration marker missing.');
  execute replace(def,marker,route||marker);
 end if;
end $$;
commit;
