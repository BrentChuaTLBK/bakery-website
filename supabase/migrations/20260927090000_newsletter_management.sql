-- Owner-managed defaults are copied into each newly issued welcome code.
alter table tlb.newsletter_config add column if not exists welcome_offer jsonb not null default '{"enabled":true,"kind":"percent","value":5,"min_subtotal_cents":30000,"cap_cents":10000,"valid_days":30,"expires_at":null}';
alter table tlb.newsletter_config add column if not exists offer_revision bigint not null default 1;
create or replace function public.newsletter_offer() returns jsonb language sql stable security definer set search_path='' as $$
 select welcome_offer||jsonb_build_object('revision',offer_revision,'enabled',coalesce((welcome_offer->>'enabled')::boolean,false) and (welcome_offer->>'expires_at' is null or (welcome_offer->>'expires_at')::timestamptz>now())) from tlb.newsletter_config where singleton
$$;
revoke all on function public.newsletter_offer() from public;
grant execute on function public.newsletter_offer() to anon,authenticated;

create table if not exists tlb.newsletter_campaigns (
 id uuid primary key,revision integer not null default 1,content jsonb not null,
 status text not null default 'draft' check(status in('draft','queued')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),queued_at timestamptz
);
create table if not exists tlb.newsletter_campaign_tokens (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),email text not null references tlb.newsletter_subscribers(email),
 subscription_hash text not null,campaign_id uuid not null references tlb.newsletter_campaigns(id),created_at timestamptz not null default now()
);
create index if not exists outbox_campaign_reporting_idx on tlb.outbox ((payload->>'campaign_id'),status) where event_type='newsletter_campaign';
create index if not exists newsletter_campaign_tokens_email_idx on tlb.newsletter_campaign_tokens(email);
alter table tlb.newsletter_campaigns enable row level security;
alter table tlb.newsletter_campaign_tokens enable row level security;
revoke all on tlb.newsletter_campaigns,tlb.newsletter_campaign_tokens from public,anon,authenticated,service_role;
alter table tlb.outbox drop constraint if exists outbox_order_reference;
alter table tlb.outbox add constraint outbox_order_reference check (
 (event_type in('newsletter_welcome','newsletter_campaign','newsletter_test') and order_id is null)
 or (event_type not in('newsletter_welcome','newsletter_campaign','newsletter_test') and order_id is not null)
);
create or replace function public.newsletter_admin(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();cfg tlb.newsletter_config;c tlb.newsletter_campaigns;doc jsonb;target uuid;recipient record;token text;settings jsonb;counted integer:=0;key text;test_id uuid;
begin
 perform tlb.assert_staff(u,true);
 if p_action='load' then
  return jsonb_build_object('offer',public.newsletter_offer(),'subscriber_count',(select count(*) from tlb.newsletter_subscribers where status='subscribed' and operation_kind is distinct from 'unsubscribe'),
   'campaigns',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (select n.*,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text) recipient_count,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text and o.status='sent') sent_count,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text and o.status='skipped') skipped_count,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text and o.status='failed') failed_count
    from tlb.newsletter_campaigns n order by n.updated_at desc limit 100) x),'[]'));
 elsif p_action='save_offer' then
  select * into cfg from tlb.newsletter_config where singleton for update;
  perform tlb.require((p_payload->>'revision')::bigint=cfg.offer_revision,'Offer settings changed. Refresh before saving.');
  doc:=p_payload->'offer';
  perform tlb.require(jsonb_typeof(doc)='object' and jsonb_typeof(doc->'enabled')='boolean','Check the welcome offer settings.');
  perform tlb.require(doc->>'kind' in('percent','fixed'),'Choose percentage or fixed amount.');
  perform tlb.require((doc->>'value')::integer>0 and (doc->>'value')::integer<=case when doc->>'kind'='percent' then 100 else 100000000 end,'Enter a valid discount.');
  perform tlb.require((doc->>'min_subtotal_cents')::integer between 0 and 100000000 and (doc->>'cap_cents' is null or (doc->>'cap_cents')::integer between 1 and 100000000),'Check the minimum purchase and maximum discount.');
  perform tlb.require((doc->>'valid_days')::integer between 1 and 3660,'Validity must be 1 to 3,660 days.');
  perform tlb.require(doc->>'expires_at' is null or (doc->>'expires_at')::timestamptz>now(),'Choose a future expiry or leave it blank.');
  doc:=jsonb_build_object('enabled',(doc->>'enabled')::boolean,'kind',doc->>'kind','value',(doc->>'value')::integer,'min_subtotal_cents',(doc->>'min_subtotal_cents')::integer,'cap_cents',(doc->>'cap_cents')::integer,'valid_days',(doc->>'valid_days')::integer,'expires_at',(doc->>'expires_at')::timestamptz);
  update tlb.newsletter_config set welcome_offer=doc,offer_revision=offer_revision+1 where singleton;
  return public.newsletter_offer();
 end if;
 target:=(p_payload->>'id')::uuid;
 perform tlb.require(target is not null,'Newsletter ID is required.');
 perform pg_advisory_xact_lock(hashtextextended('newsletter:'||target::text,0));
 select * into c from tlb.newsletter_campaigns where id=target for update;
 if p_action='save' then
  perform tlb.require(c.id is null or c.status='draft','Sent newsletters cannot be edited. Create a new draft.');
  perform tlb.require(coalesce(c.revision,0)=coalesce((p_payload->>'revision')::integer,0),'This newsletter changed. Refresh before saving.');
  doc:=p_payload->'content';
  perform tlb.require(jsonb_typeof(doc)='object' and length(doc::text)<=30000,'Newsletter content is too large.');
  perform tlb.require(doc->>'template' in('showcase','offer','journal'),'Choose a newsletter template.');
  perform tlb.require(length(btrim(doc->>'subject')) between 1 and 150 and length(btrim(doc->>'title')) between 1 and 180,'Add a subject and headline.');
  perform tlb.require(length(coalesce(doc->>'preheader',''))<=200 and length(coalesce(doc->>'body',''))<=10000 and length(coalesce(doc->>'intro',''))<=4000,'Shorten the newsletter text.');
  perform tlb.require(doc->>'cta_url' ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$','Use an HTTPS button link without credentials.');
  perform tlb.require(coalesce(doc->>'hero_url','')='' or doc->>'hero_url' ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$','Use an HTTPS photo link.');
  perform tlb.require(jsonb_typeof(doc->'items')='array' and jsonb_array_length(doc->'items')<=4,'Choose at most four featured products.');
  for recipient in select value from jsonb_array_elements(doc->'items') loop
   perform tlb.require(jsonb_typeof(recipient.value)='object' and length(coalesce(recipient.value->>'name',''))<=160 and length(coalesce(recipient.value->>'description',''))<=1000,'Check featured product text.');
   perform tlb.require(coalesce(recipient.value->>'image_url','')='' or recipient.value->>'image_url' ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$','Use HTTPS product photo links.');
  end loop;
  insert into tlb.newsletter_campaigns(id,content,created_by) values(target,doc,u) on conflict(id) do update set content=excluded.content,revision=tlb.newsletter_campaigns.revision+1,updated_at=now() returning * into c;
  return to_jsonb(c);
 end if;
 perform tlb.require(c.id is not null,'Newsletter not found.');
 if p_action='queue' and c.status='queued' then return to_jsonb(c); end if;
 perform tlb.require(c.revision=(p_payload->>'revision')::integer,'This newsletter changed. Save or refresh before continuing.');
 if p_action='delete' then
  perform tlb.require(c.status='draft','Only unsent drafts can be deleted.');
  delete from tlb.newsletter_campaigns where id=c.id;return jsonb_build_object('deleted',true);
 elsif p_action in('queue','test') then
  perform tlb.require(c.status='draft','This newsletter has already been queued.');
  perform tlb.require(p_action='test' or p_payload->'confirm'='true'::jsonb,'Confirm sending to newsletter subscribers.');
  select * into cfg from tlb.newsletter_config where singleton;
  select data into settings from tlb.settings where id;
  perform tlb.require(cfg.topic_id is not null and cfg.site_url ~ '^https://' and length(coalesce(settings->>'pickup_address',''))>0,'Set the newsletter topic, website and shop address before sending.');
  settings:=jsonb_build_object('site_url',cfg.site_url,'shop_name',settings->>'shop_name','pickup_address',settings->>'pickup_address','contact_email',settings->>'contact_email','contact_phone',settings->>'contact_phone');
  if p_action='test' then
   test_id:=(p_payload->>'request_id')::uuid;perform tlb.require(test_id is not null,'A test request ID is required.');
   key:='newsletter-test:'||test_id::text;
   if exists(select 1 from tlb.outbox where event_key=key) then return jsonb_build_object('queued',1,'test',true); end if;
   perform tlb.require((select count(*) from tlb.outbox where event_type='newsletter_test' and created_at>now()-interval '1 hour')<20,'Wait before sending more test emails.');
   select email into token from auth.users where id=u;
   insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values(key,'newsletter_test',token,'[TEST] '||(c.content->>'subject'),jsonb_build_object('event_type','newsletter_test','campaign_id',c.id,'content',c.content,'settings',settings));
   return jsonb_build_object('queued',1,'test',true,'email',token);
  end if;
  if nullif(btrim(c.content->>'offer_code'),'') is not null then
   perform tlb.require(exists(select 1 from tlb.promos p where p.code=upper(btrim(c.content->>'offer_code')) and (p.data->>'active')::boolean and p.data->>'deleted_at' is null and p.data->>'source' is distinct from 'newsletter_welcome' and (p.data->>'expires_at' is null or (p.data->>'expires_at')::timestamptz>now())),'Choose an active regular promo code before sending. Personal welcome codes cannot be sent to everyone.');
  end if;
  for recipient in select * from tlb.newsletter_subscribers where status='subscribed' and unsubscribe_token_hash is not null and operation_kind is distinct from 'unsubscribe' loop
   token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into tlb.newsletter_campaign_tokens(token_hash,email,subscription_hash,campaign_id) values(encode(extensions.digest(token,'sha256'),'hex'),recipient.email,recipient.unsubscribe_token_hash,c.id);
   insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('newsletter-campaign:'||c.id::text||':'||encode(extensions.digest(recipient.email,'sha256'),'hex'),'newsletter_campaign',recipient.email,c.content->>'subject',jsonb_build_object('event_type','newsletter_campaign','campaign_id',c.id,'content',c.content,'settings',settings,'topic_id',cfg.topic_id,'unsubscribe_token',token,'unsubscribe_token_hash',recipient.unsubscribe_token_hash));
   counted:=counted+1;
  end loop;
  perform tlb.require(counted>0,'There are no eligible subscribers to send to yet.');
  update tlb.newsletter_campaigns set status='queued',queued_at=now(),updated_at=now() where id=c.id returning * into c;
  return to_jsonb(c)||jsonb_build_object('queued',counted);
 end if;
 raise exception 'Unknown newsletter action' using errcode='22023';
end;
$$;
revoke all on function public.newsletter_admin(text,jsonb) from public,anon,service_role;
grant execute on function public.newsletter_admin(text,jsonb) to authenticated;

-- Keep issued codes valid; all future welcome codes use six characters.
create or replace function tlb.queue_newsletter_welcome(p_email text,p_token text)
returns void language plpgsql set search_path='' as $$
declare
  v_row tlb.newsletter_subscribers;
  v_config tlb.newsletter_config;
  v_settings jsonb;
  v_offer jsonb;
  v_defaults jsonb;
  v_promo_id uuid;
  v_code text;
  v_random bytea;
  v_issued_at timestamptz:=clock_timestamp();
begin
  select * into v_row from tlb.newsletter_subscribers where email=p_email for update;
  if v_row.status is distinct from 'subscribed' or p_token is null or p_token !~ '^[0-9a-f]{64}$'
    or v_row.unsubscribe_token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then
    raise exception 'Invalid welcome subscription' using errcode='22023';
  end if;
  v_defaults:=public.newsletter_offer();
  if (v_defaults->>'enabled')::boolean and v_row.welcome_offer_eligible and v_row.welcome_promo_id is null then
    v_promo_id:=gen_random_uuid();
    loop
      v_random:=extensions.gen_random_bytes(6);
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',get_byte(v_random,i)%32+1,1),'' order by i)
        into v_code from generate_series(0,5) as i;
      -- Easy to type, always a mix, without ambiguous I/O/0/1 characters.
      if v_code !~ '[A-Z]' or v_code !~ '[2-9]' then continue; end if;
    v_offer:=jsonb_build_object('id',v_promo_id,'code',v_code,'kind',v_defaults->>'kind','value',(v_defaults->>'value')::integer,
      'min_subtotal_cents',(v_defaults->>'min_subtotal_cents')::integer,'cap_cents',(v_defaults->>'cap_cents')::integer,'valid_days',(v_defaults->>'valid_days')::integer,'global_limit',1,'per_account_limit',1,
      'active',true,'expires_at',least(v_issued_at+make_interval(days=>(v_defaults->>'valid_days')::integer),(v_defaults->>'expires_at')::timestamptz),'issued_at',v_issued_at,
      'source','newsletter_welcome');
      insert into tlb.promos(id,code,data) values(v_promo_id,v_code,v_offer) on conflict(code) do nothing;
      exit when found; -- Retry a collision with any existing manual/welcome code.
    end loop;
    update tlb.newsletter_subscribers set welcome_promo_id=v_promo_id,welcome_issued_at=v_issued_at where email=p_email;
  end if;
  select * into v_config from tlb.newsletter_config where singleton;
  select data into v_settings from tlb.settings where id;
  insert into tlb.outbox(event_key,event_type,to_email,subject,payload)
  values('newsletter-welcome:'||v_row.request_id::text,'newsletter_welcome',v_row.email,
    case when v_offer is not null then 'Welcome to TLB — your '||case when v_offer->>'kind'='percent' then v_offer->>'value'||'%' else '₱'||to_char((v_offer->>'value')::numeric/100,'FM999999990.00') end||' OFF code!' else 'Welcome to the TLB newsletter!' end,
    jsonb_build_object('event_type','newsletter_welcome','welcome_email_version',2,'topic_id',v_config.topic_id,
      'unsubscribe_token',p_token,'unsubscribe_token_hash',v_row.unsubscribe_token_hash,
      'settings',jsonb_build_object('site_url',v_config.site_url,'shop_name',v_settings->>'shop_name',
        'pickup_address',v_settings->>'pickup_address','contact_email',v_settings->>'contact_email',
        'contact_phone',v_settings->>'contact_phone'))
      ||case when v_offer is null then '{}'::jsonb else jsonb_build_object('welcome_offer',v_offer) end)
  on conflict(event_key) do nothing;
end;
$$;
revoke all on function tlb.queue_newsletter_welcome(text,text) from public,anon,authenticated,service_role;


-- Retain the existing lease, local consent and provider suppression checks.
do $patch$ declare def text;old text;new text;begin
 def:=replace(pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 def:=replace(def,$old$e.event_type='newsletter_welcome'$old$,$new$e.event_type in ('newsletter_welcome','newsletter_campaign')$new$);
 def:=replace(def,'order by created_at for update skip locked limit v_limit', 'order by case when event_type in (''newsletter_campaign'',''newsletter_test'') then 1 else 0 end,created_at for update skip locked limit v_limit');
 execute def;
 def:=replace(pg_get_functiondef('public.newsletter_service(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 old:='where unsubscribe_token_hash=v_token for update';
 new:='where unsubscribe_token_hash=v_token or exists(select 1 from tlb.newsletter_campaign_tokens t where t.token_hash=v_token and t.email=tlb.newsletter_subscribers.email and t.subscription_hash=tlb.newsletter_subscribers.unsubscribe_token_hash) for update';
 if position(new in def)=0 then
  if position(old in def)=0 then raise exception 'Newsletter unsubscribe anchor missing';end if;
  execute replace(def,old,new);
 end if;
end $patch$;
