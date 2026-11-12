begin;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('order-photos', 'order-photos', false, 26214400, array['image/jpeg','image/png','image/webp','image/heic']);

create table tlb.order_photos (
  id uuid primary key,
  order_id uuid not null references tlb.orders(id) on delete cascade,
  storage_path text not null unique,
  filename text not null check (length(filename) between 1 and 180),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (order_id, sha256)
);
alter table tlb.order_photos enable row level security;
revoke all on tlb.order_photos from public, anon, authenticated, service_role;

create table tlb.order_photo_shares (
  order_id uuid primary key references tlb.orders(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(32),'hex')
);
alter table tlb.order_photo_shares enable row level security;
revoke all on tlb.order_photo_shares from public, anon, authenticated, service_role;

-- The dashboard calendar payload carries a count. The sync queue separately
-- gets a capability scoped to the photo album.
create or replace function tlb.calendar_order(o tlb.orders) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when o.payment_status='paid' and not o.refund_label
  and o.source in ('website','direct_message')
  and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed') then
 jsonb_build_object('id',o.id,'reference',o.reference,'date',o.fulfillment_date,'method',o.method,
  'status',o.fulfillment_status,'total_cents',o.data->'total_cents',
  'buyer',jsonb_build_object('name',o.data#>>'{buyer,name}','phone',o.data#>>'{buyer,phone}','email',o.data#>>'{buyer,email}',
   'social_platform',o.data#>>'{buyer,social_platform}','social_username',o.data#>>'{buyer,social_username}'),
  'recipient',jsonb_build_object('name',o.data#>>'{recipient,name}','phone',o.data#>>'{recipient,phone}'),
  'address',jsonb_build_object('line1',o.data#>>'{address,line1}','line2',o.data#>>'{address,line2}',
   'locality',o.data#>>'{address,locality}','postal_code',o.data#>>'{address,postal_code}'),
  'instructions',o.data->>'instructions','pickup_address',o.data->>'pickup_address',
  'photo_count',(select count(*) from tlb.order_photos where order_id=o.id),
  'window',case when o.method='pickup' then o.data->>'pickup_hours' else o.data->>'delivery_window' end,
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',v->>'name','quantity',v->'quantity','description',v->>'description',
   'selection_labels',coalesce(v->'selection_labels','[]'::jsonb),'flavor_contents',coalesce(v->'flavor_contents','[]'::jsonb)))
   from jsonb_array_elements(coalesce(o.data->'items','[]')) v),'[]'::jsonb)) end
$$;

create function tlb.refresh_calendar_order(oid uuid, payload jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare changed integer; photo_token text;
begin
  if payload is not null and (payload->>'photo_count')::integer>0 then
    select token into photo_token from tlb.order_photo_shares where order_id=oid;
    if found then payload:=payload||jsonb_build_object('photo_share',photo_token); end if;
  end if;
  -- Match the worker's lock order.
  perform 1 from tlb.calendar_connection where id for update;
  if payload is not null or exists(select 1 from tlb.calendar_events where order_id=oid) then
    insert into tlb.calendar_events(order_id,desired,event_id)
    values(oid,payload,'tlb'||replace(oid::text,'-','')||'g0')
    on conflict(order_id) do update set desired=excluded.desired,
      revision=tlb.calendar_events.revision+1,next_attempt_at=clock_timestamp(),
      attempts=0,last_error=null,updated_at=clock_timestamp()
    where tlb.calendar_events.desired is distinct from excluded.desired;
    get diagnostics changed=row_count;
    if changed>0 then
      begin perform tlb.calendar_wake(); exception when others then null; end;
    end if;
  end if;
end $$;

create or replace function tlb.queue_calendar_order() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    perform tlb.refresh_calendar_order(old.id,null);
    return old;
  end if;
  perform tlb.refresh_calendar_order(new.id,tlb.calendar_order(new));
  return new;
end $$;

create function tlb.order_photo_service(p_action text, p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  actor_id uuid := (p_payload->>'user_id')::uuid;
  oid uuid := (p_payload->>'order_id')::uuid;
  photo_id uuid := (p_payload->>'photo_id')::uuid;
  digest text := p_payload->>'sha256';
  path text := p_payload->>'storage_path';
  suffix text;
  o tlb.orders;
  photo tlb.order_photos;
begin
  perform tlb.assert_staff(actor_id,false);
  perform tlb.require(tlb.is_verified(actor_id),'Verify your staff email to manage order photos.');
  -- Serialize mutations and follow-up reads for a single order.
  select * into o from tlb.orders where id=oid and source='direct_message' for update;
  perform tlb.require(found,'Direct order not found.');
  if p_action='order_photo_list' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'filename',filename,'storage_path',storage_path,'sha256',sha256
    ) order by created_at,id),'[]'::jsonb) from tlb.order_photos where order_id=oid);
  elsif p_action='order_photo_attach' then
    select * into photo from tlb.order_photos where order_id=oid and sha256=digest;
    if found then
      return jsonb_build_object('id',photo.id,'accepted',photo.storage_path=path);
    end if;
    suffix := case p_payload->>'mime_type'
      when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
      when 'image/webp' then 'webp' when 'image/heic' then 'heic' end;
    perform tlb.require(path=oid::text||'/'||photo_id::text||'.'||suffix
      and digest ~ '^[0-9a-f]{64}$','Invalid order photo.');
    perform tlb.require((select count(*)<8 from tlb.order_photos where order_id=oid),'An order can have up to 8 photos.');
    perform tlb.require(exists(select 1 from storage.objects where bucket_id='order-photos' and name=path),'The photo upload is missing.');
    insert into tlb.order_photos(id,order_id,storage_path,filename,sha256)
    values(photo_id,oid,path,p_payload->>'filename',digest);
    insert into tlb.order_photo_shares(order_id) values(oid) on conflict(order_id) do nothing;
    perform tlb.audit(oid,actor_id,'order_photo_added','Order photo added.',null,null,true);
    perform tlb.refresh_calendar_order(oid,tlb.calendar_order(o));
    return jsonb_build_object('id',photo_id,'accepted',true);
  elsif p_action='order_photo_detach' then
    delete from tlb.order_photos where id=photo_id and order_id=oid returning * into photo;
    if found then
      delete from tlb.order_photo_shares where order_id=oid
        and not exists(select 1 from tlb.order_photos where order_id=oid);
      perform tlb.audit(oid,actor_id,'order_photo_removed','Order photo removed.',null,null,true);
      perform tlb.refresh_calendar_order(oid,tlb.calendar_order(o));
    end if;
    return jsonb_build_object('storage_path',photo.storage_path);
  end if;
  raise exception 'Unknown order photo action.' using errcode='22023';
end $$;

create function tlb.shared_order_photos(p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'storage_path',p.storage_path)
    order by p.created_at,p.id),'[]'::jsonb)
  from tlb.order_photo_shares s join tlb.order_photos p using(order_id)
  where length(p_token)=64 and s.token=p_token
$$;

create function tlb.add_private_order_email(p_payload jsonb, p_token text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  oid uuid := (p_payload->>'order_id')::uuid;
  email text := lower(btrim(p_payload->>'email'));
  existing_email text;
  o tlb.orders;
begin
  -- The link must authorize this specific order, even for signed-in users.
  if coalesce(length(p_token),0) not between 40 and 256 then
    raise exception 'Order access not authorized.' using errcode='42501';
  end if;
  select * into o from tlb.orders where id=oid and source='direct_message'
    and access_digest=extensions.digest(p_token,'sha256') for update;
  if not found then
    raise exception 'Order access not authorized.' using errcode='42501';
  end if;
  perform tlb.require(length(email)<=254 and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$',
    'Enter a valid email address.');
  existing_email := lower(btrim(coalesce(o.data#>>'{buyer,email}','')));
  if existing_email<>'' then
    perform tlb.require(existing_email=email and o.data->'email_notifications'='true'::jsonb,
      'This order already has an email address.');
  else
    update tlb.orders set data=o.data||jsonb_build_object(
      'buyer',(case when jsonb_typeof(o.data->'buyer')='object' then o.data->'buyer' else '{}'::jsonb end)
        ||jsonb_build_object('email',email),
      'email_notifications',true
    ),revision=o.revision+1 where id=oid;
    perform tlb.audit(oid,auth.uid(),'order_email_added','Email updates enabled from the private order link.',null,null,true);
  end if;
  return jsonb_build_object('email',email,'email_notifications',true);
end $$;

revoke all on function tlb.refresh_calendar_order(uuid,jsonb),
  tlb.order_photo_service(text,jsonb), tlb.shared_order_photos(text), tlb.add_private_order_email(jsonb,text)
from public, anon, authenticated, service_role;

-- Extend the existing public and service-only dispatchers, preserving grants.
do $migration$
declare definition text; hook text;
begin
  definition := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  hook := $hook$ elsif p_action='get_order' then$hook$;
  perform tlb.require(strpos(definition,hook)>0,'Missing shop order dispatch.');
  execute replace(definition,hook,
    $route$ elsif p_action='add_order_email' then
  return tlb.add_private_order_email(p_payload,p_token);
$route$||hook);

  definition := pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
  hook := $hook$ if p_action in ('authorize_upload','commit_proof','authorize_proof_read') then$hook$;
  perform tlb.require(strpos(definition,hook)>0,'Missing shop service upload dispatch.');
  execute replace(definition,hook,
    $route$ if p_action in ('order_photo_list','order_photo_attach','order_photo_detach') then
  return tlb.order_photo_service(p_action,p_payload);
 end if;
 if p_action='order_photo_shared' then
  return tlb.shared_order_photos(p_payload->>'token');
 end if;
$route$||hook);
end $migration$;

-- Refresh previously synced orders whose notes now appear in the event.
update tlb.calendar_events
set revision=revision+1, next_attempt_at=clock_timestamp(), attempts=0,
  last_error=null, updated_at=clock_timestamp()
where nullif(btrim(desired->>'instructions'),'') is not null;

commit;
