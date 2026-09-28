-- POS payment settings are independent of the website's payment instructions.
create table tlb.pos_register_config (
 id boolean primary key default true check(id), revision integer not null default 1,
 methods jsonb not null check(jsonb_typeof(methods)='array')
);
insert into tlb.pos_register_config(methods) values ('[{"id":"cash","label":"Cash","active":true},{"id":"gcash","label":"GCash","active":true},{"id":"bdo","label":"BDO","active":true},{"id":"eastwest","label":"EastWest","active":true}]');
create table tlb.pos_cash_sessions (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references tlb.pos_events(id),
 opening_cents bigint not null check(opening_cents between 0 and 1000000000),
 opened_by uuid not null references auth.users(id), opened_at timestamptz not null default clock_timestamp(),
 opening_note text not null default '', revision integer not null default 1,
 closed_by uuid references auth.users(id), closed_at timestamptz,
 counted_cents bigint check(counted_cents between 0 and 1000000000), expected_at_close_cents bigint,
 closing_note text not null default '',
 check((closed_at is null and closed_by is null and counted_cents is null and expected_at_close_cents is null)
    or (closed_at is not null and closed_by is not null and counted_cents is not null and expected_at_close_cents is not null))
);
create unique index pos_cash_sessions_one_open on tlb.pos_cash_sessions(event_id) where closed_at is null;
create index pos_cash_sessions_event on tlb.pos_cash_sessions(event_id,opened_at desc);
create index pos_cash_sessions_opened_by on tlb.pos_cash_sessions(opened_by);
create index pos_cash_sessions_closed_by on tlb.pos_cash_sessions(closed_by);
create table tlb.pos_cash_movements (
 id uuid primary key, session_id uuid not null references tlb.pos_cash_sessions(id),
 kind text not null check(kind in ('cash_in','cash_out')), amount_cents bigint not null check(amount_cents between 1 and 1000000000),
 note text not null check(length(trim(note)) between 3 and 500),
 actor uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp()
);
create index pos_cash_movements_session on tlb.pos_cash_movements(session_id,created_at);
create index pos_cash_movements_actor on tlb.pos_cash_movements(actor);
create table tlb.pos_session_payments (
 order_id uuid primary key references tlb.orders(id), session_id uuid not null references tlb.pos_cash_sessions(id),
 method text not null, method_label text not null, amount_cents bigint not null check(amount_cents>=0),
 received_cents bigint not null, change_cents bigint not null check(change_cents>=0),
 actor uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 check(received_cents-change_cents=amount_cents)
);
create index pos_session_payments_session on tlb.pos_session_payments(session_id,method);
create index pos_session_payments_actor on tlb.pos_session_payments(actor);
create table tlb.pos_register_actions (
 key uuid primary key, actor uuid not null references auth.users(id), action text not null,
 request_hash text not null, result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create index pos_register_actions_actor on tlb.pos_register_actions(actor);
alter table tlb.pos_register_config enable row level security;
alter table tlb.pos_cash_sessions enable row level security;
alter table tlb.pos_cash_movements enable row level security;
alter table tlb.pos_session_payments enable row level security;
alter table tlb.pos_register_actions enable row level security;
revoke all on tlb.pos_register_config,tlb.pos_cash_sessions,tlb.pos_cash_movements,tlb.pos_session_payments,tlb.pos_register_actions from public,anon,authenticated,service_role;

create function tlb.pos_method_label(p_method text) returns text
language plpgsql stable set search_path='' as $$
declare label text;
begin
 select m->>'label' into label from tlb.pos_register_config c cross join lateral jsonb_array_elements(c.methods) m where m->>'id'=p_method and m->'active'='true'::jsonb;
 perform tlb.require(label is not null,'Choose Cash or an enabled POS payment method. Refresh to see current methods.');
 return label;
end $$;

create function tlb.pos_cash_json(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('event_name',e.name,'cash_collected_cents',p.cash,
 'cash_in_cents',m.cash_in,'cash_out_cents',m.cash_out,
 'expected_cents',coalesce(s.expected_at_close_cents,s.opening_cents+p.cash+m.cash_in-m.cash_out),
 'difference_cents',s.counted_cents-s.expected_at_close_cents,
 'payment_totals',coalesce((select jsonb_agg(to_jsonb(t)) from (
  select method,method_label,count(*) sales,sum(amount_cents) amount_cents from tlb.pos_session_payments where session_id=s.id group by method,method_label order by method_label
 ) t),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(to_jsonb(t) order by created_at desc,id) from (select * from tlb.pos_cash_movements where session_id=s.id order by created_at desc,id limit 100) t),'[]'::jsonb))
 from tlb.pos_cash_sessions s join tlb.pos_events e on e.id=s.event_id
 cross join lateral (select coalesce(sum(amount_cents) filter(where method='cash'),0) cash from tlb.pos_session_payments where session_id=s.id) p
 cross join lateral (select coalesce(sum(amount_cents) filter(where kind='cash_in'),0) cash_in,coalesce(sum(amount_cents) filter(where kind='cash_out'),0) cash_out from tlb.pos_cash_movements where session_id=s.id) m
 where s.id=p_id
$$;

create function tlb.pos_register_api(p_user uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare v_key uuid; hashed text; prior tlb.pos_register_actions; result jsonb; s tlb.pos_cash_sessions; e tlb.pos_events;
 amount bigint; expected bigint; note text; methods jsonb; m jsonb; config tlb.pos_register_config; today date:=(clock_timestamp() at time zone 'Asia/Manila')::date;
begin
 perform tlb.assert_staff(p_user);perform tlb.require(tlb.is_verified(p_user),'Verify your staff email before using POS.');
 if p_action='pos_register_find' then return (select a.result from tlb.pos_register_actions a where a.key=(p_payload->>'idempotency_key')::uuid and a.actor=p_user);end if;
 if p_action='pos_cash_get' then
  result:=tlb.pos_cash_json((p_payload->>'session_id')::uuid);perform tlb.require(result is not null,'Cash session not found.');return result;
 end if;
 perform tlb.require(p_action in ('pos_cash_open','pos_cash_move','pos_cash_close','pos_payment_methods_save'),'Unknown register action.');
 if p_action='pos_payment_methods_save' then perform tlb.assert_staff(p_user,true); end if;
 v_key:=(p_payload->>'idempotency_key')::uuid;perform tlb.require(v_key is not null,'A unique submission key is required.');
 hashed:=encode(extensions.digest(p_payload::text||p_user::text,'sha256'),'hex');
 select * into prior from tlb.pos_register_actions a where a.key=v_key;
 if found then perform tlb.require(prior.actor=p_user and prior.action=p_action and prior.request_hash=hashed,'This submission key belongs to a different request.');return prior.result;end if;
 if p_action='pos_payment_methods_save' then
  select * into config from tlb.pos_register_config where id for update;
  perform tlb.require((p_payload->>'revision')::integer=config.revision,'Payment methods changed. Refresh before saving.');
  methods:=p_payload->'methods';
  perform tlb.require(jsonb_typeof(methods)='array' and jsonb_array_length(methods) between 1 and 50,'Use up to 50 POS payment methods.');
  perform tlb.require(not exists(select 1 from jsonb_array_elements(methods) v group by v->>'id' having count(*)>1),'Use each payment method once.');
  perform tlb.require(exists(select 1 from jsonb_array_elements(methods) v where v->>'id'='cash' and v->>'label'='Cash' and v->'active'='true'::jsonb),'Keep Cash available for cash sessions.');
  result:='[]';
  for m in select value from jsonb_array_elements(methods) loop
   perform tlb.require(exists(select 1 from jsonb_array_elements(config.methods) v where v->>'id'=m->>'id') or coalesce(m->>'id','') ~ '^pos-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$','New payment methods need a unique ID.');
   perform tlb.require(length(trim(coalesce(m->>'label',''))) between 1 and 60,'Enter a payment method name (up to 60 characters).');
   perform tlb.require(jsonb_typeof(m->'active')='boolean','Choose whether the method is available.');
   result:=result||jsonb_build_array(jsonb_build_object('id',m->>'id','label',trim(m->>'label'),'active',m->'active'));
  end loop;
  perform tlb.require(not exists(select 1 from jsonb_array_elements(result) v where v->'active'='true'::jsonb group by lower(v->>'label') having count(*)>1),'Use different names for available payment methods.');
  -- Preserve omitted IDs as disabled so they cannot be reused for another tender.
  for m in select value from jsonb_array_elements(config.methods) v where not exists(select 1 from jsonb_array_elements(result) r where r->>'id'=v->>'id') loop result:=result||jsonb_build_array(m||'{"active":false}'::jsonb);end loop;
  perform tlb.require(jsonb_array_length(result)<=50,'Use up to 50 POS payment methods, including disabled methods.');
  update tlb.pos_register_config set methods=result,revision=revision+1 where id;
  select to_jsonb(c) into result from tlb.pos_register_config c where id;
 elsif p_action='pos_cash_open' then
  select * into e from tlb.pos_events where id=(p_payload->>'event_id')::uuid;
  perform tlb.require(e.id is not null and not e.closed and today between e.starts_on and e.ends_on,'Choose an event open today.');
  perform tlb.require(not exists(select 1 from tlb.pos_cash_sessions where event_id=e.id and closed_at is null),'This event already has an open cash session. Refresh to join the shared drawer.');
  amount:=tlb.pos_integer(p_payload->'opening_cents',1000000000,'Enter the opening cash in the drawer.');
  note:=trim(coalesce(p_payload->>'note',''));perform tlb.require(length(note)<=500,'Use up to 500 characters for the note.');
  insert into tlb.pos_cash_sessions(event_id,opening_cents,opened_by,opening_note) values(e.id,amount,p_user,note) returning * into s;
  result:=tlb.pos_cash_json(s.id);
 else
  select * into s from tlb.pos_cash_sessions where id=(p_payload->>'session_id')::uuid for update;
  perform tlb.require(s.id is not null and s.closed_at is null,'Choose an open cash session.');
  perform tlb.require((p_payload->>'revision')::integer=s.revision,'The drawer changed. Refresh and check the amounts before saving.');
  expected:=(tlb.pos_cash_json(s.id)->>'expected_cents')::bigint;
  note:=trim(coalesce(p_payload->>'note',''));perform tlb.require(length(note)<=500,'Use up to 500 characters for the note.');
  if p_action='pos_cash_move' then
   perform tlb.require(p_payload->>'kind' in ('cash_in','cash_out'),'Choose Cash in or Cash out.');
   amount:=tlb.pos_integer(p_payload->'amount_cents',1000000000,'Enter a valid cash amount.');
   perform tlb.require(amount>0 and length(note)>=3,'Enter an amount and a reason for the cash movement.');
   perform tlb.require(p_payload->>'kind'<>'cash_out' or amount<=expected,'Cash out cannot exceed the expected cash in the drawer.');
   insert into tlb.pos_cash_movements(id,session_id,kind,amount_cents,note,actor) values(v_key,s.id,p_payload->>'kind',amount,note,p_user);
   update tlb.pos_cash_sessions set revision=revision+1 where id=s.id;
  else
   amount:=tlb.pos_integer(p_payload->'counted_cents',1000000000,'Enter the cash counted in the drawer.');
   perform tlb.require(amount=expected or length(note)>=3,'Add a note explaining the cash difference.');
   update tlb.pos_cash_sessions set counted_cents=amount,expected_at_close_cents=expected,closing_note=note,closed_by=p_user,closed_at=clock_timestamp(),revision=revision+1 where id=s.id;
  end if;
  result:=tlb.pos_cash_json(s.id);
 end if;
 insert into tlb.pos_register_actions(key,actor,action,request_hash,result) values(v_key,p_user,p_action,hashed,result);
 return result;
end $$;

create function tlb.pos_register_payment(p_order uuid,p_user uuid,p_payment jsonb) returns void
language plpgsql set search_path='' as $$
declare o tlb.orders; s tlb.pos_cash_sessions; method text:=p_payment->>'method';
begin
 select * into strict o from tlb.orders where id=p_order;
 if o.source<>'popup' then return;end if;
 select * into s from tlb.pos_cash_sessions where event_id=o.pos_event_id and closed_at is null for update;
 -- Rolling deployment: old checkout tabs can finish their existing untracked
 -- event until its first drawer is opened. New clients always send this key.
 if method='cash' and not p_payment ? 'cash_session_id' and s.id is null
  and not exists(select 1 from tlb.pos_cash_sessions where event_id=o.pos_event_id) then return;end if;
 if method='cash' then
  perform tlb.require(s.id is not null,'Open a cash session for this event before accepting cash.');
  perform tlb.require(nullif(p_payment->>'cash_session_id','')::uuid=s.id,'The cash session changed. Refresh and review the sale.');
 elsif nullif(p_payment->>'cash_session_id','') is not null then
  perform tlb.require((p_payment->>'cash_session_id')::uuid=s.id,'The cash session changed. Refresh and review the sale.');
 end if;
 if s.id is null then return;end if;
 insert into tlb.pos_session_payments(order_id,session_id,method,method_label,amount_cents,received_cents,change_cents,actor)
 values(o.id,s.id,method,o.data->>'payment_method_label',o.paid_amount_cents,case when method='cash' then (o.data->>'cash_received_cents')::bigint else o.paid_amount_cents end,case when method='cash' then (o.data->>'change_cents')::bigint else 0 end,p_user);
 update tlb.orders set data=data||jsonb_build_object('cash_session_id',s.id) where id=o.id;
 update tlb.pos_cash_sessions set revision=revision+1 where id=s.id;
end $$;

-- New methods retain labels in sale snapshots; future edits cannot rewrite receipts.
alter table tlb.pos_delivery_payments drop constraint pos_delivery_payments_method_check;
do $migration$
declare fn text; old text; replacement text; patch record;
begin
 for patch in select * from (values
 ('tlb.pos_api(uuid,text,jsonb)',
  ' if p_action=''pos_find_submission'' then',
  ' if p_action in (''pos_cash_open'',''pos_cash_move'',''pos_cash_close'',''pos_cash_get'',''pos_register_find'',''pos_payment_methods_save'') then return tlb.pos_register_api(p_user,p_action,p_payload);end if; if p_action=''pos_find_submission'' then'),
 ('tlb.pos_api(uuid,text,jsonb)',
  'return jsonb_build_object(''events'',',
  'return jsonb_build_object(''register_config'',(select to_jsonb(c) from tlb.pos_register_config c where id),''cash_sessions'',(select coalesce(jsonb_agg(tlb.pos_cash_json(id) order by opened_at desc),''[]'') from (select id,opened_at from tlb.pos_cash_sessions where closed_at is null or id in (select id from tlb.pos_cash_sessions where closed_at is not null order by closed_at desc limit 50)) sessions),''events'','),
 ('tlb.pos_receive_payment(uuid,uuid,jsonb)',
  'perform tlb.require(v_method in (''cash'',''gcash'',''bdo'',''eastwest''),''Choose Cash, GCash, BDO or EastWest.'');',
  'perform tlb.pos_method_label(v_method);'),
 ('tlb.pos_receive_payment(uuid,uuid,jsonb)',
  '''payment_method'',v_method,',
  '''payment_method'',v_method,''payment_method_label'',tlb.pos_method_label(v_method),'),
 ('tlb.pos_receive_payment(uuid,uuid,jsonb)',
  'update tlb.allocations set state=''committed'' where order_id=p_id and state=''held'';',
  'update tlb.allocations set state=''committed'' where order_id=p_id and state=''held''; perform tlb.pos_register_payment(p_id,p_user,p_payment);'),
 ('tlb.pos_delivery_api(uuid,text,jsonb)',
  'perform tlb.require(method_value in (''cash'',''gcash'',''bdo'',''eastwest''),''Choose Cash, GCash, BDO or EastWest.'');',
  'perform tlb.pos_method_label(method_value);'),
 ('tlb.pos_delivery_api(uuid,text,jsonb)',
  '''delivery_payment_method'',method_value,',
  '''delivery_payment_method'',method_value,''delivery_payment_method_label'',tlb.pos_method_label(method_value),'),
 ('tlb.accounting_rows_v2(date,date)',
  'coalesce(o.data->>''delivery_payment_method'','''')',
  'coalesce(o.data->>''delivery_payment_method_label'',o.data->>''delivery_payment_method'','''')'),
 ('tlb.accounting_rows_v2(date,date)',
  'coalesce(o.data->>''payment_method'','''')',
  'coalesce(o.data->>''payment_method_label'',o.data->>''payment_method'','''')')
 ) as patches(signature,needle,replacement) loop
  fn:=pg_get_functiondef(patch.signature::regprocedure);
  if position(patch.needle in fn)=0 then raise exception 'Register migration marker missing: % / %',patch.signature,patch.needle;end if;
  execute replace(fn,patch.needle,patch.replacement);
 end loop;
 fn:=pg_get_functiondef('tlb.pos_event_json(uuid)'::regprocedure);
 old:='coalesce(data->>''payment_method'',''unknown'')';replacement:='coalesce(data->>''payment_method_label'',data->>''payment_method'',''unknown'')';
 if position(old in fn)=0 or position('group by data->>''payment_method''' in fn)=0 then raise exception 'Event payment summary marker missing';end if;
 execute replace(replace(fn,old,replacement),'group by data->>''payment_method''','group by '||replacement);
end $migration$;
revoke all on function tlb.pos_method_label(text),tlb.pos_cash_json(uuid),tlb.pos_register_api(uuid,text,jsonb),tlb.pos_register_payment(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
