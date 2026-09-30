begin;
create table tlb.website_maintenance (
 id boolean primary key default true check(id),revision integer not null default 1,
 data jsonb not null default '{"mode":"off","announce":false,"pause_uploads":true,"message":"We’re making a few improvements. Thank you for your patience.","starts_at":null,"ends_at":null}'::jsonb
);
insert into tlb.website_maintenance(id) values(true);
create table tlb.maintenance_windows (
 id uuid primary key default gen_random_uuid(),starts_at timestamptz not null,ends_at timestamptz,
 pause_uploads boolean not null,created_by uuid not null,
 check(ends_at is null or ends_at>=starts_at)
);
create index maintenance_windows_time on tlb.maintenance_windows(starts_at,ends_at);
alter table tlb.website_maintenance enable row level security;
alter table tlb.maintenance_windows enable row level security;
revoke all on tlb.website_maintenance,tlb.maintenance_windows from public,anon,authenticated,service_role;

create function tlb.maintenance_state(p_at timestamptz default statement_timestamp()) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('active',w.id is not null,'uploads_paused',coalesce(w.pause_uploads,false),
  'announce',coalesce((m.data->>'announce')::boolean,false) and ((m.data->>'ends_at') is null or (m.data->>'ends_at')::timestamptz>p_at),
  'message',m.data->>'message','starts_at',case when w.id is not null then to_jsonb(w.starts_at) else m.data->'starts_at' end,
  'ends_at',case when w.id is not null then to_jsonb(w.ends_at) else m.data->'ends_at' end,'server_time',p_at)
 from tlb.website_maintenance m left join lateral (select * from tlb.maintenance_windows
  where starts_at<=p_at and (ends_at is null or ends_at>p_at) order by starts_at desc limit 1)w on true where m.id;
$$;

-- Stop the payment clock only while uploads were actually paused. Historical
-- windows are retained after edits. A pause never revives an already-late order.
create function tlb.maintenance_deadline(p_deadline timestamptz,p_created timestamptz,p_at timestamptz default statement_timestamp()) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare result timestamptz:=p_deadline;win record;first_at timestamptz;last_at timestamptz;counted_until timestamptz:=p_created;
begin
 for win in select starts_at,ends_at from tlb.maintenance_windows where pause_uploads and starts_at<p_at and (ends_at is null or ends_at>p_created) order by starts_at,id loop
  first_at:=greatest(win.starts_at,p_created,counted_until);last_at:=least(coalesce(win.ends_at,p_at),p_at);
  if first_at<result and last_at>first_at then result:=result+(last_at-first_at);end if;
  counted_until:=greatest(counted_until,last_at);
 end loop;
 return result;
end $$;

create function tlb.maintenance_admin(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare old tlb.website_maintenance;incoming jsonb;mode_value text;starts timestamptz;ends timestamptz;moment timestamptz:=clock_timestamp();changed boolean;
begin
 perform tlb.assert_staff(auth.uid(),true);
 if p_action='maintenance_admin' then return (select jsonb_build_object('settings',data,'revision',revision,'status',tlb.maintenance_state()) from tlb.website_maintenance where id);end if;
 perform pg_advisory_xact_lock(841721950318::bigint);
 select * into strict old from tlb.website_maintenance where id for update;
 perform tlb.require((p_payload->>'revision')::integer=old.revision,'Maintenance settings changed. Refresh before saving.');
 incoming:=p_payload->'settings';mode_value:=incoming->>'mode';
 perform tlb.require(mode_value in ('off','manual','scheduled'),'Choose a maintenance mode.');
 perform tlb.require(jsonb_typeof(incoming->'announce')='boolean' and jsonb_typeof(incoming->'pause_uploads')='boolean','Choose the announcement and upload settings.');
 perform tlb.require(length(btrim(incoming->>'message')) between 1 and 400,'Enter a maintenance message of 1–400 characters.');
 starts:=nullif(incoming->>'starts_at','')::timestamptz;ends:=nullif(incoming->>'ends_at','')::timestamptz;
 perform tlb.require(ends is null or (starts is not null and ends>starts),'The end time must be after the start time.');
 if mode_value='scheduled' then
  perform tlb.require(starts is not null and ends is not null and ends>moment,'Choose a start and future end for scheduled maintenance.');
  perform tlb.require(starts>=moment-interval '1 minute' or (old.data->>'mode'='scheduled' and starts=(old.data->>'starts_at')::timestamptz),'Choose a future start time.');
 end if;
 if (incoming->>'announce')::boolean then perform tlb.require(starts is not null and ends is not null,'Set the planned start and end for the announcement.');end if;
 incoming:=jsonb_build_object('mode',mode_value,'announce',(incoming->>'announce')::boolean,'pause_uploads',(incoming->>'pause_uploads')::boolean,
  'message',btrim(incoming->>'message'),'starts_at',starts,'ends_at',ends);
 changed:=old.data->>'mode' is distinct from mode_value or old.data->'pause_uploads' is distinct from incoming->'pause_uploads'
  or (mode_value='scheduled' and (old.data->'starts_at' is distinct from incoming->'starts_at' or old.data->'ends_at' is distinct from incoming->'ends_at'));
 if changed then
  -- End active windows now and neutralize future windows; never erase elapsed pauses.
  update tlb.maintenance_windows set ends_at=greatest(starts_at,moment) where ends_at is null or ends_at>moment;
  if mode_value in ('manual','scheduled') then
   insert into tlb.maintenance_windows(starts_at,ends_at,pause_uploads,created_by)
   values(case when mode_value='manual' then moment else greatest(starts,moment) end,case when mode_value='scheduled' then ends else null end,(incoming->>'pause_uploads')::boolean,auth.uid());
  end if;
 end if;
 update tlb.website_maintenance set data=incoming,revision=revision+1 where id;
 return (select jsonb_build_object('settings',data,'revision',revision,'status',tlb.maintenance_state(clock_timestamp())) from tlb.website_maintenance where id);
end $$;

do $$ declare definition text;hook text; begin
 definition:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 hook:=' perform pg_advisory_xact_lock(841721950318::bigint);';
 perform tlb.require(position(hook in definition)>0,'Missing maintenance fast-read hook.');
 definition:=replace(definition,hook,$new$
 if p_action='site_status' then return tlb.maintenance_state();end if;
$new$||hook);
 hook:=' if p_action=''catalog'' then';
 perform tlb.require(position(hook in definition)>0,'Missing maintenance dispatch hook.');
 definition:=replace(definition,hook,$new$
 if p_action in ('maintenance_admin','save_maintenance') then return tlb.maintenance_admin(p_action,p_payload);end if;
 if p_action='quote' then perform tlb.require(not (tlb.maintenance_state()->>'active')::boolean,'The Little Baker Kitchen is undergoing maintenance. New orders will reopen when maintenance ends.');end if;
$new$||hook);
 hook:='  perform tlb.validate_contact(p_payload);';
 perform tlb.require(position(hook in definition)>0,'Missing new-order maintenance guard.');
 execute replace(definition,hook,$new$  perform tlb.require(not (tlb.maintenance_state()->>'active')::boolean,'The Little Baker Kitchen is undergoing maintenance. New orders will reopen when maintenance ends.');
$new$||hook);
 definition:=pg_get_functiondef('tlb.expire_orders()'::regprocedure);
 hook:='payment_deadline <= clock_timestamp()';
 perform tlb.require(position(hook in definition)>0,'Missing expiry hook.');
 execute replace(definition,hook,'tlb.maintenance_deadline(payment_deadline,created_at,clock_timestamp()) <= clock_timestamp()');
 definition:=pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
 hook:='clock_timestamp()<o.payment_deadline';
 perform tlb.require(position(hook in definition)>0,'Missing proof deadline hook.');
 definition:=replace(definition,hook,'clock_timestamp()<tlb.maintenance_deadline(o.payment_deadline,o.created_at,clock_timestamp())');
 hook:=' expired_count:=tlb.expire_orders();';
 perform tlb.require(position(hook in definition)>0,'Missing proof pause hook.');
 execute replace(definition,hook,$new$
 if p_action='commit_proof' or (p_action='authorize_upload' and p_payload->>'kind'='proof') then
  perform tlb.require(not (tlb.maintenance_state()->>'uploads_paused')::boolean,'Payment-proof uploads are paused for maintenance. Your remaining upload time is protected. Please return when maintenance ends.');
 end if;
$new$||hook);
 definition:=pg_get_functiondef('tlb.order_json(uuid,boolean,boolean)'::regprocedure);
 hook:='''payment_deadline'',o.payment_deadline';
 perform tlb.require(position(hook in definition)>0,'Missing order deadline hook.');
 execute replace(definition,hook,$new$'payment_deadline',tlb.maintenance_deadline(o.payment_deadline,o.created_at),
 'uploads_paused',(tlb.maintenance_state()->>'uploads_paused')::boolean and o.fulfillment_status not in ('cancelled','expired') and (o.payment_status='awaiting_payment' or (o.source='direct_message' and o.data->>'delivery_payment_status'='awaiting_payment')),
 'payment_seconds_remaining',case when o.payment_deadline is not null and (tlb.maintenance_state()->>'uploads_paused')::boolean then greatest(0,extract(epoch from (tlb.maintenance_deadline(o.payment_deadline,o.created_at)-statement_timestamp())))::integer end$new$);
end $$;
revoke all on function tlb.maintenance_state(timestamptz),tlb.maintenance_deadline(timestamptz,timestamptz,timestamptz),tlb.maintenance_admin(text,jsonb) from public,anon,authenticated,service_role;
commit;
