begin;
set local lock_timeout='3s';

-- Delivery receipts only. Inquiry text and photos go directly to email and are
-- not stored in the database or a public bucket. Keep IDs to prevent old replays.
create table tlb.cake_inquiry_deliveries (
 id uuid primary key,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 email_hash text not null check(email_hash ~ '^[a-f0-9]{64}$'),
 ip_hash text not null check(ip_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 lease_token uuid not null,
 lease_until timestamptz not null,
 accepted_at timestamptz,
 provider_id text
);
create index cake_inquiry_created on tlb.cake_inquiry_deliveries(created_at);
create index cake_inquiry_email on tlb.cake_inquiry_deliveries(email_hash,created_at);
create index cake_inquiry_ip on tlb.cake_inquiry_deliveries(ip_hash,created_at);
alter table tlb.cake_inquiry_deliveries enable row level security;
revoke all on tlb.cake_inquiry_deliveries from public,anon,authenticated,service_role;

create function public.cake_inquiry_service(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r tlb.cake_inquiry_deliveries; request_id uuid:=(p_payload->>'id')::uuid; token uuid:=gen_random_uuid();
begin
 if p_action='claim' then
  if coalesce(p_payload->>'fingerprint','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_payload->>'email_hash','') !~ '^[a-f0-9]{64}$'
   or coalesce(p_payload->>'ip_hash','') !~ '^[a-f0-9]{64}$' or request_id is null then
   raise exception 'Invalid inquiry receipt.';
  end if;
  -- Serialize the small public-form quota and reservation in one transaction.
  perform pg_advisory_xact_lock(83241,1701);
  select * into r from tlb.cake_inquiry_deliveries where id=request_id for update;
  if found then
   if r.fingerprint<>p_payload->>'fingerprint' then return jsonb_build_object('state','conflict'); end if;
   if r.accepted_at is not null then return jsonb_build_object('state','accepted'); end if;
   -- The provider keeps idempotency keys for 24h. Never resend outside that window.
   if r.created_at<now()-interval '23 hours' then return jsonb_build_object('state','expired'); end if;
   if r.lease_until>now() then return jsonb_build_object('state','busy'); end if;
   update tlb.cake_inquiry_deliveries set lease_token=token,lease_until=now()+interval '60 seconds' where id=request_id;
  else
   if (select count(*) from tlb.cake_inquiry_deliveries where created_at>now()-interval '1 day')>=50
    or (select count(*) from tlb.cake_inquiry_deliveries where created_at>now()-interval '1 hour' and ip_hash=p_payload->>'ip_hash')>=5
    or (select count(*) from tlb.cake_inquiry_deliveries where created_at>now()-interval '1 day' and email_hash=p_payload->>'email_hash')>=3 then
    return jsonb_build_object('state','limited');
   end if;
   insert into tlb.cake_inquiry_deliveries(id,fingerprint,email_hash,ip_hash,lease_token,lease_until)
    values(request_id,p_payload->>'fingerprint',p_payload->>'email_hash',p_payload->>'ip_hash',token,now()+interval '60 seconds');
  end if;
  return jsonb_build_object('state','claimed','lease_token',token);
 elsif p_action='accepted' then
  if length(coalesce(p_payload->>'provider_id','')) not between 1 and 100 then raise exception 'Invalid delivery receipt.'; end if;
  update tlb.cake_inquiry_deliveries set accepted_at=coalesce(accepted_at,now()),provider_id=p_payload->>'provider_id'
   where id=request_id and lease_token=(p_payload->>'lease_token')::uuid;
  if not found then raise exception 'Inquiry receipt changed.'; end if;
  return jsonb_build_object('state','accepted');
 end if;
 raise exception 'Unknown inquiry action.';
end;
$$;
revoke all on function public.cake_inquiry_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.cake_inquiry_service(text,jsonb) to service_role;
comment on function public.cake_inquiry_service(text,jsonb) is 'Private delivery reservation for the public cake inquiry Edge Function; never called from browsers.';
commit;
