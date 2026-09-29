begin;

create table tlb.order_backup_connection (
 id boolean primary key default true check(id), spreadsheet_id text,
 enabled boolean not null default false, revision bigint not null default 1,
 synced_revision bigint not null default 0, lease_token uuid, lease_until timestamptz,
 last_attempt_at timestamptz, last_success_at timestamptz, last_error text,
 last_order_count integer, connected_at timestamptz
);
insert into tlb.order_backup_connection(id) values(true);
alter table tlb.order_backup_connection enable row level security;
revoke all on tlb.order_backup_connection from public,anon,authenticated,service_role;

create function tlb.backup_eligible(o tlb.orders) returns boolean
language sql immutable security invoker set search_path='' as $$
 select o.payment_status='paid' and not o.refund_label
 and o.source in ('website','direct_message')
 and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery')
$$;

-- Credentials and customer access links must never enter a recovery file.
create function tlb.backup_redact(value jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(value)='object' then
  select coalesce(jsonb_object_agg(key,tlb.backup_redact(v)),'{}') into result
  from jsonb_each(value) e(key,v) where key not in
   ('access_token','access_digest','access_encrypted','refresh_token','token','request_hash','idempotency_key');
  return result;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(tlb.backup_redact(v) order by n),'[]') into result
  from jsonb_array_elements(value) with ordinality e(v,n);return result;
 end if;
 return value;
end $$;

create function tlb.order_backup_snapshot(p_scope text default 'paid_active') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare orders jsonb;
begin
 perform tlb.require(p_scope in ('paid_active','unserved'),'Choose paid active or all unserved orders.');
 select coalesce(jsonb_agg(tlb.backup_redact(to_jsonb(o)) || jsonb_build_object(
  'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.approved_at,p.id) from tlb.payments p where p.order_id=o.id),'[]'),
  'delivery_payments',coalesce((select jsonb_agg(to_jsonb(p)) from tlb.pos_delivery_payments p where p.order_id=o.id),'[]'),
  'allocations',coalesce((select jsonb_agg(to_jsonb(a) order by a.product_id,a.date) from tlb.allocations a where a.order_id=o.id),'[]'),
  'history',coalesce((select jsonb_agg(tlb.backup_redact(to_jsonb(h)) order by h.id) from tlb.history h where h.order_id=o.id),'[]')
 ) order by o.fulfillment_date,o.created_at,o.id),'[]') into orders
 from tlb.orders o where case when p_scope='paid_active' then tlb.backup_eligible(o)
 else o.source in ('website','direct_message') and not o.refund_label
  and o.fulfillment_status not in ('completed','cancelled','expired') end;
 return jsonb_build_object('format','tlb-order-backup','version',1,'scope',p_scope,
  'generated_at',now(),'timezone','Asia/Manila','currency','PHP','orders',orders,
  'limitations',jsonb_build_array('Operational order recovery data, not a full database restore.',
   'Payment proof paths are included. Image files and customer access tokens are not included.'));
end $$;

create function tlb.order_backup_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'spreadsheet_id',spreadsheet_id,
  'last_attempt_at',last_attempt_at,'last_success_at',last_success_at,'last_error',last_error,
  'last_order_count',last_order_count,'pending',revision>synced_revision,
  'busy',coalesce(lease_until>now(),false),
  'paid_active_count',(select count(*) from tlb.orders o where tlb.backup_eligible(o)),
  'unserved_count',(select count(*) from tlb.orders o where o.source in ('website','direct_message')
    and not o.refund_label and o.fulfillment_status not in ('completed','cancelled','expired')))
 from tlb.order_backup_connection where id
$$;

create function tlb.mark_order_backup_dirty() returns trigger
language plpgsql security invoker set search_path='' as $$
declare changed boolean:=false; oid uuid;
begin
 if tg_table_name='orders' then
  if tg_op<>'INSERT' then changed:=tlb.backup_eligible(old);end if;
  if tg_op<>'DELETE' then changed:=changed or tlb.backup_eligible(new);end if;
 else
  oid:=case when tg_op='DELETE' then old.order_id else new.order_id end;
  select tlb.backup_eligible(o) into changed from tlb.orders o where id=oid;
 end if;
 if changed then update tlb.order_backup_connection set revision=revision+1 where id;end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger tlb_order_backup_changed after insert or update or delete on tlb.orders for each row execute function tlb.mark_order_backup_dirty();
create trigger tlb_order_backup_payment after insert or update or delete on tlb.payments for each row execute function tlb.mark_order_backup_dirty();
create trigger tlb_order_backup_delivery after insert or update or delete on tlb.pos_delivery_payments for each row execute function tlb.mark_order_backup_dirty();
create trigger tlb_order_backup_history after insert or update or delete on tlb.history for each row execute function tlb.mark_order_backup_dirty();
create trigger tlb_order_backup_allocation after insert or update or delete on tlb.allocations for each row execute function tlb.mark_order_backup_dirty();

create function public.order_backup_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform tlb.assert_staff(auth.uid(),true);
 perform tlb.require(tlb.is_verified(auth.uid()),'Verify your owner email first.');
 if p_action='status' then return tlb.order_backup_status();end if;
 if p_action='download' then return tlb.order_backup_snapshot(coalesce(p_payload->>'scope','paid_active'));end if;
 raise exception 'Unknown backup action.';
end $$;
revoke all on function public.order_backup_api(text,jsonb) from public,anon;
grant execute on function public.order_backup_api(text,jsonb) to authenticated;

create function public.order_backup_service(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c tlb.order_backup_connection; token uuid; identifier text;
begin
 if p_action in ('owner_access','connect') then
  perform tlb.assert_staff((p_payload->>'user_id')::uuid,true);
  perform tlb.require(tlb.is_verified((p_payload->>'user_id')::uuid),'Verify your owner email first.');
  if p_action='owner_access' then return jsonb_build_object('allowed',true,'connection',tlb.order_backup_status());end if;
  identifier:=p_payload->>'spreadsheet_id';
  perform tlb.require(identifier ~ '^[A-Za-z0-9_-]{20,150}$','Invalid spreadsheet ID.');
  select * into c from tlb.order_backup_connection where id for update;
  perform tlb.require(c.lease_until is null or c.lease_until<now(),'A backup is running. Try again shortly.');
  perform tlb.require(c.spreadsheet_id is null or c.spreadsheet_id=identifier,'A different backup spreadsheet is already connected.');
  update tlb.order_backup_connection set spreadsheet_id=identifier,enabled=true,revision=revision+1,
   connected_at=now(),last_error=null where id;
  return tlb.order_backup_status();
 end if;
 select * into c from tlb.order_backup_connection where id for update;
 if p_action='begin' then
  if not c.enabled then return jsonb_build_object('skipped','disconnected');end if;
  if c.lease_until>now() then return jsonb_build_object('skipped','busy');end if;
  -- Periodically refresh even without edits, to repair accidentally edited Sheets cells.
  if c.revision=c.synced_revision and c.last_error is null and c.last_success_at>now()-interval '1 day'
    and not coalesce((p_payload->>'force')::boolean,false) then return jsonb_build_object('skipped','unchanged');end if;
  token:=gen_random_uuid();
  update tlb.order_backup_connection set lease_token=token,lease_until=now()+interval '180 seconds',last_attempt_at=now() where id;
  return jsonb_build_object('lease_token',token,'revision',c.revision,'spreadsheet_id',c.spreadsheet_id,
   'snapshot',tlb.order_backup_snapshot());
 end if;
 perform tlb.require(c.lease_token=(p_payload->>'lease_token')::uuid and c.lease_until>now(),'Backup worker lease expired.');
 if p_action='finish' then
  if p_payload->>'error' is null then
   perform tlb.require((p_payload->>'revision')::bigint<=c.revision,'Invalid backup revision.');
   update tlb.order_backup_connection set synced_revision=(p_payload->>'revision')::bigint,
    last_success_at=now(),last_error=null,last_order_count=(p_payload->>'order_count')::int,
    lease_token=null,lease_until=null where id;
  else
   update tlb.order_backup_connection set last_error=case when p_payload->>'error' in
    ('access','api_disabled','configuration','quota','too_large','network') then p_payload->>'error' else 'network' end,
    lease_token=null,lease_until=null where id;
  end if;
  return tlb.order_backup_status();
 end if;
 raise exception 'Unknown backup service action.';
end $$;
revoke all on function public.order_backup_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.order_backup_service(text,jsonb) to service_role;
revoke all on function tlb.backup_eligible(tlb.orders),tlb.backup_redact(jsonb),tlb.order_backup_snapshot(text),
 tlb.order_backup_status(),tlb.mark_order_backup_dirty() from public,anon,authenticated,service_role;
commit;
