begin;

create table tlb.calendar_connection (
 id boolean primary key default true check(id), calendar_id text, calendar_name text,
 enabled boolean not null default false, connected_by uuid, connected_at timestamptz,
 sync_token text, page_token text, worker_token uuid, worker_until timestamptz,
 last_dispatch_at timestamptz, last_success_at timestamptz, last_error text,
 configured boolean not null default false, service_account_email text
);
insert into tlb.calendar_connection(id) values(true);
-- No order FK: a deleted order must leave a tombstone until Google is updated.
create table tlb.calendar_events (
 order_id uuid primary key, desired jsonb, revision bigint not null default 1,
 synced_revision bigint not null default 0, generation integer not null default 0,
 event_id text not null unique, etag text, attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(), last_error text,
 updated_at timestamptz not null default now(), synced_at timestamptz
);
create index calendar_events_pending on tlb.calendar_events(next_attempt_at,updated_at) where revision>synced_revision;
alter table tlb.calendar_connection enable row level security;
alter table tlb.calendar_events enable row level security;
revoke all on tlb.calendar_connection,tlb.calendar_events from public,anon,authenticated,service_role;

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
  'window',case when o.method='pickup' then o.data->>'pickup_hours' else o.data->>'delivery_window' end,
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',v->>'name','quantity',v->'quantity','description',v->>'description',
   'selection_labels',coalesce(v->'selection_labels','[]'::jsonb),'flavor_contents',coalesce(v->'flavor_contents','[]'::jsonb)))
   from jsonb_array_elements(coalesce(o.data->'items','[]')) v),'[]'::jsonb)) end
$$;

-- Replaced by the hosted migration. Queue writes work without pg_net locally.
create function tlb.calendar_wake() returns void language plpgsql security invoker set search_path='' as $$ begin return; end $$;

create function tlb.queue_calendar_order() returns trigger
language plpgsql security invoker set search_path='' as $$
declare oid uuid; payload jsonb; changed integer;
begin
 oid:=case when tg_op='DELETE' then old.id else new.id end;
 if tg_op<>'DELETE' then payload:=tlb.calendar_order(new); end if;
 -- Keep lock ordering consistent with the worker: connection, then event.
 perform 1 from tlb.calendar_connection where id for update;
 if payload is not null or exists(select 1 from tlb.calendar_events where order_id=oid) then
  insert into tlb.calendar_events(order_id,desired,event_id) values(oid,payload,'tlb'||replace(oid::text,'-','')||'g0')
  on conflict(order_id) do update set desired=excluded.desired,revision=tlb.calendar_events.revision+1,
   next_attempt_at=clock_timestamp(),attempts=0,last_error=null,updated_at=clock_timestamp()
  where tlb.calendar_events.desired is distinct from excluded.desired;
  get diagnostics changed=row_count;
  if changed>0 then
   begin perform tlb.calendar_wake(); exception when others then null; end;
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger tlb_queue_calendar_order after insert or update or delete on tlb.orders
 for each row execute function tlb.queue_calendar_order();

insert into tlb.calendar_events(order_id,desired,event_id)
select o.id,tlb.calendar_order(o),'tlb'||replace(o.id::text,'-','')||'g0' from tlb.orders o where tlb.calendar_order(o) is not null;

create function tlb.calendar_status() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('connected',enabled and calendar_id is not null,'calendar_id',calendar_id,
  'calendar_name',calendar_name,'configured',configured,'service_account_email',service_account_email,'last_success_at',last_success_at,'last_error',last_error,
  'pending',(select count(*) from tlb.calendar_events where revision>synced_revision),
  'failed',(select count(*) from tlb.calendar_events where revision>synced_revision and last_error is not null))
 from tlb.calendar_connection where id
$$;

create function tlb.calendar_admin(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare first_date date;last_date date; entries jsonb;total integer;
begin
 perform tlb.assert_staff(auth.uid(),false);
 perform tlb.require(tlb.is_verified(auth.uid()),'Verify your staff email before viewing the calendar.');
 if p_action='calendar_sync_now' then
  perform 1 from tlb.calendar_connection where id for update;
  update tlb.calendar_events set next_attempt_at=clock_timestamp() where revision>synced_revision;
  perform tlb.calendar_wake(); return tlb.calendar_status();
 end if;
 first_date:=(p_payload->>'from')::date;last_date:=(p_payload->>'to')::date;
 perform tlb.require(first_date is not null and last_date is not null and last_date>=first_date and last_date-first_date<=62,'Choose up to 63 calendar days.');
 select count(*) into total from tlb.orders o where o.fulfillment_date between first_date and last_date and tlb.calendar_order(o) is not null;
 perform tlb.require(total<=5000,'Choose a shorter calendar range to load these orders.');
 select coalesce(jsonb_agg(tlb.calendar_order(o)||jsonb_build_object('sync_state',case when e.revision=e.synced_revision then 'synced' when e.last_error is not null then 'retrying' else 'pending' end)
  order by o.fulfillment_date,o.method,o.data#>>'{address,locality}',o.reference),'[]') into entries
 from tlb.orders o left join tlb.calendar_events e on e.order_id=o.id
 where o.fulfillment_date between first_date and last_date and tlb.calendar_order(o) is not null;
 return jsonb_build_object('orders',entries,'connection',tlb.calendar_status(),'server_time',clock_timestamp());
end $$;

create function tlb.calendar_service(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c tlb.calendar_connection; e tlb.calendar_events; token uuid; entries jsonb; change jsonb; identifier text; error_code text;
begin
 if p_action='calendar_configuration' then
  perform tlb.require(p_payload->>'service_account_email' is null or (length(p_payload->>'service_account_email')<=254 and p_payload->>'service_account_email' ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$'),'Invalid service account address.');
  update tlb.calendar_connection set configured=coalesce((p_payload->>'configured')::boolean,false),service_account_email=p_payload->>'service_account_email' where id;
  return tlb.calendar_status();
 end if;
 if p_action in ('calendar_owner_access','calendar_connect') then
  perform tlb.assert_staff((p_payload->>'user_id')::uuid,true);
  perform tlb.require(tlb.is_verified((p_payload->>'user_id')::uuid),'Verify your owner email before connecting a calendar.');
  if p_action='calendar_owner_access' then return jsonb_build_object('allowed',true,'connection',tlb.calendar_status());end if;
  identifier:=trim(p_payload->>'calendar_id');
  perform tlb.require(length(identifier)<=512 and identifier ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$','Enter the Calendar ID from Google Calendar settings.');
  select * into c from tlb.calendar_connection where id for update;
  perform tlb.require(c.calendar_id is null or c.calendar_id=identifier,'A different calendar is already connected. Disconnecting or moving its events requires a separate migration.');
  perform tlb.require(c.worker_until is null or c.worker_until<clock_timestamp(),'Calendar sync is running. Please try again shortly.');
  update tlb.calendar_connection set calendar_id=identifier,calendar_name='TLB Orders',enabled=true,
   connected_by=(p_payload->>'user_id')::uuid,connected_at=clock_timestamp(),sync_token=null,page_token=null,last_error=null where id;
  perform tlb.calendar_wake();return tlb.calendar_status();
 end if;
 select * into c from tlb.calendar_connection where id for update;
 if p_action='calendar_begin' then
  if not c.enabled or c.calendar_id is null then return jsonb_build_object('connected',false);end if;
  if c.worker_until>clock_timestamp() then return jsonb_build_object('busy',true);end if;
  token:=gen_random_uuid();
  update tlb.calendar_connection set worker_token=token,worker_until=clock_timestamp()+interval '180 seconds' where id;
  return jsonb_build_object('connected',true,'lease_token',token,'calendar_id',c.calendar_id,'sync_token',c.sync_token,'page_token',c.page_token);
 end if;
 perform tlb.require(c.worker_token=(p_payload->>'lease_token')::uuid and c.worker_until>clock_timestamp(),'Calendar worker lease expired.');
 if p_action='calendar_jobs' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into entries from (
   select order_id,event_id,desired,revision,synced_revision,etag from tlb.calendar_events
   where revision>synced_revision and next_attempt_at<=clock_timestamp() order by updated_at,order_id limit 3
  ) t; return entries;
 elsif p_action='calendar_ack' then
  update tlb.calendar_events set synced_revision=greatest(synced_revision,(p_payload->>'revision')::bigint),
   etag=p_payload->>'etag',synced_at=clock_timestamp(),attempts=0,last_error=null
  where order_id=(p_payload->>'order_id')::uuid and event_id=p_payload->>'event_id' and revision>=(p_payload->>'revision')::bigint;
  return jsonb_build_object('acknowledged',found);
 elsif p_action='calendar_fail' then
  error_code:=p_payload->>'error';
  if error_code not in ('access','api_disabled','configuration','network','quota','conflict') then error_code:='network';end if;
  update tlb.calendar_events set attempts=least(attempts+1,20),last_error=error_code,
   next_attempt_at=clock_timestamp()+make_interval(secs=>least(900,5*power(2,least(attempts,8))::integer))
  where order_id=(p_payload->>'order_id')::uuid and event_id=p_payload->>'event_id' and revision=(p_payload->>'revision')::bigint;
  return jsonb_build_object('recorded',found);
 elsif p_action='calendar_recreate' then
  update tlb.calendar_events set generation=generation+1,event_id='tlb'||replace(order_id::text,'-','')||'g'||to_hex(generation+1),
   revision=revision+1,etag=null,next_attempt_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp()
  where order_id=(p_payload->>'order_id')::uuid and event_id=p_payload->>'event_id' and desired is not null;
  return jsonb_build_object('queued',found);
 elsif p_action='calendar_scan_reset' then
  update tlb.calendar_connection set sync_token=null,page_token=null where id;return '{}'::jsonb;
 elsif p_action='calendar_scan' then
  perform tlb.require(jsonb_typeof(p_payload->'changes')='array' and jsonb_array_length(p_payload->'changes')<=250,'Invalid calendar change batch.');
  for change in select value from jsonb_array_elements(p_payload->'changes') loop
   select * into e from tlb.calendar_events where event_id=change->>'event_id' for update;
   if e.order_id is null then continue;end if;
   if coalesce((change->>'deleted')::boolean,false) then
    if e.desired is not null then
     update tlb.calendar_events set generation=generation+1,event_id='tlb'||replace(order_id::text,'-','')||'g'||to_hex(generation+1),
      revision=revision+1,etag=null,next_attempt_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp() where order_id=e.order_id;
    end if;
   elsif e.etag is distinct from change->>'etag' then
    update tlb.calendar_events set revision=revision+1,next_attempt_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp() where order_id=e.order_id;
   end if;
  end loop;
  perform tlb.require(length(coalesce(p_payload->>'next_page',''))<4096 and length(coalesce(p_payload->>'next_sync',''))<4096,'Invalid calendar cursor.');
  update tlb.calendar_connection set page_token=nullif(p_payload->>'next_page',''),
   sync_token=case when nullif(p_payload->>'next_page','') is null then nullif(p_payload->>'next_sync','') else sync_token end where id;
  return '{}'::jsonb;
 elsif p_action='calendar_finish' then
  error_code:=p_payload->>'error';
  if error_code is not null and error_code not in ('access','api_disabled','configuration','network','quota','conflict') then error_code:='network';end if;
  update tlb.calendar_connection set worker_token=null,worker_until=null,last_error=error_code,
   last_success_at=case when error_code is null then clock_timestamp() else last_success_at end where id;
  return tlb.calendar_status();
 end if;
 raise exception 'Unsupported calendar service action';
end $$;

create function public.shop_calendar_service(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security definer set search_path='' as $$ select tlb.calendar_service(p_action,p_payload) $$;
revoke all on function public.shop_calendar_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.shop_calendar_service(text,jsonb) to service_role;

do $$ declare definition text;hook text:=' role_name:=tlb.role_for(u);';begin
 definition:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 perform tlb.require(position(hook in definition)>0,'Missing calendar dashboard dispatch hook.');
 execute replace(definition,hook,hook||chr(10)||' if p_action in (''calendar_list'',''calendar_sync_now'') then return tlb.calendar_admin(p_action,p_payload);end if;');
end $$;
revoke all on function tlb.calendar_order(tlb.orders),tlb.calendar_wake(),tlb.queue_calendar_order(),tlb.calendar_status(),tlb.calendar_admin(text,jsonb),tlb.calendar_service(text,jsonb) from public,anon,authenticated,service_role;
commit;
