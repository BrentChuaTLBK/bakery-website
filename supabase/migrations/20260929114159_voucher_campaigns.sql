begin;

create table tlb.voucher_campaigns (
 id uuid primary key default gen_random_uuid(), name text not null,
 status text not null default 'draft' check(status in ('draft','active','paused')),
 terms jsonb not null, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id)
);
-- Durable completion history prevents status toggles and campaign restarts issuing twice.
create table tlb.voucher_completions (
 order_id uuid primary key references tlb.orders(id), user_id uuid references auth.users(id), customer_key text not null,
 completed_at timestamptz not null default now()
);
create index voucher_completions_customer on tlb.voucher_completions(user_id,completed_at);
create index voucher_completions_email on tlb.voucher_completions(customer_key,completed_at);
create table tlb.vouchers (
 promo_id uuid primary key references tlb.promos(id), campaign_id uuid not null references tlb.voucher_campaigns(id),
 user_id uuid references auth.users(id), owner_email text not null, source_order_id uuid not null references tlb.orders(id),
 title text not null, issued_at timestamptz not null default now(),
 unique(campaign_id,source_order_id)
);
create index vouchers_customer on tlb.vouchers(user_id,issued_at desc);
create index vouchers_campaign_customer on tlb.vouchers(campaign_id,user_id);
create index vouchers_campaign_email on tlb.vouchers(campaign_id,owner_email);
create index vouchers_guest_email on tlb.vouchers(owner_email,issued_at desc) where user_id is null;
create index vouchers_source on tlb.vouchers(source_order_id);
do $$ declare t text; begin
 foreach t in array array['voucher_campaigns','voucher_completions','vouchers'] loop
  execute format('alter table tlb.%I enable row level security',t);
  execute format('revoke all on tlb.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Existing completions establish history only. No retroactive offers or emails.
insert into tlb.voucher_completions(order_id,user_id,customer_key,completed_at)
 select o.id,o.user_id,lower(btrim(coalesce(u.email,o.data#>>'{buyer,email}'))),o.created_at
 from tlb.orders o left join auth.users u on u.id=o.user_id
 where nullif(btrim(coalesce(u.email,o.data#>>'{buyer,email}')),'') is not null
 and o.source='website'
 and o.payment_status='paid' and o.fulfillment_status='completed' and not o.refund_label;

-- Private unsubscribe tokens remain bound to the current consent version.
create table tlb.voucher_email_tokens (
 token_hash text primary key, email text not null references tlb.newsletter_subscribers(email),
 subscription_hash text not null, voucher_id uuid not null unique references tlb.vouchers(promo_id)
);
create index voucher_email_tokens_email on tlb.voucher_email_tokens(email);
create index voucher_campaigns_creator on tlb.voucher_campaigns(created_by);
alter table tlb.voucher_email_tokens enable row level security;
revoke all on tlb.voucher_email_tokens from public,anon,authenticated,service_role;
alter table tlb.outbox add column voucher_id uuid references tlb.vouchers(promo_id);
create unique index outbox_voucher on tlb.outbox(voucher_id) where voucher_id is not null;
alter table tlb.outbox drop constraint outbox_order_reference;
alter table tlb.outbox add constraint outbox_order_reference check (
 (event_type in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher') and order_id is null)
 or (event_type not in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher') and order_id is not null));
alter table tlb.voucher_campaigns add column email_subject text not null
 default 'A little thank-you from TLB · your next-order voucher'
 check(length(btrim(email_subject)) between 1 and 200 and email_subject !~ '[[:cntrl:]]');

create function tlb.voucher_email_subject(p text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare subject text:=btrim(coalesce(p,'A little thank-you from TLB · your next-order voucher'));
begin
 perform tlb.require(length(subject) between 1 and 200 and subject !~ '[[:cntrl:]]','Enter an email subject of 1–200 characters on one line.');
 return subject;
end $$;
revoke all on function tlb.voucher_email_subject(text) from public,anon,authenticated,service_role;

alter table tlb.voucher_campaigns add column email_copy jsonb not null default '{}'::jsonb
 check(jsonb_typeof(email_copy)='object');

create function tlb.voucher_email_copy(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare c jsonb:=coalesce(p,'{}'::jsonb); k text; label text; heading text; message text;
begin
 perform tlb.require(jsonb_typeof(c)='object','Provide email text.');
 foreach k in array array['eyebrow','heading','message'] loop
  perform tlb.require(not (c ? k) or jsonb_typeof(c->k)='string','Email text must be plain text.');
 end loop;
 label:=btrim(coalesce(c->>'eyebrow','A little thank-you from TLB'));
 heading:=btrim(coalesce(c->>'heading','{{discount}} off your next order.'));
 message:=btrim(replace(replace(coalesce(c->>'message','Your order is complete. Thank you for ordering with TLB—we hope you enjoyed every bite. Here’s a little treat for your next order.'),E'\r\n',E'\n'),E'\r',E'\n'));
 perform tlb.require(length(label) between 1 and 120 and label !~ '[[:cntrl:]]','Enter a small heading of 1–120 characters on one line.');
 perform tlb.require(length(heading) between 1 and 200 and heading !~ '[[:cntrl:]]','Enter a main heading of 1–200 characters on one line.');
 perform tlb.require(length(message) between 1 and 4000 and message ~ '[^[:space:]]' and replace(message,E'\n','') !~ '[[:cntrl:]]','Enter a message of 1–4,000 characters.');
 return jsonb_build_object('eyebrow',label,'heading',heading,'message',message);
end $$;
revoke all on function tlb.voucher_email_copy(jsonb) from public,anon,authenticated,service_role;

create function tlb.voucher_terms(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text; expiry timestamptz;
begin
 perform tlb.require(jsonb_typeof(p)='object','Provide campaign terms.');
 perform tlb.require(p->>'trigger' in ('first_completed','every_completed'),'Choose when customers earn a voucher.');
 perform tlb.require(p->>'kind' in ('fixed','percent'),'Choose a discount type.');
 foreach k in array array['value','min_subtotal_cents','customer_limit'] loop
  perform tlb.require(jsonb_typeof(p->k)='number' and p->>k ~ '^[0-9]{1,9}$','Use whole numbers for amounts and limits.');
 end loop;
 perform tlb.require((p->>'value')::integer between 1 and case when p->>'kind'='percent' then 100 else 100000000 end,'Enter a valid discount.');
 perform tlb.require((p->>'min_subtotal_cents')::integer between 0 and 100000000,'Enter a valid minimum product spend.');
 perform tlb.require((p->>'customer_limit')::integer between 1 and 100,'Set a customer issue limit from 1 to 100.');
 if p->>'kind'='percent' then
  perform tlb.require(jsonb_typeof(p->'cap_cents')='number' and p->>'cap_cents' ~ '^[0-9]{1,9}$' and (p->>'cap_cents')::integer between 1 and 100000000,'Set a positive maximum percentage discount.');
 end if;
 perform tlb.require(p->>'expiry_mode' in ('days','fixed'),'Choose how vouchers expire.');
 if p->>'expiry_mode'='days' then
  perform tlb.require(jsonb_typeof(p->'expiry_days')='number' and p->>'expiry_days' ~ '^[0-9]{1,3}$' and (p->>'expiry_days')::integer between 1 and 365,'Set an expiry of 1–365 days.');
 else
  expiry:=(p->>'expires_at')::timestamptz;
  perform tlb.require(expiry is not null and isfinite(expiry),'Set a valid expiry date.');
 end if;
 return jsonb_build_object('trigger',p->>'trigger','kind',p->>'kind','value',(p->>'value')::integer,
  'min_subtotal_cents',(p->>'min_subtotal_cents')::integer,'customer_limit',(p->>'customer_limit')::integer,
  'cap_cents',case when p->>'kind'='percent' then (p->>'cap_cents')::integer end,
  'expiry_mode',p->>'expiry_mode','expiry_days',case when p->>'expiry_mode'='days' then (p->>'expiry_days')::integer end,'expires_at',expiry);
end $$;

create function tlb.voucher_source_valid(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from tlb.vouchers v join tlb.orders o on o.id=v.source_order_id
  where v.promo_id=p_id and o.payment_status='paid' and not o.refund_label
  and o.fulfillment_status not in ('cancelled','expired'))
$$;

create function tlb.voucher_email_settings() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('site_url',c.site_url,'shop_name',s.data->>'shop_name','pickup_address',s.data->>'pickup_address','contact_email',s.data->>'contact_email','contact_phone',s.data->>'contact_phone') from tlb.newsletter_config c cross join tlb.settings s where c.singleton and s.id
$$;
create function tlb.voucher_completed_order() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c tlb.voucher_campaigns; s tlb.newsletter_subscribers; account auth.users;
 first_order boolean; promo uuid; v_code text; expiry timestamptz; offer jsonb; attempts integer; opted_in boolean; recipient_email text; unsubscribe_token text;
begin
 if new.source<>'website'
  or new.payment_status<>'paid' or new.fulfillment_status<>'completed' or new.refund_label then return new;end if;
 perform pg_advisory_xact_lock(841721950318::bigint);
 select * into account from auth.users where id=new.user_id;
 recipient_email:=lower(btrim(coalesce(account.email,new.data#>>'{buyer,email}')));
 if nullif(recipient_email,'') is null then return new;end if;
 insert into tlb.voucher_completions(order_id,user_id,customer_key) values(new.id,new.user_id,recipient_email) on conflict do nothing;
 if not found then return new;end if;
 first_order:=not exists(select 1 from tlb.voucher_completions where (user_id=new.user_id or customer_key=recipient_email) and order_id<>new.id);
 select * into s from tlb.newsletter_subscribers where email=recipient_email;
 opted_in:=coalesce(s.status='subscribed' and s.operation_kind is distinct from 'unsubscribe',false);
 for c in select * from tlb.voucher_campaigns where status='active' order by id loop
  if c.terms->>'trigger'='first_completed' and not first_order then continue;end if;
  if (select count(*) from tlb.vouchers where campaign_id=c.id and (user_id=new.user_id or owner_email=recipient_email))>=(c.terms->>'customer_limit')::integer then continue;end if;
  expiry:=case when c.terms->>'expiry_mode'='days' then now()+make_interval(days=>(c.terms->>'expiry_days')::integer) else (c.terms->>'expires_at')::timestamptz end;
  if expiry<=now() then continue;end if;
  promo:=gen_random_uuid();attempts:=0;
  loop
   attempts:=attempts+1;perform tlb.require(attempts<=12,'Unable to generate a unique voucher. Please retry.');
   v_code:='TLB-'||upper(encode(extensions.gen_random_bytes(5),'hex'));
   offer:=jsonb_build_object('id',promo,'code',v_code,'kind',c.terms->>'kind','value',c.terms->'value',
    'min_subtotal_cents',c.terms->'min_subtotal_cents','cap_cents',c.terms->'cap_cents',
    'per_account_limit',1,'global_limit',1,'expires_at',expiry,'active',true,'voucher_managed',true);
   insert into tlb.promos(id,code,data) values(promo,v_code,offer) on conflict(code) do nothing;
   exit when found;
  end loop;
  insert into tlb.vouchers(promo_id,campaign_id,user_id,owner_email,source_order_id,title) values(promo,c.id,new.user_id,recipient_email,new.id,c.name);
  unsubscribe_token:=null;
  if opted_in then
   unsubscribe_token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into tlb.voucher_email_tokens(token_hash,email,subscription_hash,voucher_id)
    values(encode(extensions.digest(unsubscribe_token,'sha256'),'hex'),recipient_email,s.unsubscribe_token_hash,promo);
  end if;
  insert into tlb.outbox(event_key,event_type,voucher_id,to_email,subject,payload,status,last_error)
   values('voucher:'||promo,'newsletter_voucher',promo,recipient_email,c.email_subject,
   jsonb_build_object('event_type','newsletter_voucher','title',c.name,'offer',offer,'email_copy',c.email_copy,
    'subscriber',jsonb_build_object('email',recipient_email),'topic_id',(select topic_id from tlb.newsletter_config where singleton),
    'unsubscribe_token',unsubscribe_token,'unsubscribe_token_hash',s.unsubscribe_token_hash,'settings',tlb.voucher_email_settings()),
   case when opted_in then 'pending' else 'skipped' end,case when not opted_in then 'Customer is not subscribed to marketing emails. Voucher remains in their account.' end);
 end loop;
 return new;
end $$;
create trigger tlb_issue_completed_voucher after insert or update of payment_status,fulfillment_status,refund_label on tlb.orders
 for each row execute function tlb.voucher_completed_order();

-- Personal offers release refunded/cancelled redemptions, retaining the original expiry.
create or replace function tlb.promo_use_counts(p_order uuid,p_promo uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select (not exists(select 1 from tlb.newsletter_subscribers where welcome_promo_id=p_promo)
  and not exists(select 1 from tlb.vouchers where promo_id=p_promo))
 or exists(select 1 from tlb.orders where id=p_order and not refund_label
  and fulfillment_status not in ('cancelled','expired') and payment_status not in ('rejected','cancelled'))
$$;

create function tlb.voucher_check(p_promo uuid,p_user uuid,p_admin boolean) returns void
language plpgsql stable security invoker set search_path='' as $$
declare v tlb.vouchers;
begin
 select * into v from tlb.vouchers where promo_id=p_promo;
 if found then
  perform tlb.require(not p_admin,'Personal vouchers can only be applied by the customer at website checkout.');
  perform tlb.require(tlb.is_verified(p_user) and (v.user_id=p_user or (v.user_id is null and exists(select 1 from auth.users where id=p_user and lower(btrim(email))=v.owner_email))),'Sign in to the verified account that earned this voucher, or use the verified email from your guest checkout.');
  perform tlb.require(tlb.voucher_source_valid(p_promo),'This voucher is unavailable because its qualifying order was cancelled or refunded.');
 end if;
end $$;

-- One shared lifecycle calculation powers reports and the account wallet.
create view tlb.voucher_facts with (security_invoker=true) as
 with issued as (
  select v.promo_id,v.campaign_id,v.user_id,v.owner_email email,v.title,v.issued_at,tlb.voucher_source_valid(v.promo_id) source_valid,'order'::text source
   from tlb.vouchers v
  union all
  select n.welcome_promo_id,null::uuid,null::uuid,n.email,'Your welcome treat',n.welcome_issued_at,true,'newsletter'
   from tlb.newsletter_subscribers n where n.welcome_promo_id is not null
 )
 select i.*,p.code,p.data terms,(p.data->>'expires_at')::timestamptz expires_at,
  case when use.paid_orders>0 then 'used' when use.reserved>0 then 'reserved'
   when not i.source_valid or not coalesce((p.data->>'active')::boolean,false) or p.data->>'deleted_at' is not null then 'inactive'
   when (p.data->>'expires_at')::timestamptz<=now() then 'expired' else 'available' end status,
  use.paid_orders,use.sales_cents,use.discount_cents,e.status email_status,e.last_error email_note
 from issued i join tlb.promos p on p.id=i.promo_id
 left join tlb.outbox e on e.voucher_id=i.promo_id or (i.source='newsletter' and e.event_type='newsletter_welcome' and e.payload#>>'{welcome_offer,id}'=i.promo_id::text)
 cross join lateral (
  select count(*) filter(where o.payment_status='paid') paid_orders,
   count(*) filter(where u.state='reserved' and o.payment_status in ('awaiting_payment','under_review')) reserved,
   coalesce(sum(greatest(0,(o.data->>'subtotal_cents')::bigint-(o.data->>'discount_cents')::bigint)) filter(where o.payment_status='paid'),0) sales_cents,
   coalesce(sum((o.data->>'discount_cents')::bigint) filter(where o.payment_status='paid'),0) discount_cents
  from tlb.promo_usage u join tlb.orders o on o.id=u.order_id
  where u.promo_id=i.promo_id and o.fulfillment_status not in ('cancelled','expired') and not o.refund_label
   and o.payment_status not in ('cancelled','rejected')
   and (o.payment_status<>'awaiting_payment' or o.fulfillment_status<>'pending_confirmation'
    or o.payment_deadline>now())
 ) use;
revoke all on tlb.voucher_facts from public,anon,authenticated,service_role;

create function tlb.voucher_card(f tlb.voucher_facts) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',f.promo_id,'title',f.title,'source',f.source,'code',f.code,'issued_at',f.issued_at,
 'expires_at',f.expires_at,'status',f.status,'kind',f.terms->'kind','value',f.terms->'value',
 'min_subtotal_cents',f.terms->'min_subtotal_cents','cap_cents',f.terms->'cap_cents')
$$;

create or replace function tlb.voucher_api(p_action text,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c tlb.voucher_campaigns; v jsonb; t jsonb; result jsonb; k text; n text; st text;
 offset_rows integer:=greatest(coalesce((p->>'offset')::integer,0),0); total bigint; account_email text;
begin
 if p_action='my_vouchers' then
  perform tlb.require(tlb.is_verified(auth.uid()),'Verify your account email to view your vouchers.');
  select lower(btrim(email)) into account_email from auth.users where id=auth.uid();
  st:=coalesce(p->>'status','available');
  perform tlb.require(st in ('available','used','expired'),'Choose a voucher tab.');
  with mine as (select * from tlb.voucher_facts where user_id=auth.uid() or (user_id is null and email=account_email)),
  filtered as (select * from mine where case when st='available' then status in ('available','reserved') when st='expired' then status in ('expired','inactive') else status=st end),
  page as (select * from filtered order by issued_at desc,promo_id limit 50 offset offset_rows)
  select jsonb_build_object('vouchers',(select coalesce(jsonb_agg(tlb.voucher_card(page) order by issued_at desc,promo_id),'[]') from page),
   'total',(select count(*) from filtered),'offset',offset_rows,'limit',50,
   'counts',(select jsonb_build_object('available',count(*) filter(where status in ('available','reserved')),'used',count(*) filter(where status='used'),'expired',count(*) filter(where status in ('expired','inactive'))) from mine)) into result;
  return result;
 end if;
 perform tlb.assert_staff(auth.uid(),true);
 if p_action='voucher_email_preview' then
  v:=p->'campaign';
  if v is null then select to_jsonb(x) into v from tlb.voucher_campaigns x where id=(p->>'id')::uuid; end if;
  perform tlb.require(v is not null,'Choose a campaign.');
  t:=tlb.voucher_terms(v->'terms');
  return jsonb_build_object('subject',tlb.voucher_email_subject(v->>'email_subject'),'payload',jsonb_build_object(
   'event_type','newsletter_voucher','email_copy',tlb.voucher_email_copy(v->'email_copy'),'settings',tlb.voucher_email_settings(),
   'subscriber',jsonb_build_object('email','preview@example.test'),'unsubscribe_token',repeat('0',64),
   'offer',t||jsonb_build_object('code','TLB-PREVIEW','expires_at',case when t->>'expiry_mode'='days' then now()+make_interval(days=>(t->>'expiry_days')::integer) else (t->>'expires_at')::timestamptz end)));
 end if;
 if p_action='voucher_save_campaign' then
  v:=p->'campaign';perform tlb.require(jsonb_typeof(v)='object','Provide a campaign.');
  n:=btrim(v->>'name');st:=coalesce(v->>'status','draft');
  perform tlb.require(length(n) between 1 and 120 and n !~ '[[:cntrl:]]','Enter a campaign name of 1–120 characters.');
  perform tlb.require(st in ('draft','active','paused'),'Choose a campaign status.');
  t:=tlb.voucher_terms(v->'terms');
  perform tlb.require(st<>'active' or t->>'expiry_mode'<>'fixed' or (t->>'expires_at')::timestamptz>now(),'Choose a future expiry before activating this campaign.');
  perform pg_advisory_xact_lock(841721950318::bigint);
  if nullif(v->>'id','') is null then
   perform tlb.require(st='draft','Save and review a draft before activating a campaign.');
   perform tlb.require((select count(*) from tlb.voucher_campaigns)<200,'The campaign limit has been reached.');
   insert into tlb.voucher_campaigns(name,terms,email_subject,email_copy,created_by) values(n,t,tlb.voucher_email_subject(v->>'email_subject'),tlb.voucher_email_copy(v->'email_copy'),auth.uid()) returning * into c;
  else
   select * into c from tlb.voucher_campaigns where id=(v->>'id')::uuid for update;
   perform tlb.require(found,'Campaign not found.');
   perform tlb.require((v->>'revision')::integer=c.revision,'Campaign changed. Refresh before saving.');
   perform tlb.require(c.status='draft' or st<>'draft','Pause a published campaign instead of returning it to draft.');
   update tlb.voucher_campaigns set name=n,status=st,terms=t,email_subject=case when v ? 'email_subject' then tlb.voucher_email_subject(v->>'email_subject') else c.email_subject end,email_copy=case when v ? 'email_copy' then tlb.voucher_email_copy(v->'email_copy') else c.email_copy end,revision=revision+1,updated_at=now() where id=c.id returning * into c;
  end if;
  return to_jsonb(c)-'created_by';
 elsif p_action='voucher_campaigns' then
  with stats as (select campaign_id,jsonb_build_object('issued',count(*),'used',count(*) filter(where status='used'),
   'expired',count(*) filter(where status='expired'),'available',count(*) filter(where status='available'),
   'reserved',count(*) filter(where status='reserved'),'inactive',count(*) filter(where status='inactive'),
   'sales_cents',coalesce(sum(sales_cents),0),'discount_cents',coalesce(sum(discount_cents),0),
   'emails_accepted',count(*) filter(where email_status='sent'),'emails_pending',count(*) filter(where email_status in ('pending','sending')),
   'emails_failed',count(*) filter(where email_status='failed'),'emails_skipped',count(*) filter(where email_status='skipped')) data
   from tlb.voucher_facts where campaign_id is not null group by campaign_id)
  select coalesce(jsonb_agg((to_jsonb(campaign_row)-'created_by')||jsonb_build_object('stats',coalesce(s.data,'{}')) order by campaign_row.created_at desc),'[]') into result
   from tlb.voucher_campaigns campaign_row left join stats s on s.campaign_id=campaign_row.id;
  return jsonb_build_object('campaigns',result);
 elsif p_action='voucher_campaign_report' then
  select * into c from tlb.voucher_campaigns where id=(p->>'id')::uuid;
  perform tlb.require(found,'Campaign not found.');
  with filtered as (select f.*,coalesce(u.email,f.email) customer_email from tlb.voucher_facts f left join auth.users u on u.id=f.user_id where f.campaign_id=c.id),
  page as (select * from filtered order by issued_at desc,promo_id limit 50 offset offset_rows)
  select jsonb_build_object('total',(select count(*) from filtered),'offset',offset_rows,'limit',50,
   'vouchers',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'email',customer_email,'issued_at',issued_at,'expires_at',expires_at,
    'status',status,'sales_cents',sales_cents,'discount_cents',discount_cents,'email_status',email_status,'email_note',email_note) order by issued_at desc,promo_id),'[]') from page)) into result;
  return result;
 end if;
 raise exception 'Unknown voucher action.' using errcode='22023';
end $$;

create function tlb.newsletter_restore_use() returns trigger
language plpgsql security invoker set search_path='' as $$
declare promo uuid;
begin
 if (old.refund_label or old.fulfillment_status in ('cancelled','expired'))
  and not new.refund_label and new.fulfillment_status not in ('cancelled','expired') and new.payment_status='paid' then
  select usage.promo_id into promo from tlb.promo_usage usage where usage.order_id=new.id and (exists(select 1 from tlb.newsletter_subscribers n where n.welcome_promo_id=usage.promo_id) or exists(select 1 from tlb.vouchers v where v.promo_id=usage.promo_id));
  if promo is not null then
   perform pg_advisory_xact_lock(841721950318::bigint);
   perform tlb.require(not exists(select 1 from tlb.promo_usage where promo_id=promo and order_id<>new.id and tlb.promo_use_counts(order_id,promo_id)),
    'This personal voucher has already been reused on another active order. Cancel that unpaid order or resolve its refund before restoring this order.');
  end if;
 end if;
 return new;
end $$;
revoke all on function tlb.newsletter_restore_use() from public,anon,authenticated,service_role;
create trigger tlb_newsletter_restore_use before update of payment_status,refund_label,fulfillment_status on tlb.orders for each row execute function tlb.newsletter_restore_use();

-- A single-use personal offer can be reused after a refund/cancellation, never after expiry.
-- Ordinary promotional codes retain their original lifetime-use accounting.
do $patch$ declare d text; h text; n text; begin
 d:=replace(pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure),E'\r\n',E'\n');
 h:=' role_name:=tlb.role_for(u);';
 perform tlb.require(position(h in d)>0,'Missing voucher API entry hook.');
 d:=replace(d,h,h||$new$
 if p_action in ('my_vouchers','voucher_campaigns','voucher_campaign_report','voucher_save_campaign','voucher_email_preview') then return tlb.voucher_api(p_action,p_payload); end if;
 if p_action in ('save_promo','delete_promo') then
  perform tlb.assert_staff(u,true);
  perform tlb.require(not exists(select 1 from tlb.vouchers where promo_id=coalesce(nullif(p_payload->>'id',''),nullif(p_payload#>>'{promo,id}',''))::uuid),'Issued vouchers keep their original terms. Manage future offers in Automatic offers.');
 end if;
 $new$);
 h:=$h$promo->>'deleted_at' is null$h$;
 perform tlb.require(position(h in d)>0,'Missing manual promo filter.');
 d:=replace(d,h,h||$new$ and promo->>'voucher_managed' is distinct from 'true'$new$);
 execute replace(d,E'\n',E'\r\n');
 d:=replace(pg_get_functiondef('tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)'::regprocedure),E'\r\n',E'\n');
 h:=$h$   perform tlb.require(promo is not null,'Promo code not found.');$h$;
 perform tlb.require(position(h in d)>0,'Missing voucher redemption check.');
 d:=replace(d,h,h||E'\n   perform tlb.voucher_check((promo->>''id'')::uuid,p_user,p_admin);');
 h:='from tlb.promo_usage where tlb.promo_usage.promo_id=v_promo_id';
 perform tlb.require((length(d)-length(replace(d,h,'')))/length(h)=2,'Missing promo use limit hooks.');
 execute replace(replace(d,h,h||' and tlb.promo_use_counts(order_id,promo_id)'),E'\n',E'\r\n');
 d:=replace(pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 h:=$h$e.event_type in ('newsletter_welcome','newsletter_campaign')$h$;
 perform tlb.require(position(h in d)>0,'Missing marketing consent hooks.');
 d:=replace(d,h,$new$e.event_type in ('newsletter_welcome','newsletter_campaign','newsletter_voucher')$new$);
 h:=$h$   if e.event_type in ('newsletter_welcome','newsletter_campaign','newsletter_voucher') and not exists ($h$;
 perform tlb.require(position(h in d)>0,'Missing email preparation hook.');
 d:=replace(d,h,$new$   if e.event_type='newsletter_voucher' and (
    not tlb.voucher_source_valid(e.voucher_id) or (e.payload#>>'{offer,expires_at}')::timestamptz<=now()
    or not exists(select 1 from tlb.vouchers v left join auth.users u on u.id=v.user_id
      where v.promo_id=e.voucher_id and lower(btrim(coalesce(u.email,v.owner_email)))=e.to_email)) then
    update tlb.outbox set status='skipped',last_error='Voucher eligibility or recipient changed before delivery.',lease_token=null,leased_until=null where id=e.id;
    return jsonb_build_object('skip',true);
   end if;
 $new$||h);
 execute replace(d,E'\n',E'\r\n');
 d:=pg_get_functiondef('public.newsletter_service(text,jsonb)'::regprocedure);
 h:=$h$  elsif p_action='begin_unsubscribe' then$h$;
 perform tlb.require(position(h in d)>0,'Missing unsubscribe token hook.');
 execute replace(d,h,h||$new$
    -- Resolve this consent-bound token without changing the existing subscriber lookup.
    select coalesce((select t.subscription_hash from tlb.voucher_email_tokens t join tlb.newsletter_subscribers n on n.email=t.email and n.unsubscribe_token_hash=t.subscription_hash where t.token_hash=v_token),v_token) into v_token;
 $new$);
 -- Never allow a personal thank-you code to be broadcast to the whole mailing list.
 d:=pg_get_functiondef('public.newsletter_admin(text,jsonb)'::regprocedure);
 h:=$h$p.data->>'source' is distinct from 'newsletter_welcome'$h$;
 perform tlb.require(position(h in d)>0,'Missing newsletter shared-promo guard.');
 execute replace(d,h,h||$new$ and p.data->>'voucher_managed' is distinct from 'true'$new$);
 -- Newsletter reporting follows the same retained-use rules as the new wallet.
 d:=pg_get_functiondef('tlb.newsletter_promo_report()'::regprocedure);
 h:='group by pu.promo_id';
 perform tlb.require(position(h in d)>0,'Missing personal offer reporting hook.');
 execute replace(d,h,'where tlb.promo_use_counts(pu.order_id,pu.promo_id) '||h);
end $patch$;

revoke all on function tlb.voucher_terms(jsonb),tlb.voucher_source_valid(uuid),tlb.voucher_completed_order(),
 tlb.voucher_check(uuid,uuid,boolean),tlb.voucher_card(tlb.voucher_facts),tlb.voucher_api(text,jsonb),
 tlb.promo_use_counts(uuid,uuid),tlb.voucher_email_settings()
 from public,anon,authenticated,service_role;
commit;
