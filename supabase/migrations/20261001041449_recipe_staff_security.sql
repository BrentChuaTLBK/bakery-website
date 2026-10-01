begin;
set local lock_timeout='3s';

-- These tables remain private. The authenticated API checks the current account
-- on every request; no policy decisions use user-editable JWT metadata.
create function tlb.recipe_staff_valid_hours(p_hours jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare h jsonb;days integer[]:='{}';d integer;
begin
 if jsonb_typeof(p_hours) is distinct from 'array' or jsonb_array_length(p_hours)<>7 then return false;end if;
 for h in select value from jsonb_array_elements(p_hours) loop
  if jsonb_typeof(h) is distinct from 'object' or coalesce(h->>'day','') !~ '^[1-7]$'
   or jsonb_typeof(h->'enabled') is distinct from 'boolean'
   or coalesce(h->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(h->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false;end if;
  d:=(h->>'day')::integer;
  if d=any(days) or (h->>'start')::time >= (h->>'end')::time then return false;end if;
  days:=array_append(days,d);
 end loop;
 return true;
end $$;

create table tlb.recipe_staff_defaults (
 id boolean primary key default true check(id), revision bigint not null default 1,
 hours jsonb not null check(tlb.recipe_staff_valid_hours(hours)),
 updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
insert into tlb.recipe_staff_defaults(id,hours)
select true,jsonb_agg(jsonb_build_object('day',d,'enabled',true,'start','10:00','end','19:00') order by d) from generate_series(1,7) d;

create table tlb.recipe_staff_controls (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=100),
 mode text not null default 'scheduled' check(mode in ('scheduled','always','blocked')),
 scope_mode text not null default 'all' check(scope_mode in ('all','categories','recipes')),
 scope_ids uuid[] not null default '{}' check(cardinality(scope_ids)<=1000),
 hours jsonb check(hours is null or tlb.recipe_staff_valid_hours(hours)),
 show_brands boolean not null default true, revision bigint not null default 1,
 updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table tlb.recipe_staff_dates (
 user_id uuid not null references auth.users(id) on delete cascade, access_date date not null,
 blocked boolean not null, change_id uuid not null,
 updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(),
 primary key(user_id,access_date)
);
create index recipe_staff_date_calendar on tlb.recipe_staff_dates(access_date,user_id);
create table tlb.recipe_staff_overrides (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('allow','block')), starts_at timestamptz not null, ends_at timestamptz not null,
 note text not null default '' check(length(note)<=500),
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 revoked_by uuid references auth.users(id) on delete set null, revoked_at timestamptz,
 check(ends_at>starts_at and ends_at-starts_at<=interval '366 days')
);
create index recipe_staff_override_window on tlb.recipe_staff_overrides(user_id,ends_at,starts_at) where revoked_at is null;
create table tlb.recipe_staff_batches (
 id uuid primary key, position bigint generated always as identity unique, actor uuid references auth.users(id) on delete set null,
 request jsonb not null, before_state jsonb not null,
 created_at timestamptz not null default clock_timestamp(), undone_at timestamptz
);
create index recipe_staff_batch_actor on tlb.recipe_staff_batches(actor,position desc);
create table tlb.recipe_staff_events (
 id bigint generated always as identity primary key,
 user_id uuid references auth.users(id) on delete set null, actor uuid references auth.users(id) on delete set null,
 recipe_id uuid references tlb.recipes(id) on delete set null,
 action text not null, reason text not null default '', details jsonb not null default '{}',
 occurrences integer not null default 1, created_at timestamptz not null default clock_timestamp(),
 last_at timestamptz not null default clock_timestamp()
);
create index recipe_staff_event_user_time on tlb.recipe_staff_events(user_id,created_at desc);
create index recipe_staff_event_time on tlb.recipe_staff_events(created_at desc);
create index recipe_staff_event_actor on tlb.recipe_staff_events(actor);
create index recipe_staff_event_recipe on tlb.recipe_staff_events(recipe_id);
create index recipe_staff_defaults_editor on tlb.recipe_staff_defaults(updated_by);
create index recipe_staff_controls_editor on tlb.recipe_staff_controls(updated_by);
create index recipe_staff_dates_editor on tlb.recipe_staff_dates(updated_by);
create index recipe_staff_overrides_author on tlb.recipe_staff_overrides(created_by);
create index recipe_staff_overrides_revoker on tlb.recipe_staff_overrides(revoked_by);

do $$ declare n text;begin
 foreach n in array array['recipe_staff_defaults','recipe_staff_controls','recipe_staff_dates','recipe_staff_overrides','recipe_staff_batches','recipe_staff_events'] loop
  execute format('alter table tlb.%I enable row level security',n);
  execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;

-- Kept separate so isolated tests can exercise exact boundaries without ever
-- accepting a device clock, timestamp override, or test flag in a public API.
create function tlb.recipe_staff_now() returns timestamptz
language sql volatile security invoker set search_path='' as $$ select clock_timestamp() $$;

create function tlb.recipe_staff_policy(p_user uuid,p_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare role_name text:=tlb.recipe_role(p_user);c tlb.recipe_staff_controls;defaults tlb.recipe_staff_defaults;
 local_time timestamp:=p_at at time zone 'Asia/Manila';day_hours jsonb;hours jsonb;
 business_date date:=local_time::date;reason text;allowed boolean:=false;end_at timestamptz;boundary timestamptz;
 temporary_end timestamptz;has_block boolean;has_allow boolean;calendar_block boolean;mode text;
begin
 select * into defaults from tlb.recipe_staff_defaults where id;
 select * into c from tlb.recipe_staff_controls where user_id=p_user;
 hours:=coalesce(c.hours,defaults.hours);mode:=coalesce(c.mode,'scheduled');
 select value into day_hours from jsonb_array_elements(hours) where (value->>'day')::int=extract(isodow from local_time)::int;
 end_at:=(business_date+1)::timestamp at time zone 'Asia/Manila';
 select exists(select 1 from tlb.recipe_staff_overrides where user_id=p_user and revoked_at is null and kind='block' and starts_at<=p_at and ends_at>p_at),
  exists(select 1 from tlb.recipe_staff_overrides where user_id=p_user and revoked_at is null and kind='allow' and starts_at<=p_at and ends_at>p_at),
  (select max(ends_at) from tlb.recipe_staff_overrides where user_id=p_user and revoked_at is null and kind='allow' and starts_at<=p_at and ends_at>p_at)
 into has_block,has_allow,temporary_end;
 calendar_block:=exists(select 1 from tlb.recipe_staff_dates where user_id=p_user and access_date=business_date and blocked);
 if role_name is null then reason:='account_unavailable';
 elsif role_name<>'kitchen' then allowed:=true;reason:='unrestricted';
 elsif mode='blocked' then reason:='account_blocked';
 elsif has_block then reason:='temporary_block';
 elsif has_allow then allowed:=true;reason:='temporary_allow';
 elsif calendar_block then reason:='date_blocked';
 elsif mode='always' then allowed:=true;reason:='always_allowed';
 elsif (day_hours->>'enabled')::boolean and local_time::time >= (day_hours->>'start')::time and local_time::time < (day_hours->>'end')::time then
  allowed:=true;reason:='scheduled';
 else reason:='outside_hours';end if;
 -- Lease boundaries include starts as well as ends. A future block must close
 -- an already open page at its boundary, not one polling interval afterwards.
 select min(t) into boundary from (
  select starts_at t from tlb.recipe_staff_overrides where user_id=p_user and revoked_at is null and starts_at>p_at
  union all select ends_at from tlb.recipe_staff_overrides where user_id=p_user and revoked_at is null and ends_at>p_at
  union all select (business_date+(day_hours->>'start')::time) at time zone 'Asia/Manila'
  union all select (business_date+(day_hours->>'end')::time) at time zone 'Asia/Manila'
 ) q where t>p_at;
 end_at:=least(end_at,coalesce(boundary,end_at),p_at+interval '15 seconds');
 return jsonb_build_object('allowed',allowed,'reason',reason,'role',role_name,'business_date',business_date,
  'timezone','Asia/Manila','server_now',p_at,'valid_until',end_at,
  'lease_ms',greatest(0,floor(extract(epoch from end_at-p_at)*1000)),
  'hours',day_hours,'mode',mode,'calendar_blocked',calendar_block,'temporary_until',case when reason='temporary_allow' then temporary_end end,
  'revision',concat(defaults.revision,':',coalesce(c.revision,0),':',coalesce(role_name,''),':',
    coalesce((select updated_at::text||':'||can_view_rd::text from tlb.recipe_access where user_id=p_user),'')));
end $$;

create function tlb.recipe_staff_event(p_action text,p_reason text default '',p_recipe uuid default null,p_details jsonb default '{}') returns void
language plpgsql volatile security invoker set search_path='' as $$
declare u uuid:=auth.uid();previous bigint;at_time timestamptz:=tlb.recipe_staff_now();
begin
 -- Denial revalidation does not create a row on every heartbeat. Counts remain
 -- available for the security summary; no browsing/scrolling telemetry is kept.
 if p_action='access_denied' then
  select id into previous from tlb.recipe_staff_events where user_id=u and action=p_action and reason=p_reason
   and recipe_id is not distinct from p_recipe and details->>'request' is not distinct from p_details->>'request' and created_at>at_time-interval '1 minute' order by id desc limit 1;
 end if;
 if previous is not null then update tlb.recipe_staff_events set occurrences=occurrences+1,last_at=at_time where id=previous;
 else insert into tlb.recipe_staff_events(user_id,actor,recipe_id,action,reason,details,created_at,last_at)
  values(u,u,p_recipe,p_action,p_reason,p_details,at_time,at_time);end if;
end $$;

create function tlb.recipe_staff_denied(p_reason text,p_action text,p_policy jsonb default null,p_recipe uuid default null) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare message text;
begin
 perform tlb.recipe_staff_event(case when p_reason='export_denied' then 'export_attempt' else 'access_denied' end,p_reason,
  case when exists(select 1 from tlb.recipes where id=p_recipe) then p_recipe end,jsonb_build_object('request',left(p_action,64)));
 message:=case p_reason when 'outside_hours' then 'Kitchen Recipe access is closed outside your authorized working hours.'
  when 'date_blocked' then 'Kitchen Recipe access is unavailable today.'
  when 'account_blocked' then 'Your Kitchen Recipe access is currently disabled.'
  when 'temporary_block' then 'Kitchen Recipe access is temporarily unavailable.'
  when 'rd_denied' then 'R&D access is required. Ask the owner to enable Can view R&D.'
  when 'recipe_changed' then 'The approved recipe changed. Reopen it to use the current version.'
  when 'export_denied' then 'ACCESS DENIED. Kitchen Staff cannot print, download or export recipes.'
  when 'recipe_denied' then 'ACCESS DENIED. This recipe version is not available for kitchen viewing.'
  else 'ACCESS DENIED. Authorized recipe editor or owner access required.' end;
 -- Returning a 403 instead of raising preserves the denial audit row. SQL
 -- exceptions would roll back the audit together with the failed request.
 perform set_config('response.status','403',true);
 return jsonb_build_object('error',true,'code','42501','reason',p_reason,'message',message,'access',p_policy);
end $$;

-- Recipe scope applies to both the Final and explicitly enabled R&D view.
-- Selecting a category includes its children. Components are granted only as
-- dependencies of an authorized recipe, never as a browsable historic library.
create function tlb.recipe_staff_roots(p_user uuid,p_rd boolean default false)
returns table(recipe_id uuid,version_id uuid)
language sql stable security invoker set search_path='' as $$
 with recursive settings as (
  select coalesce(c.scope_mode,'all') scope_mode,coalesce(c.scope_ids,'{}') scope_ids,
   coalesce(a.can_view_rd,false) can_rd from tlb.recipe_access a left join tlb.recipe_staff_controls c on c.user_id=a.user_id
  where a.user_id=p_user and a.permission='kitchen'
 ), categories(id) as (
  select unnest(scope_ids) from settings where scope_mode='categories'
  union select c.id from tlb.recipe_categories c join categories p on c.parent_id=p.id
 ), invalid(id) as (
  select v.id from tlb.recipe_versions v join tlb.recipes r on r.id=v.recipe_id
  where r.deleted_at is not null or not(v.status in ('approved','production') or (p_rd and v.status='testing'))
  union select l.version_id from tlb.recipe_links l join invalid i on i.id=l.target_version_id where l.kind='component'
 )
 select r.id,v.id from tlb.recipes r
 join tlb.recipe_versions v on v.id=case when p_rd then r.current_version_id else r.production_version_id end
 cross join settings s where r.deleted_at is null
 and (case when p_rd then s.can_rd and v.status='testing' else v.status in ('approved','production') end)
 and (s.scope_mode='all' or (s.scope_mode='recipes' and r.id=any(s.scope_ids))
  or (s.scope_mode='categories' and nullif(v.document->>'category_id','')::uuid in(select id from categories)))
 and v.id not in(select id from invalid)
$$;

create function tlb.recipe_staff_resolve(p_user uuid,p_recipe uuid,p_version uuid,p_rd boolean,p_root uuid default null,p_root_version uuid default null)
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare root_version uuid;target uuid;
begin
 select version_id into root_version from tlb.recipe_staff_roots(p_user,p_rd) where recipe_id=coalesce(p_root,p_recipe);
 if root_version is null or (p_root_version is not null and p_root_version<>root_version) then return null;end if;
 if p_root is null or p_root=p_recipe then
  if p_version is null or p_version=root_version then return root_version;end if;
  return null;
 end if;
 if p_version is null then return null;end if;
 with recursive chain(id) as (
  select root_version union select l.target_version_id from tlb.recipe_links l join chain c on c.id=l.version_id where l.kind='component'
 ) select v.id into target from chain c join tlb.recipe_versions v on v.id=c.id where v.recipe_id=p_recipe and v.id=p_version;
 return target;
end $$;

create function tlb.recipe_staff_detail(p_recipe uuid,p_version uuid,p_show_brands boolean default true) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r tlb.recipes;v tlb.recipe_versions;doc jsonb;links jsonb;files jsonb;size jsonb;groups jsonb;g jsonb;variants jsonb:='[]';
begin
 select * into r from tlb.recipes where id=p_recipe;
 select * into v from tlb.recipe_versions where id=p_version and recipe_id=p_recipe;
 doc:=tlb.recipe_kitchen_document(tlb.recipe_packaging_document(v.document,false));
 if not p_show_brands then
  for size in select value from jsonb_array_elements(doc->'variants') loop
   groups:='[]';for g in select value from jsonb_array_elements(size->'groups') loop
    groups:=groups||jsonb_build_array(g||jsonb_build_object('ingredients',(select coalesce(jsonb_agg(row-'brand'),'[]') from jsonb_array_elements(g->'ingredients') row)));
   end loop;
   variants:=variants||jsonb_build_array(size||jsonb_build_object('groups',groups));
  end loop;doc:=jsonb_set(doc,'{variants}',variants);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.link_id,'kind',l.kind,'mode',l.mode,'version_id',t.id,'recipe_id',t.recipe_id,
  'name',t.document->>'name','number',t.number,'quantity',l.quantity,'update_available',false)),'[]') into links
 from tlb.recipe_links l join tlb.recipe_versions t on t.id=l.target_version_id where l.version_id=v.id and l.kind='component';
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'mime_type',f.mime_type,'visibility','kitchen')),'[]') into files
 from tlb.recipe_files f where f.uploaded and f.mime_type in ('image/jpeg','image/png','image/webp') and (
  exists(select 1 from tlb.recipe_file_links l where l.file_id=f.id and l.version_id=v.id and l.visibility='kitchen')
  or exists(select 1 from jsonb_array_elements(doc->'variants') s cross join lateral jsonb_array_elements(coalesce(s#>'{packaging,items}','[]')) item
   cross join lateral jsonb_array_elements(coalesce(item->'resource_photos','[]')) photo where photo->>'file_id'=f.id::text));
 return jsonb_build_object('id',r.id,'code',r.code,'version_id',v.id,'version',v.number,'status',v.status,
  'production_version_id',r.production_version_id,'updated_at',v.created_at,'document',doc,'links',links,'files',files);
end $$;

create function tlb.recipe_staff_admin(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare uid uuid:=auth.uid();at_time timestamptz:=tlb.recipe_staff_now();defaults tlb.recipe_staff_defaults;control_row tlb.recipe_staff_controls;
 target uuid;users uuid[];dates date[];ids uuid[];day date;from_date date;to_date date;batch uuid;previous tlb.recipe_staff_batches;
 request jsonb;before_state jsonb;item jsonb;mode text;scope text;chosen_hours jsonb;starts timestamptz;ends timestamptz;
 changed integer;result jsonb;label text;reason text;lim integer:=least(200,greatest(1,coalesce((p_payload->>'limit')::integer,100)));
begin
 perform tlb.recipe_assert(true,true);
 if p_action in ('staff_overview','staff_activity') then
  select * into defaults from tlb.recipe_staff_defaults where id;
  if p_action='staff_activity' then
   target:=nullif(p_payload->>'user_id','')::uuid;
   return jsonb_build_object('rows',(select coalesce(jsonb_agg(row order by event_id desc),'[]') from (
    select e.id event_id,to_jsonb(e)||jsonb_build_object('name',coalesce(nullif(c.display_name,''),u.email),'actor_name',a.email,
     'recipe_name',r.name) row from tlb.recipe_staff_events e
    left join auth.users u on u.id=e.user_id left join auth.users a on a.id=e.actor
    left join tlb.recipe_staff_controls c on c.user_id=e.user_id left join tlb.recipes r on r.id=e.recipe_id
    where (target is null or e.user_id=target or e.details->'users' ? target::text)
    and (nullif(p_payload->>'before','') is null or e.id<(p_payload->>'before')::bigint)
    order by e.id desc limit lim
   ) q),'flags',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (
    select e.user_id,coalesce(nullif(c.display_name,''),u.email) name,
     sum(e.occurrences) filter(where e.action='export_attempt') export_attempts,
     sum(e.occurrences) filter(where e.action='access_denied' and coalesce(e.details->>'request','') not in ('access_check','bootstrap')) denied_requests,
     sum(e.occurrences) filter(where e.action='recipe_opened') recipe_openings
    from tlb.recipe_staff_events e left join auth.users u on u.id=e.user_id left join tlb.recipe_staff_controls c on c.user_id=e.user_id
    where e.created_at>=at_time-interval '5 minutes' and e.user_id is not null
    group by e.user_id,c.display_name,u.email
    having coalesce(sum(e.occurrences) filter(where e.action='export_attempt'),0)>0
     or coalesce(sum(e.occurrences) filter(where e.action='access_denied' and coalesce(e.details->>'request','') not in ('access_check','bootstrap')),0)>=5
     or coalesce(sum(e.occurrences) filter(where e.action='recipe_opened'),0)>=20
   ) q));
  end if;
  from_date:=coalesce(nullif(p_payload->>'from','')::date,(at_time at time zone 'Asia/Manila')::date);
  to_date:=coalesce(nullif(p_payload->>'to','')::date,from_date+41);
  perform tlb.require(to_date>=from_date and to_date-from_date<=62,'Choose a calendar range of up to 63 days.');
  return jsonb_build_object('server_now',at_time,'timezone','Asia/Manila','revision',defaults.revision,'hours',defaults.hours,
   'staff',(select coalesce(jsonb_agg(to_jsonb(row) order by lower(row.name),row.user_id),'[]') from (
    select a.user_id,coalesce(nullif(c.display_name,''),u.email) name,coalesce(c.display_name,'') display_name,u.email,
     tlb.recipe_role(a.user_id)='kitchen' active,coalesce(c.mode,'scheduled') mode,
     coalesce(c.scope_mode,'all') scope_mode,coalesce(c.scope_ids,'{}') scope_ids,c.hours,
     coalesce(c.show_brands,true) show_brands,coalesce(c.revision,0) revision,a.can_view_rd,
     tlb.recipe_staff_policy(a.user_id,at_time) access
    from tlb.recipe_access a join auth.users u on u.id=a.user_id left join tlb.recipe_staff_controls c on c.user_id=a.user_id
    where a.permission='kitchen' and tlb.role_for(a.user_id) is distinct from 'owner'
   ) row),
   'dates',(select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'date',access_date,'blocked',blocked)),'[]')
    from tlb.recipe_staff_dates where access_date between from_date and to_date and blocked),
   'overrides',(select coalesce(jsonb_agg(to_jsonb(o) order by o.starts_at,o.id),'[]') from tlb.recipe_staff_overrides o
    where revoked_at is null and ends_at>at_time),
   'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'parent_id',parent_id) order by sort_order,lower(name)),'[]') from tlb.recipe_categories where active),
   'recipes',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'category_id',r.category_id) order by lower(r.name),r.id),'[]') from tlb.recipes r where r.deleted_at is null));
 end if;

 -- Serialize management edits against each other, including undo. Readers do
 -- not take this lock. Every mutation is a single all-or-nothing transaction.
 select * into defaults from tlb.recipe_staff_defaults where id for update;
 if p_action='staff_save_defaults' then
  perform tlb.require(defaults.revision=(p_payload->>'revision')::bigint,'Access settings changed. Refresh before saving.');
  chosen_hours:=p_payload->'hours';perform tlb.require(tlb.recipe_staff_valid_hours(chosen_hours),'Enter valid same-day hours for all seven days.');
  update tlb.recipe_staff_defaults set hours=chosen_hours where id;
  label:='default_hours_changed';request:=jsonb_build_object('hours',chosen_hours);
 elsif p_action='staff_save' then
  target:=(p_payload->>'user_id')::uuid;
  perform tlb.require(exists(select 1 from tlb.recipe_access where user_id=target and permission='kitchen') and tlb.role_for(target) is distinct from 'owner','Choose a Kitchen Staff account.');
  select * into control_row from tlb.recipe_staff_controls where user_id=target;
  perform tlb.require(coalesce(control_row.revision,0)=(p_payload->>'revision')::bigint,'This account changed. Reopen its settings before saving.');
  mode:=p_payload->>'mode';scope:=p_payload->>'scope_mode';chosen_hours:=nullif(p_payload->'hours','null'::jsonb);
  perform tlb.require(mode in ('scheduled','always','blocked'),'Choose Scheduled, Always Allowed or Blocked.');
  perform tlb.require(scope in ('all','categories','recipes'),'Choose a recipe scope.');
  perform tlb.require(chosen_hours is null or tlb.recipe_staff_valid_hours(chosen_hours),'Enter valid same-day hours for all seven days.');
  select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_payload->'scope_ids','[]'));
  if scope='all' then ids:='{}';else perform tlb.require(cardinality(ids) between 1 and 1000,'Select at least one category or recipe.');end if;
  if scope='categories' then perform tlb.require(not exists(select 1 from unnest(ids) choice(id) where not exists(select 1 from tlb.recipe_categories c where c.id=choice.id and active)),'A selected category is unavailable.');end if;
  if scope='recipes' then perform tlb.require(not exists(select 1 from unnest(ids) choice(id) where not exists(select 1 from tlb.recipes r where r.id=choice.id and deleted_at is null)),'A selected recipe is unavailable.');end if;
  perform tlb.require(jsonb_typeof(p_payload->'show_brands')='boolean' and jsonb_typeof(p_payload->'can_view_rd')='boolean','Choose brand visibility and R&D access.');
  insert into tlb.recipe_staff_controls(user_id,display_name,mode,scope_mode,scope_ids,hours,show_brands,updated_by,updated_at)
   values(target,left(btrim(coalesce(p_payload->>'display_name','')),100),mode,scope,ids,chosen_hours,(p_payload->>'show_brands')::boolean,uid,at_time)
   on conflict(user_id) do update set display_name=excluded.display_name,mode=excluded.mode,scope_mode=excluded.scope_mode,
    scope_ids=excluded.scope_ids,hours=excluded.hours,show_brands=excluded.show_brands,revision=recipe_staff_controls.revision+1,updated_by=uid,updated_at=at_time;
  update tlb.recipe_access set can_view_rd=(p_payload->>'can_view_rd')::boolean,updated_at=at_time,granted_by=uid where user_id=target;
  label:='staff_permissions_changed';request:=jsonb_build_object('user_id',target,'mode',mode,'scope_mode',scope,'scope_ids',ids,'hours',chosen_hours,'can_view_rd',p_payload->'can_view_rd','show_brands',p_payload->'show_brands');
 elsif p_action in ('staff_calendar','staff_set_mode','staff_override') then
  select array_agg(distinct value::uuid order by value::uuid) into users from jsonb_array_elements_text(coalesce(p_payload->'users','[]'));
  perform tlb.require(cardinality(users) between 1 and 500,'Select between 1 and 500 Kitchen Staff accounts.');
  perform tlb.require(not exists(select 1 from unnest(users) person where not exists(
   select 1 from tlb.recipe_access a where a.user_id=person and permission='kitchen' and tlb.role_for(person) is distinct from 'owner')),'A selected account no longer has Kitchen Staff access. Refresh and retry.');
  if p_action='staff_calendar' then
   mode:=p_payload->>'action';perform tlb.require(mode in ('block','restore'),'Choose Block Selected Dates or Restore Scheduled Access.');
   perform tlb.require(not exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'dates','[]')) value where value !~ '^\d{4}-\d{2}-\d{2}$'),'Use calendar dates in YYYY-MM-DD format.');
   select array_agg(distinct value::date order by value::date) into dates from jsonb_array_elements_text(coalesce(p_payload->'dates','[]'));
   perform tlb.require(cardinality(dates) between 1 and 366 and cardinality(users)*cardinality(dates)<=10000,'Select up to 366 dates and 10,000 Staff-Date changes.');
   batch:=(p_payload->>'request_id')::uuid;perform tlb.require(batch is not null,'A calendar request ID is required.');
   request:=jsonb_build_object('users',users,'dates',dates,'action',mode);
   select * into previous from tlb.recipe_staff_batches where id=batch;
   if found then
    perform tlb.require(previous.actor=uid and previous.request=request and previous.undone_at is null,'This request ID was already used for another calendar change. Refresh and retry.');
    return jsonb_build_object('saved',true,'batch_id',batch,'changes',cardinality(users)*cardinality(dates),'replayed',true);
   end if;
   select jsonb_agg(jsonb_build_object('user_id',u,'access_date',d,'previous',case when b.user_id is null then null else to_jsonb(b) end) order by u,d)
    into before_state from unnest(users) u cross join unnest(dates) d left join tlb.recipe_staff_dates b on b.user_id=u and b.access_date=d;
   insert into tlb.recipe_staff_batches(id,actor,request,before_state,created_at) values(batch,uid,request,before_state,at_time);
   insert into tlb.recipe_staff_dates(user_id,access_date,blocked,change_id,updated_by,updated_at)
    select u,d,mode='block',batch,uid,at_time from unnest(users) u cross join unnest(dates) d
    on conflict(user_id,access_date) do update set blocked=excluded.blocked,change_id=batch,updated_by=uid,updated_at=at_time;
   label:=case when mode='block' then 'dates_blocked' else 'dates_restored' end;
   result:=jsonb_build_object('batch_id',batch,'changes',cardinality(users)*cardinality(dates));request:=request||result;
  elsif p_action='staff_set_mode' then
   mode:=p_payload->>'mode';perform tlb.require(mode in ('scheduled','always','blocked'),'Choose Scheduled, Always Allowed or Blocked.');
   insert into tlb.recipe_staff_controls(user_id,mode,updated_by,updated_at) select u,mode,uid,at_time from unnest(users) u
    on conflict(user_id) do update set mode=excluded.mode,revision=recipe_staff_controls.revision+1,updated_by=uid,updated_at=at_time;
   label:='account_mode_changed';request:=jsonb_build_object('users',users,'mode',mode);
  else
   mode:=p_payload->>'kind';perform tlb.require(mode in ('allow','block'),'Choose Temporary Allow Anytime or Temporary Block.');
   perform tlb.require(coalesce(p_payload->>'starts_local','') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' and coalesce(p_payload->>'ends_local','') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$','Enter start and end in Asia/Manila local time.');
   starts:=(p_payload->>'starts_local')::timestamp at time zone 'Asia/Manila';ends:=(p_payload->>'ends_local')::timestamp at time zone 'Asia/Manila';
   perform tlb.require(ends>starts and ends>at_time and ends-starts<=interval '366 days','The end must be in the future, after the start, and within 366 days.');
   insert into tlb.recipe_staff_overrides(user_id,kind,starts_at,ends_at,note,created_by,created_at)
    select u,mode,starts,ends,left(btrim(coalesce(p_payload->>'note','')),500),uid,at_time from unnest(users) u;
   label:='temporary_'||mode||'_created';request:=jsonb_build_object('users',users,'starts_at',starts,'ends_at',ends,'kind',mode);
  end if;
 elsif p_action='staff_undo' then
  batch:=(p_payload->>'batch_id')::uuid;
  select * into previous from tlb.recipe_staff_batches where id=batch and actor=uid for update;
  perform tlb.require(found and previous.undone_at is null and previous.created_at>at_time-interval '30 minutes','This calendar change can no longer be undone. Review the selected dates.');
  perform tlb.require(not exists(select 1 from tlb.recipe_staff_batches b where b.actor=uid and b.position>previous.position),'Only your most recent calendar action can be undone.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements(previous.before_state) s left join tlb.recipe_staff_dates d
   on d.user_id=(s->>'user_id')::uuid and d.access_date=(s->>'access_date')::date where d.change_id is distinct from batch),
   'These dates were changed after this action. Undo would overwrite a newer change; review the calendar instead.');
  for item in select value from jsonb_array_elements(previous.before_state) loop
   target:=(item->>'user_id')::uuid;day:=(item->>'access_date')::date;
   if item->'previous'='null'::jsonb then delete from tlb.recipe_staff_dates where user_id=target and access_date=day;
   else update tlb.recipe_staff_dates set blocked=(item#>>'{previous,blocked}')::boolean,change_id=(item#>>'{previous,change_id}')::uuid,
    updated_by=(item#>>'{previous,updated_by}')::uuid,updated_at=(item#>>'{previous,updated_at}')::timestamptz where user_id=target and access_date=day;end if;
  end loop;
  update tlb.recipe_staff_batches set undone_at=at_time where id=batch;
  target:=null;
  label:='calendar_undone';request:=previous.request||jsonb_build_object('batch_id',batch);
 elsif p_action='staff_revoke_override' then
  select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(coalesce(p_payload->'ids','[]'));
  perform tlb.require(cardinality(ids) between 1 and 500,'Select temporary overrides to end.');
  select coalesce(array_agg(distinct user_id),'{}') into users from tlb.recipe_staff_overrides where id=any(ids) and revoked_at is null;
  update tlb.recipe_staff_overrides set revoked_at=at_time,revoked_by=uid where id=any(ids) and revoked_at is null;
  get diagnostics changed=row_count;perform tlb.require(changed=cardinality(ids),'An override changed or no longer exists. Refresh and retry.');
  label:='temporary_override_ended';request:=jsonb_build_object('ids',ids,'users',users);
 else raise exception 'Unknown staff access action.' using errcode='22023';end if;
 update tlb.recipe_staff_defaults set revision=revision+1,updated_by=uid,updated_at=at_time where id;
 insert into tlb.recipe_staff_events(user_id,actor,action,details,created_at,last_at) values(target,uid,label,request,at_time,at_time);
 insert into tlb.recipe_audit(actor,action,details) values(uid,label,request);
 return jsonb_build_object('saved',true)||coalesce(result,'{}');
end $$;

alter function public.recipe_api(text,jsonb) rename to recipe_api_before_staff_security;
alter function public.recipe_api_before_staff_security(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_staff_security(text,jsonb) from public,anon,authenticated,service_role;

create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=auth.uid();role_name text;policy jsonb;result jsonb;rd boolean;rid uuid;vid uuid;root_id uuid;root_version uuid;file_id uuid;
 can_rd boolean;show_brands boolean;q text;lim integer;off integer;at_time timestamptz;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, private, max-age=0"},{"Pragma":"no-cache"},{"Vary":"Authorization"}]',true);
 if p_action='bootstrap' then perform tlb.recipe_claim_access();end if;
 role_name:=tlb.recipe_assert();
 perform tlb.require(jsonb_typeof(p_payload)='object','Use an object for recipe request parameters.');
 if role_name<>'kitchen' then
  if p_action like 'staff\_%' escape '\' then return tlb.recipe_staff_admin(p_action,p_payload);end if;
  if p_action='access_check' then return jsonb_build_object('role',role_name,'can_view_rd',tlb.recipe_can_view_rd(),'access',tlb.recipe_staff_policy(uid,tlb.recipe_staff_now()));end if;
  if p_action in ('export_authorize','export','export_data','print','pdf','csv','download') then
   perform tlb.recipe_assert(true);return jsonb_build_object('allowed',true,'role',role_name);
  end if;
  if p_action='client_security_event' then return jsonb_build_object('recorded',false);end if;
  return tlb.recipe_api_before_staff_security(p_action,p_payload);
 end if;
 at_time:=tlb.recipe_staff_now();policy:=tlb.recipe_staff_policy(uid,at_time);
 can_rd:=tlb.recipe_can_view_rd();rd:=coalesce((p_payload->>'rd')::boolean,false);
 select coalesce((select c.show_brands from tlb.recipe_staff_controls c where c.user_id=uid),true) into show_brands;
 if p_action='bootstrap' then
  if not (policy->>'allowed')::boolean then perform tlb.recipe_staff_event('access_denied',policy->>'reason',null,jsonb_build_object('request','bootstrap'));end if;
  return jsonb_build_object('role','kitchen','can_view_rd',can_rd,'access',policy,'authors','[]'::jsonb,
   'settings',(select tlb.recipe_pick(settings,array['paper','rounding','kitchen_font_size']) from tlb.recipe_settings where id),
   'categories',case when (policy->>'allowed')::boolean then (
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'sort_order',c.sort_order) order by c.sort_order,lower(c.name)),'[]')
    from tlb.recipe_categories c where c.active and c.id in(
     select nullif(v.document->>'category_id','')::uuid from tlb.recipe_versions v join (
      select version_id from tlb.recipe_staff_roots(uid,false) union select version_id from tlb.recipe_staff_roots(uid,true)
     ) allowed on allowed.version_id=v.id)) else '[]'::jsonb end);
 end if;
 if p_action in ('export_authorize','export','export_data','print','pdf','csv','download','print_recipe','ingredient_csv','recipe_pdf','copy_recipe') then
  return tlb.recipe_staff_denied('export_denied',p_action,policy);
 end if;
 if p_action='client_security_event' then
  if p_payload->>'event' in ('print','copy','contextmenu','drag') then
   perform tlb.recipe_staff_event(case when p_payload->>'event'='print' then 'export_attempt' else 'copy_deterrent' end,
    'browser_'||(p_payload->>'event'));end if;
  return jsonb_build_object('recorded',true);
 end if;
 if p_action not in ('access_check','list','get','scale','favorite','media_authorize') then
  return tlb.recipe_staff_denied('action_denied',p_action,policy);
 end if;
 if not (policy->>'allowed')::boolean then return tlb.recipe_staff_denied(policy->>'reason',p_action,policy);end if;
 if rd and not can_rd then return tlb.recipe_staff_denied('rd_denied',p_action,policy);end if;
 if p_action='access_check' and nullif(p_payload->>'id','') is null then
  return jsonb_build_object('role','kitchen','can_view_rd',can_rd,'access',policy);
 end if;
 if p_action='list' then
  q:=left(btrim(coalesce(p_payload->>'query','')),200);lim:=least(100,greatest(1,coalesce((p_payload->>'limit')::int,24)));off:=greatest(0,coalesce((p_payload->>'offset')::int,0));
  with visible as materialized (
   select r.id,r.code,v.document->>'name' name,v.document->>'category_id' category_id,v.status,v.number version,v.created_at updated_at,
    coalesce(u.favorite,false) favorite,coalesce(u.pinned,false) pinned,u.last_viewed_at,v.document->'tags' tags
   from tlb.recipe_staff_roots(uid,rd) allowed join tlb.recipes r on r.id=allowed.recipe_id join tlb.recipe_versions v on v.id=allowed.version_id
   left join tlb.recipe_user_state u on u.recipe_id=r.id and u.user_id=uid
   where (q='' or v.kitchen_search@@plainto_tsquery('simple',q) or v.document->>'name' ilike '%'||q||'%')
    and (nullif(p_payload->>'status','') is null or v.status=case p_payload->>'status' when 'final' then 'production' when 'rd' then 'testing' else p_payload->>'status' end)
    and (nullif(p_payload->>'category_id','') is null or v.document->>'category_id'=p_payload->>'category_id')
    and (nullif(p_payload->>'tag','') is null or v.document->'tags' ? (p_payload->>'tag'))
    and (nullif(p_payload->>'flavor','') is null or v.document->>'flavor'=p_payload->>'flavor')
    and (nullif(p_payload->>'product_line','') is null or v.document->>'product_line'=p_payload->>'product_line')
    and (nullif(p_payload->>'updated_after','') is null or (v.created_at at time zone 'Asia/Manila')::date>=(p_payload->>'updated_after')::date)
    and (not coalesce((p_payload->>'favorites')::boolean,false) or u.favorite)
    and (not coalesce((p_payload->>'pinned')::boolean,false) or u.pinned)
    and (not coalesce((p_payload->>'recent')::boolean,false) or u.last_viewed_at>at_time-interval '30 days')
  ) select jsonb_build_object('total',(select count(*) from visible),'rows',coalesce((
   select jsonb_agg(to_jsonb(rows) order by lower(name),id) from (select * from visible order by lower(name),id limit lim offset off) rows),'[]')) into result;
  return result||jsonb_build_object('access',policy);
 end if;
 rid:=nullif(p_payload->>case when p_action='media_authorize' then 'recipe_id' else 'id' end,'')::uuid;
 root_id:=nullif(p_payload->>'root_id','')::uuid;root_version:=nullif(p_payload->>'root_version','')::uuid;
 vid:=tlb.recipe_staff_resolve(uid,rid,nullif(p_payload->>'version_id','')::uuid,rd,root_id,root_version);
 if vid is null then return tlb.recipe_staff_denied('recipe_denied',p_action,policy,rid);end if;
 if p_action='access_check' then
  return jsonb_build_object('role','kitchen','can_view_rd',can_rd,'access',policy,'version_id',vid);
 elsif p_action='scale' then
  perform tlb.recipe_staff_event('recipe_scaled','',rid,jsonb_build_object('version_id',vid,'rd',rd));
  return jsonb_build_object('allowed',true,'access',policy,'version_id',vid);
 elsif p_action='favorite' then
  insert into tlb.recipe_user_state(user_id,recipe_id,favorite,pinned) values(uid,rid,coalesce((p_payload->>'favorite')::boolean,false),coalesce((p_payload->>'pinned')::boolean,false))
   on conflict(user_id,recipe_id) do update set favorite=excluded.favorite,pinned=excluded.pinned;
  return jsonb_build_object('saved',true,'access',policy);
 end if;
 result:=tlb.recipe_staff_detail(rid,vid,show_brands);
 if p_action='media_authorize' then
  file_id:=(p_payload->>'file_id')::uuid;
  if not exists(select 1 from jsonb_array_elements(result->'files') f where f->>'id'=file_id::text) then
   return tlb.recipe_staff_denied('recipe_denied',p_action,policy,rid);end if;
  return (select jsonb_build_object('path',path,'mime_type',mime_type,'size_bytes',size_bytes,'access',policy)
   from tlb.recipe_files where id=file_id and uploaded and mime_type in ('image/jpeg','image/png','image/webp'));
 end if;
 insert into tlb.recipe_user_state(user_id,recipe_id,last_viewed_at) values(uid,rid,at_time) on conflict(user_id,recipe_id) do update set last_viewed_at=at_time;
 perform tlb.recipe_staff_event('recipe_opened','',rid,jsonb_build_object('version_id',vid,'rd',rd,'root_id',root_id));
 return result||jsonb_build_object('access',policy,'root_id',coalesce(root_id,rid),'root_version',coalesce(root_version,vid),'rd',rd);
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;

-- Kitchen images use the authenticated no-store media endpoint. Deny direct
-- Storage reads/signing for Kitchen Staff, including the historic function OID
-- already referenced by the Storage RLS policy.
do $$ declare source text;hook text;tables text[];begin
 source:=pg_get_functiondef('public.recipe_file_access(text,boolean)'::regprocedure);
 hook:='if role_name=''chef'' and not p_write';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe storage policy hook.');
 execute replace(source,hook,'if role_name=''kitchen'' then return false;end if;'||E'\n '||hook);
 tables:=tlb.recipe_backup_tables()||array['recipe_staff_defaults','recipe_staff_controls','recipe_staff_dates','recipe_staff_overrides','recipe_staff_batches','recipe_staff_events'];
 execute format('create or replace function tlb.recipe_backup_tables() returns text[] language sql immutable set search_path='''' as $body$ select %L::text[] $body$',tables);
 source:=pg_get_functiondef('public.recipe_backup_service(text,jsonb)'::regprocedure);
 hook:='union select actor from tlb.recipe_audit';
 perform tlb.require(strpos(source,hook)>0,'Missing recipe backup actor hook.');
 execute replace(source,hook,hook||E'\n union select user_id from tlb.recipe_staff_controls union select user_id from tlb.recipe_staff_dates\n union select user_id from tlb.recipe_staff_overrides union select user_id from tlb.recipe_staff_events\n union select actor from tlb.recipe_staff_events union select actor from tlb.recipe_staff_batches\n union select updated_by from tlb.recipe_staff_defaults union select updated_by from tlb.recipe_staff_controls\n union select updated_by from tlb.recipe_staff_dates union select created_by from tlb.recipe_staff_overrides union select revoked_by from tlb.recipe_staff_overrides');
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='tlb' and p.proname like 'recipe_staff_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity);
 end loop;
end $$;
commit;
