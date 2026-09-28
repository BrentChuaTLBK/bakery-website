-- DM customers can pay products first; the exact courier fee is settled later.
begin;
set local lock_timeout='3s';
create table tlb.pos_delivery_payments (
 order_id uuid primary key references tlb.orders(id), amount_cents integer not null check(amount_cents>0),
 method text not null check(method in ('cash','gcash','bdo','eastwest')),
 received_cents integer not null, change_cents integer not null check(change_cents>=0),
 reference text not null default '',proof_path text not null default '',
 approved_by uuid not null references auth.users(id), approved_at timestamptz not null default clock_timestamp(),
 check(received_cents-change_cents=amount_cents)
);
create index pos_delivery_payments_approver on tlb.pos_delivery_payments(approved_by);
alter table tlb.pos_delivery_payments enable row level security;
revoke all on tlb.pos_delivery_payments from public,anon,authenticated,service_role;

create function tlb.pos_delivery_api(p_user uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare o tlb.orders; v_key uuid; hashed text; prior tlb.action_keys; before_order jsonb;
 fee bigint; total bigint; paid bigint; received bigint; method_value text; reason text; event text;
begin
 perform tlb.assert_staff(p_user);perform tlb.require(tlb.is_verified(p_user),'Verify your staff email before using POS.');
 perform tlb.require(p_action in ('pos_delivery_fee','pos_delivery_payment','pos_delivery_reject'),'Unknown delivery action.');
 select * into o from tlb.orders where id=(p_payload->>'order_id')::uuid for update;
 perform tlb.require(o.id is not null and o.source='direct_message' and o.method='delivery' and o.data->'deferred_delivery'='true'::jsonb,'This order does not use a separately collected delivery fee.');
 v_key:=(p_payload->>'idempotency_key')::uuid;perform tlb.require(v_key is not null,'A unique action key is required.');
 hashed:=encode(extensions.digest((p_payload-'revision')::text,'sha256'),'hex');
 select * into prior from tlb.action_keys where user_id=p_user and action=p_action and key=v_key;
 if found then
  perform tlb.require(prior.order_id=o.id and prior.request_hash=hashed,'This action key belongs to a different request.');
  return tlb.order_json(o.id,true,true);
 end if;
 perform tlb.require((p_payload->>'revision')::integer=o.revision,'This order changed. Refresh before saving.');
 perform tlb.require(not o.refund_label and o.fulfillment_status not in ('cancelled','expired'),'Closed or refunded orders cannot collect delivery fees.');
 before_order:=tlb.order_json(o.id,true,false)-'history';
 fee:=coalesce((o.data->>'delivery_cents')::bigint,0);
 if p_action='pos_delivery_fee' then
  perform tlb.require(o.data->>'delivery_payment_status'<>'under_review','Review the submitted delivery proof before changing the fee.');
  perform tlb.require(not exists(select 1 from tlb.pos_delivery_payments where order_id=o.id),'Delivery is already paid. Its recorded charge cannot be changed.');
  fee:=tlb.pos_integer(p_payload->'amount_cents',100000000,'Enter the exact delivery fee.');
  total:=(o.data->>'subtotal_cents')::bigint-(o.data->>'discount_cents')::bigint+fee;
  perform tlb.require(total<=1000000000,'Order total exceeds the supported amount.');
  reason:=left(trim(coalesce(p_payload->>'note','')),500);
  update tlb.orders set data=data||jsonb_build_object('delivery_cents',fee,'total_cents',total,'delivery_payment_status',case when fee=0 then 'paid' else 'awaiting_payment' end,'delivery_fee_note',reason),revision=revision+1 where id=o.id;
  event:='delivery_fee_due';
 elsif p_action='pos_delivery_payment' then
  perform tlb.require(o.payment_status='paid' and o.data->>'delivery_payment_status' in ('awaiting_payment','under_review') and fee>0,'Pay the products first, then record the full delivery fee.');
  method_value:=p_payload#>>'{payment,method}';perform tlb.require(method_value in ('cash','gcash','bdo','eastwest'),'Choose Cash, GCash, BDO or EastWest.');
  paid:=tlb.pos_integer(p_payload#>'{payment,amount_cents}',100000000,'Confirm the full delivery payment.');
  perform tlb.require(paid=fee,'Record the exact delivery fee in full.');
  received:=case when method_value='cash' then tlb.pos_integer(p_payload#>'{payment,received_cents}',1000000000,'Enter the cash received.') else paid end;
  perform tlb.require(received>=paid,'Cash received must cover the full delivery fee.');
  insert into tlb.pos_delivery_payments(order_id,amount_cents,method,received_cents,change_cents,reference,proof_path,approved_by)
  values(o.id,paid,method_value,received,received-paid,left(coalesce(nullif(p_payload#>>'{payment,reference}',''),o.data->>'delivery_payment_reference',''),200),case when o.data->>'proof_stage'='delivery' then coalesce(o.proof_path,'') else '' end,p_user);
  update tlb.orders set data=data||jsonb_build_object('delivery_payment_status','paid','delivery_paid_cents',paid,'delivery_payment_method',method_value,'delivery_cash_received_cents',case when method_value='cash' then received end,'delivery_change_cents',case when method_value='cash' then received-paid end),revision=revision+1 where id=o.id;
  event:='delivery_fee_paid';
 else
  perform tlb.require(o.data->>'delivery_payment_status'='under_review','Only a delivery payment under review can be rejected.');
  reason:=trim(p_payload->>'reason');perform tlb.require(length(reason) between 3 and 500,'Explain why the delivery proof needs to be replaced.');
  update tlb.orders set proof_path=(select nullif(proof_path,'') from tlb.payments where order_id=o.id),data=data||jsonb_build_object('delivery_payment_status','awaiting_payment','proof_stage','products'),revision=revision+1 where id=o.id;
  event:='delivery_fee_due';
 end if;
 perform tlb.audit(o.id,p_user,p_action,reason,before_order,tlb.order_json(o.id,true,false)-'history');
 insert into tlb.action_keys(user_id,action,key,order_id,request_hash) values(p_user,p_action,v_key,o.id,hashed);
 perform tlb.queue_email(o.id,event,event||':'||o.id||':'||(o.revision+1));
 return tlb.order_json(o.id,true,true);
end $$;

-- Authorize and commit the explicit payment stage independently. The amount is
-- checked twice, so a revised fee cannot reuse proof uploaded for an older fee.
create function tlb.pos_delivery_proof(p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare o tlb.orders; path text; reference_value text;
begin
 select * into o from tlb.orders where id=(p_payload->>'order_id')::uuid for update;
 perform tlb.require(coalesce(tlb.can_access(o,(p_payload->>'user_id')::uuid,p_payload->>'token'),false),'Order access not authorized.');
 perform tlb.require(o.source='direct_message' and o.method='delivery' and o.data->'deferred_delivery'='true'::jsonb and o.payment_status='paid' and o.data->>'delivery_payment_status'='awaiting_payment' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired'),'Delivery proof is not accepted for this order right now.');
 perform tlb.require((p_payload->>'delivery_fee_cents')::bigint=(o.data->>'delivery_cents')::bigint,'The delivery fee changed. Refresh the order before uploading proof.');
 if p_action='authorize_upload' then return jsonb_build_object('allowed',true,'order_id',o.id); end if;
 path:=p_payload->>'path';reference_value:=coalesce(p_payload->>'payment_reference','');
 perform tlb.require(path ~ ('^'||o.id::text||'/[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$'),'Invalid payment proof path.');
 perform tlb.require(length(reference_value)<=200,'Payment reference is too long.');
 update tlb.orders set proof_path=path,data=data||jsonb_build_object('delivery_payment_status','under_review','proof_stage','delivery','delivery_payment_reference',reference_value),revision=revision+1 where id=o.id;
 perform tlb.audit(o.id,(p_payload->>'user_id')::uuid,'delivery_proof_submitted','Delivery payment proof received for staff review.');
 perform tlb.queue_order_review_emails(o.id);
 return tlb.order_json(o.id,false,false);
end $$;

do $$ declare def text; p record; begin
 for p in select * from (values
 ('tlb.queue_order_review_emails(uuid)',
  'o.payment_status=''under_review'' and o.fulfillment_status=''pending_confirmation''',
  '((o.payment_status=''under_review'' and o.fulfillment_status=''pending_confirmation'') or (o.source=''direct_message'' and o.payment_status=''paid'' and o.data->>''delivery_payment_status''=''under_review'' and not o.refund_label and o.fulfillment_status not in (''cancelled'',''expired'')))'),
 ('tlb.queue_order_review_emails(uuid)',
  '  for recipient in',
  '  if o.data->>''proof_stage''=''delivery'' then summary:=summary||jsonb_build_object(''proof_stage'',''delivery''); end if; for recipient in'),
 ('public.shop_service(text,jsonb)',
  'if o.payment_status<>''under_review'' or o.fulfillment_status<>''pending_confirmation'' then',
  'if (case when e.payload#>>''{order,proof_stage}''=''delivery'' then not (o.source=''direct_message'' and o.payment_status=''paid'' and o.data->>''delivery_payment_status''=''under_review'' and not o.refund_label and o.fulfillment_status not in (''cancelled'',''expired'')) else o.payment_status<>''under_review'' or o.fulfillment_status<>''pending_confirmation'' end) then'),
 ('public.shop_api(text,jsonb,text)',
  '  insert into tlb.payments(order_id,amount_cents,proof_path,payment_reference,approved_by) values(oid,',
  '  perform tlb.require(o.source=''website'',''Use Point of sale to record this payment and its payment method.''); insert into tlb.payments(order_id,amount_cents,proof_path,payment_reference,approved_by) values(oid,'),
 ('public.shop_api(text,jsonb,text)',
  ' if left(p_action,4)=''pos_'' then',
  ' if p_action in (''pos_delivery_fee'',''pos_delivery_payment'',''pos_delivery_reject'') then return tlb.pos_delivery_api(u,p_action,p_payload); end if; if left(p_action,4)=''pos_'' then'),
 ('tlb.pos_quote(jsonb,uuid,uuid)',
  '  delivery:=tlb.pos_integer(p_payload->''delivery_cents'',100000000,''Enter a valid delivery fee.'');',
  '  delivery:=case when coalesce((p_payload->>''delivery_fee_pending'')::boolean,false) then 0 else tlb.pos_integer(p_payload->''delivery_cents'',100000000,''Enter a valid delivery fee.'') end;'),
 ('tlb.pos_quote(jsonb,uuid,uuid)',
  ' return jsonb_build_object(''source'',channel',
  ' return jsonb_build_object(''deferred_delivery'',channel=''direct_message'' and method=''delivery'' and coalesce((p_payload->>''delivery_fee_pending'')::boolean,false),''delivery_payment_status'',case when channel=''direct_message'' and method=''delivery'' and coalesce((p_payload->>''delivery_fee_pending'')::boolean,false) then ''pending'' else null end,''source'',channel'),
 ('tlb.pos_receive_payment(uuid,uuid,jsonb)',
  ' total:=(o.data->>''total_cents'')::bigint;',
  ' total:=(o.data->>''total_cents'')::bigint-case when o.data->''deferred_delivery''=''true''::jsonb then (o.data->>''delivery_cents'')::bigint else 0 end;'),
 ('tlb.accounting_sync_order(uuid,jsonb,timestamptz,boolean)',
  '  delivery:=coalesce((p_snapshot->>''delivery_cents'')::bigint,0);',
  '  delivery:=case when p_snapshot->''deferred_delivery''=''true''::jsonb and p_snapshot->>''delivery_payment_status''<>''paid'' then 0 else coalesce((p_snapshot->>''delivery_cents'')::bigint,0) end;'),
 ('tlb.accounting_rows_v2(date,date)',
  'coalesce(o.data->>''payment_method'','''')',
  'case when c.system_key=''delivery_fee'' and o.data->''deferred_delivery''=''true''::jsonb then coalesce(o.data->>''delivery_payment_method'','''') else coalesce(o.data->>''payment_method'','''') end'),
 ('public.shop_service(text,jsonb)',
  ' if p_action in (''authorize_upload'',''commit_proof'',''authorize_proof_read'') then',
  ' if p_action in (''authorize_upload'',''commit_proof'') and p_payload->>''payment_stage''=''delivery'' then return tlb.pos_delivery_proof(p_action,p_payload); end if; if p_action in (''authorize_upload'',''commit_proof'',''authorize_proof_read'') then')
 ) patches(signature,old_text,new_text) loop
  def:=pg_get_functiondef(p.signature::regprocedure);
  perform tlb.require(position(p.old_text in def)>0,'Deferred delivery migration marker missing: '||p.signature);
  execute replace(def,p.old_text,p.new_text);
 end loop;
end $$;
revoke all on function tlb.pos_delivery_api(uuid,text,jsonb),tlb.pos_delivery_proof(text,jsonb) from public,anon,authenticated,service_role;
commit;
