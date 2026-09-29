begin;
set local lock_timeout='3s';
alter table tlb.outbox drop constraint outbox_order_reference;
alter table tlb.outbox add constraint outbox_order_reference check (
 (event_type in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher','operational_alert') and order_id is null)
 or (event_type not in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher','operational_alert') and order_id is not null));
create table tlb.operation_incidents(
 id uuid primary key default gen_random_uuid(), channel text not null check(channel in ('email','calendar')),
 opened_at timestamptz not null default now(), resolved_at timestamptz, affected integer not null,
 last_checked_at timestamptz not null default now()
);
create unique index operation_incident_open on tlb.operation_incidents(channel) where resolved_at is null;
alter table tlb.operation_incidents enable row level security;
revoke all on tlb.operation_incidents from public,anon,authenticated,service_role;

create function tlb.check_operation_alerts() returns void
language plpgsql security definer set search_path='' as $$
declare channel_name text; affected_count integer; incident tlb.operation_incidents; phase text; title text; snapshot jsonb;
begin
 -- Serialize scheduler, worker and dashboard checks without locking order rows.
 perform pg_advisory_xact_lock(20260930,1);
 for channel_name in select unnest(array['email','calendar']) loop
  if channel_name='email' then
   select count(*) into affected_count from tlb.outbox where event_type<>'operational_alert'
    and status in ('pending','sending','failed') and created_at<now()-interval '30 minutes'
    and (status='failed' or attempts>=3 or available_at<now()-interval '30 minutes');
   affected_count:=affected_count+(select count(*) from tlb.newsletter_broadcast_jobs
    where created_at<now()-interval '30 minutes' and (
     (status in ('pending','processing','needs_review') and (status='needs_review' or attempts>=3 or next_attempt_at<now()-interval '30 minutes'))
     or (status='accepted' and (updated_at<now()-interval '30 minutes' or (attempts>=3 and last_error is not null)))));
  else
   select count(*) into affected_count from tlb.calendar_events where revision>synced_revision
    and (updated_at<now()-interval '30 minutes' or (attempts>=3 and updated_at<now()-interval '15 minutes'))
    and exists(select 1 from tlb.calendar_connection where enabled and calendar_id is not null);
   if exists(select 1 from tlb.calendar_connection where enabled and calendar_id is not null
     and coalesce(last_success_at,connected_at)<now()-interval '30 minutes') then
    affected_count:=greatest(1,affected_count);
   end if;
  end if;
  select * into incident from tlb.operation_incidents where channel=channel_name and resolved_at is null for update;
  phase:=null;
  if affected_count>0 and incident.id is null then
   insert into tlb.operation_incidents(channel,affected) values(channel_name,affected_count) returning * into incident;
   phase:='opened';
  elsif affected_count>0 then
   update tlb.operation_incidents set affected=affected_count,last_checked_at=now() where id=incident.id;
  elsif incident.id is not null then
   update tlb.operation_incidents set affected=0,resolved_at=now(),last_checked_at=now() where id=incident.id;
   phase:='recovered';
  end if;
  if phase is not null then
   title:=case when channel_name='email' then 'Email delivery' else 'Google Calendar sync' end;
   snapshot:=jsonb_build_object('event_type','operational_alert','channel',channel_name,'phase',phase,
    'incident_id',incident.id,'affected',affected_count,'opened_at',incident.opened_at,
    'observed_at',now(),'settings',jsonb_build_object('site_url','https://thelittlebakerkitchen.com/'));
   insert into tlb.outbox(event_key,event_type,to_email,subject,payload)
    values('operations:'||incident.id||':'||phase,'operational_alert','brentchua1223@gmail.com',
     case when phase='recovered' then 'Recovered: ' else 'Action needed: ' end||title,snapshot)
    on conflict(event_key) do nothing;
  end if;
 end loop;
end $$;
revoke all on function tlb.check_operation_alerts() from public,anon,authenticated,service_role;

create function tlb.operation_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by opened_at desc),'[]') from (
  select id,channel,opened_at,resolved_at,affected,last_checked_at from tlb.operation_incidents
  where resolved_at is null or resolved_at>now()-interval '7 days' order by opened_at desc limit 20
 ) x
$$;
revoke all on function tlb.operation_status() from public,anon,authenticated,service_role;

do $$ declare def text; anchor text; begin
 def:=pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
 anchor:=$a$elsif p_action='maintenance' then$a$;
 if position(anchor in def)=0 then raise exception 'Operational maintenance anchor missing';end if;
 execute replace(def,anchor,anchor||chr(10)||'  perform tlb.check_operation_alerts();');
 def:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 anchor:=$a$if p_action='admin_bootstrap' then$a$;
 if position(anchor in def)=0 then raise exception 'Operational bootstrap anchor missing';end if;
 def:=replace(def,anchor,anchor||chr(10)||'  perform tlb.check_operation_alerts();');
 anchor:=$a$'email_status',(select$a$;
 if position(anchor in def)=0 then raise exception 'Operational status anchor missing';end if;
 execute replace(def,anchor,$a$'operation_incidents',tlb.operation_status(),'email_status',(select$a$);
 -- Independent DB watchdog can detect a stopped Edge worker. Local fixtures omit pg_cron.
 if exists(select 1 from pg_extension where extname='pg_cron') then
  execute $schedule$select cron.schedule('tlb-operation-alerts','*/5 * * * *','select tlb.check_operation_alerts()')$schedule$;
 end if;
end $$;
commit;
