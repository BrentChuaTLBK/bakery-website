-- Campaigns are one Resend Broadcast, never a fan-out of transactional emails.
create table if not exists tlb.newsletter_broadcast_jobs (
 campaign_id uuid primary key references tlb.newsletter_campaigns(id),
 content jsonb not null,settings jsonb not null,segment_id text not null,topic_id text not null,
 recipient_estimate integer not null,
 status text not null default 'pending' check(status in('pending','processing','accepted','sent','canceled','needs_review')),
 provider_id text,provider_status text,send_started_at timestamptz,
 lease_token uuid,leased_until timestamptz,next_attempt_at timestamptz not null default now(),
 attempts integer not null default 0,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table tlb.newsletter_broadcast_jobs enable row level security;
revoke all on tlb.newsletter_broadcast_jobs from public,anon,authenticated,service_role;
create index if not exists newsletter_broadcast_pending_idx on tlb.newsletter_broadcast_jobs(next_attempt_at) where status in('pending','processing','accepted');

create or replace function public.newsletter_admin(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();cfg tlb.newsletter_config;c tlb.newsletter_campaigns;doc jsonb;target uuid;recipient record;token text;settings jsonb;counted integer:=0;key text;test_id uuid;
begin
 perform tlb.assert_staff(u,true);
 if p_action='load' then
  return jsonb_build_object('offer',public.newsletter_offer(),'subscriber_count',(select count(*) from tlb.newsletter_subscribers where status='subscribed' and operation_kind is distinct from 'unsubscribe'),
   'campaigns',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (select n.*,
    case when b.campaign_id is not null then 'broadcast' else 'legacy' end delivery_method,
    b.status broadcast_status,b.provider_id broadcast_id,b.recipient_estimate,b.last_error broadcast_error,
    b.provider_status,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text) recipient_count,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text and o.status='sent') sent_count,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text and o.status='skipped') skipped_count,
    (select count(*) from tlb.outbox o where o.event_type='newsletter_campaign' and o.payload->>'campaign_id'=n.id::text and o.status='failed') failed_count
    from tlb.newsletter_campaigns n left join tlb.newsletter_broadcast_jobs b on b.campaign_id=n.id order by n.updated_at desc limit 100) x),'[]'));
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
  perform tlb.require(nullif(cfg.segment_id,'') is not null,'Configure the TLB Newsletter segment before sending.');
  select count(*) into counted from tlb.newsletter_subscribers where status='subscribed' and operation_kind is distinct from 'unsubscribe';
  perform tlb.require(counted>0,'There are no eligible subscribers to send to yet.');
  insert into tlb.newsletter_broadcast_jobs(campaign_id,content,settings,segment_id,topic_id,recipient_estimate)
  values(c.id,c.content,settings,cfg.segment_id,cfg.topic_id,counted);
  update tlb.newsletter_campaigns set status='queued',queued_at=now(),updated_at=now() where id=c.id returning * into c;
  return to_jsonb(c)||jsonb_build_object('queued',counted,'delivery_method','broadcast','broadcast_status','pending');
 end if;
 raise exception 'Unknown newsletter action' using errcode='22023';
end;
$$;
revoke all on function public.newsletter_admin(text,jsonb) from public,anon,service_role;
grant execute on function public.newsletter_admin(text,jsonb) to authenticated;


-- Only the existing authenticated email worker can lease and advance jobs.
create or replace function public.newsletter_broadcast_service(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare j tlb.newsletter_broadcast_jobs; target uuid; terminal boolean; next_status text;
begin
 if p_action='claim' then
  select * into j from tlb.newsletter_broadcast_jobs
   where status in('pending','processing','accepted') and next_attempt_at<=now()
    and (leased_until is null or leased_until<now())
   order by created_at for update skip locked limit 1;
  if j.campaign_id is null then return null; end if;
  update tlb.newsletter_broadcast_jobs set status='processing',lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
   where campaign_id=j.campaign_id returning * into j;
  return to_jsonb(j);
 end if;
 target:=(p_payload->>'id')::uuid;
 select * into j from tlb.newsletter_broadcast_jobs where campaign_id=target for update;
 perform tlb.require(j.campaign_id is not null and j.status='processing' and j.lease_token=(p_payload->>'lease_token')::uuid and j.leased_until>now(),'Broadcast lease expired.');
 if p_action='record_draft' then
  perform tlb.require(p_payload->>'provider_id' ~ '^[0-9a-fA-F-]{36}$','Invalid Broadcast ID.');
  perform tlb.require(j.provider_id is null or j.provider_id=p_payload->>'provider_id','Broadcast ID cannot change.');
  update tlb.newsletter_broadcast_jobs set provider_id=p_payload->>'provider_id',provider_status='draft' where campaign_id=target;
 elsif p_action='begin_send' then
  perform tlb.require(j.provider_id is not null and j.send_started_at is null,'This Broadcast send was already started. Check Resend before retrying.');
  -- Local opt-out intent is recorded before provider sync. Wait for it to finish.
  if exists(select 1 from tlb.newsletter_subscribers where operation_kind='unsubscribe') then
   update tlb.newsletter_broadcast_jobs set status='pending',lease_token=null,leased_until=null,next_attempt_at=now()+interval '1 minute',attempts=greatest(attempts-1,0),last_error='Waiting for newsletter preference updates.' where campaign_id=target;
   return jsonb_build_object('deferred',true);
  end if;
  update tlb.newsletter_broadcast_jobs set send_started_at=now() where campaign_id=target;
 elsif p_action='accepted' then
  perform tlb.require(p_payload->>'provider_status' in('queued','scheduled','sent','canceled'),'Invalid Broadcast status.');
  next_status:=case p_payload->>'provider_status' when 'sent' then 'sent' when 'canceled' then 'canceled' else 'accepted' end;
  update tlb.newsletter_broadcast_jobs set status=next_status,provider_status=p_payload->>'provider_status',lease_token=null,leased_until=null,
   next_attempt_at=now()+interval '5 minutes',attempts=0,last_error=null where campaign_id=target;
 elsif p_action='failed' then
  terminal:=coalesce((p_payload->>'terminal')::boolean,false) or j.attempts>=5;
  update tlb.newsletter_broadcast_jobs set status=case when terminal then 'needs_review' else 'pending' end,
   last_error=left(coalesce(p_payload->>'error','Broadcast delivery needs review.'),500),lease_token=null,leased_until=null,
   next_attempt_at=now()+make_interval(secs=>least(900,30*greatest(j.attempts,1))) where campaign_id=target;
 else raise exception 'Unknown Broadcast action' using errcode='22023';
 end if;
 update tlb.newsletter_broadcast_jobs set updated_at=now() where campaign_id=target;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.newsletter_broadcast_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.newsletter_broadcast_service(text,jsonb) to service_role;
