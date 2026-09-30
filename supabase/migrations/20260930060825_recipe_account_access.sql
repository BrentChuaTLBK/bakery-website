begin;
set local lock_timeout='3s';
alter table tlb.recipe_prices alter column created_at set default clock_timestamp();
create unique index recipe_purchase_request on tlb.recipe_audit(actor,(details->>'request_id')) where action='purchase_recorded';
-- Recipe-only accounts must not acquire shop, POS or accounting privileges.
alter table tlb.recipe_access drop constraint recipe_access_user_id_fkey;
alter table tlb.recipe_access add foreign key(user_id) references auth.users(id) on delete cascade;
create table tlb.recipe_invitations (
 id uuid primary key default gen_random_uuid(), email text not null unique,
 permission text not null check(permission in ('chef','kitchen')),
 revision integer not null default 1, granted_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '14 days',
 accepted_by uuid references auth.users(id) on delete set null, accepted_at timestamptz, revoked_at timestamptz,
 last_emailed_at timestamptz,
 check(email=lower(btrim(email)) and length(email) between 3 and 254)
);
create index recipe_invitation_granter on tlb.recipe_invitations(granted_by);
create index recipe_invitation_recipient on tlb.recipe_invitations(accepted_by);
alter table tlb.recipe_invitations enable row level security;
revoke all on tlb.recipe_invitations from public,anon,authenticated,service_role;

create function tlb.recipe_claim_access() returns void language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); address text; invitation tlb.recipe_invitations;
begin
 if not tlb.is_verified(u) then return;end if;
 select lower(btrim(email)) into address from auth.users where id=u;
 select * into invitation from tlb.recipe_invitations where email=address and accepted_at is null and revoked_at is null and expires_at>now() for update;
 if not found then return;end if;
 insert into tlb.recipe_access(user_id,permission,granted_by) values(u,invitation.permission,invitation.granted_by) on conflict(user_id) do nothing;
 update tlb.recipe_invitations set accepted_by=u,accepted_at=now(),updated_at=now() where id=invitation.id;
 insert into tlb.recipe_audit(actor,action,details) values(u,'invitation_accepted',jsonb_build_object('invitation_id',invitation.id));
end $$;
revoke all on function tlb.recipe_claim_access() from public,anon,authenticated,service_role;

alter table tlb.outbox drop constraint outbox_order_reference;
alter table tlb.outbox add constraint outbox_order_reference check (
 (event_type in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher','operational_alert','recipe_access_invitation') and order_id is null)
 or (event_type not in ('newsletter_welcome','newsletter_campaign','newsletter_test','newsletter_voucher','operational_alert','recipe_access_invitation') and order_id is not null));

alter function public.recipe_api(text,jsonb) rename to recipe_api_before_account_access;
alter function public.recipe_api_before_account_access(text,jsonb) set schema tlb;
revoke all on function tlb.recipe_api_before_account_access(text,jsonb) from public,anon,authenticated,service_role;
-- Compare only the latest quote from each current supplier, in compatible units.
create function tlb.recipe_current_price(p_resource uuid,p_unit text default null,p_currency text default 'PHP') returns tlb.recipe_prices
language sql stable security invoker set search_path='' as $$
 with resource as (select * from tlb.recipe_resources where id=p_resource), latest as (
  select distinct on (p.supplier_id) p.* from tlb.recipe_prices p where p.resource_id=p_resource order by p.supplier_id,p.created_at desc,p.id
 ), basis as (
  select tlb.recipe_unit(coalesce(nullif(p_unit,''),nullif(r.data->>'default_unit',''),(select unit from latest order by created_at desc,id limit 1))) unit from resource r
 ) select p.* from latest p cross join basis b cross join resource r
 where p.currency=p_currency and tlb.recipe_unit(p.unit)->>0=b.unit->>0
 and (nullif(r.data->>'preferred_supplier_id','') is null or p.supplier_id=nullif(r.data->>'preferred_supplier_id','')::uuid)
 and ((p.supplier_id is null and coalesce((r.data->>'allow_unassigned_price')::boolean,true)) or exists(select 1 from tlb.recipe_supplier_items i join tlb.recipe_resources s on s.id=i.supplier_id where i.resource_id=p_resource and i.supplier_id=p.supplier_id and s.active))
 order by p.amount/p.quantity/(tlb.recipe_unit(p.unit)->>1)::numeric,p.created_at desc,p.id limit 1
$$;
revoke all on function tlb.recipe_current_price(uuid,text,text) from public,anon,authenticated,service_role;
do $$ declare source text; begin
 source:=pg_get_functiondef('tlb.recipe_capture_costs(jsonb)'::regprocedure);
 if strpos(source,'into price from tlb.recipe_prices p where resource_id=(r->>''ingredient_id'')::uuid order by created_at desc,id limit 1')=0 then raise exception 'Recipe costing changed; review migration.';end if;
 source:=replace(source,'into price from tlb.recipe_prices p where resource_id=(r->>''ingredient_id'')::uuid order by created_at desc,id limit 1','into price from tlb.recipe_current_price((r->>''ingredient_id'')::uuid,r->>''unit'',currency) p where p.id is not null');
 source:=replace(source,'select to_jsonb(p) into price from tlb.recipe_prices p where resource_id=(extra->>''resource_id'')::uuid order by created_at desc,id limit 1','select to_jsonb(p) into price from tlb.recipe_current_price((extra->>''resource_id'')::uuid,extra->>''unit'',currency) p where p.id is not null');
 execute source;
end $$;
create function public.recipe_api(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid; address text; permission_name text; invitation tlb.recipe_invitations; response jsonb; changed boolean; email_status text; photo jsonb; photos jsonb:='[]'; attachment tlb.recipe_files; offer jsonb; suppliers uuid[]:='{}'; saved_resource_id uuid; previous tlb.recipe_prices; quoted_amount numeric; quoted_quantity numeric; resource tlb.recipe_resources; supplier_name text; item_name text; purchase_data jsonb; request_id uuid;
begin
 if p_action='bootstrap' then perform tlb.recipe_claim_access();end if;
 if p_action='record_purchase' then
  perform tlb.recipe_assert(true);request_id:=(p_payload->>'request_id')::uuid;perform tlb.require(request_id is not null,'A purchase request ID is required.');
  perform pg_advisory_xact_lock(hashtextextended('tlb.recipe.record-purchase',0));
  select details into response from tlb.recipe_audit where actor=uid and action='purchase_recorded' and details->>'request_id'=request_id::text;
  if found then perform tlb.require(response->'request'=p_payload,'This purchase was already saved with different details. Open Record purchase again for a new purchase.');return response->'result';end if;
  supplier_name:=regexp_replace(btrim(p_payload->>'supplier_name'),'\s+',' ','g');item_name:=regexp_replace(btrim(p_payload->>'name'),'\s+',' ','g');
  perform tlb.require(length(supplier_name) between 1 and 200 and length(item_name) between 1 and 200,'Enter the supplier and ingredient or packaging name.');
  perform tlb.require(p_payload->>'kind' in ('ingredient','packaging'),'Choose an ingredient or packaging purchase.');
  quoted_amount:=tlb.recipe_quantity(p_payload->>'amount');quoted_quantity:=tlb.recipe_quantity(p_payload->>'quantity');perform tlb.require(quoted_quantity>0 and nullif(btrim(p_payload->>'unit'),'') is not null,'Enter a positive purchase quantity and its unit.');
  select id into target from tlb.recipe_resources where kind='supplier' and lower(regexp_replace(btrim(name),'\s+',' ','g'))=lower(supplier_name) order by created_at limit 1;
  if target is null then response:=public.recipe_api('save_resource',jsonb_build_object('kind','supplier','name',supplier_name,'data','{}'::jsonb));target:=(response->>'id')::uuid;end if;
  if nullif(p_payload->>'resource_id','') is not null then
   select * into resource from tlb.recipe_resources where id=(p_payload->>'resource_id')::uuid and kind=p_payload->>'kind';perform tlb.require(found,'Selected item no longer exists.');
   perform tlb.require(coalesce(resource.data->>'brand','')='' or lower(resource.data->>'brand')=lower(btrim(coalesce(p_payload->>'brand',''))),'The selected ingredient has a different brand. Create a separate ingredient for that brand.');
  else
   select * into resource from tlb.recipe_resources where kind=p_payload->>'kind' and lower(regexp_replace(btrim(name),'\s+',' ','g'))=lower(item_name) and lower(coalesce(data->>'brand',''))=lower(btrim(coalesce(p_payload->>'brand',''))) order by created_at limit 1;
  end if;
  purchase_data:=coalesce(resource.data,'{}')||jsonb_build_object('brand',btrim(coalesce(p_payload->>'brand','')),'default_unit',coalesce(nullif(resource.data->>'default_unit',''),btrim(p_payload->>'unit')));
  if coalesce((p_payload->>'preferred')::boolean,false) then purchase_data:=purchase_data||jsonb_build_object('preferred_supplier_id',target);end if;
  response:=public.recipe_api('save_resource',jsonb_build_object('id',resource.id,'revision',resource.revision,'kind',p_payload->>'kind','name',coalesce(resource.name,item_name),'data',purchase_data,'price',jsonb_build_object('amount',quoted_amount,'quantity',quoted_quantity,'unit',btrim(p_payload->>'unit'),'currency','PHP','supplier_id',target,'notes',coalesce(p_payload->>'notes',''))));
  response:=jsonb_build_object('resource_id',response->>'id','supplier_id',target,'saved',true);
  insert into tlb.recipe_audit(actor,action,details) values(uid,'purchase_recorded',jsonb_build_object('request_id',request_id,'request',p_payload,'result',response,'amount',quoted_amount,'quantity',quoted_quantity,'unit',p_payload->>'unit','supplier_name',supplier_name));
  return response;
 end if;
 if p_action='prices' then
  response:=tlb.recipe_api_before_account_access(p_action,p_payload);
  return coalesce((select jsonb_agg(p||jsonb_build_object('supplier_name',(select name from tlb.recipe_resources where id=nullif(p->>'supplier_id','')::uuid))) from jsonb_array_elements(response) p),'[]');
 end if;
 if p_action='resources' then
  response:=tlb.recipe_api_before_account_access(p_action,p_payload);
  return jsonb_build_object('rows',coalesce((select jsonb_agg(r||jsonb_build_object('price',(select to_jsonb(p) from tlb.recipe_current_price((r->>'id')::uuid) p where p.id is not null),'suppliers',coalesce((select jsonb_agg(jsonb_build_object('supplier_id',i.supplier_id,'name',s.name,'notes',i.notes,'active',s.active,'price',(select to_jsonb(p) from tlb.recipe_prices p where p.resource_id=i.resource_id and p.supplier_id=i.supplier_id order by created_at desc,id limit 1)) order by s.name) from tlb.recipe_supplier_items i join tlb.recipe_resources s on s.id=i.supplier_id where i.resource_id=(r->>'id')::uuid),'[]'),'unassigned_price',(select to_jsonb(p) from tlb.recipe_prices p where p.resource_id=(r->>'id')::uuid and p.supplier_id is null order by created_at desc,id limit 1))) from jsonb_array_elements(response->'rows') r),'[]'));
 end if;
 if p_action='save_resource' then
  perform tlb.recipe_assert(true);
  target:=nullif(p_payload#>>'{data,supplier_id}','')::uuid;
  if target is not null then
   perform tlb.require(p_payload->>'kind' in ('ingredient','packaging') and exists(select 1 from tlb.recipe_resources where id=target and kind='supplier'),'Supplier not found.');
  end if;
  if p_payload#>'{data,photos}' is not null then
   perform tlb.require(p_payload->>'kind'='packaging' and jsonb_typeof(p_payload#>'{data,photos}')='array','Packaging photos must be a list.');
   perform tlb.require(jsonb_array_length(p_payload#>'{data,photos}')<=10,'Use up to 10 packaging photos.');
   for photo in select value from jsonb_array_elements(p_payload#>'{data,photos}') loop
    select * into attachment from tlb.recipe_files where id=(photo->>'file_id')::uuid and uploaded and mime_type in ('image/jpeg','image/png','image/webp');
    perform tlb.require(found,'Finish uploading a valid packaging photo before saving.');
    photos:=photos||jsonb_build_array(jsonb_build_object('file_id',attachment.id,'path',attachment.path,'filename',attachment.filename,'caption',left(coalesce(photo->>'caption',''),500)));
   end loop;
   p_payload:=jsonb_set(p_payload,'{data,photos}',photos);
  end if;
  if p_payload->'suppliers' is not null then
   perform tlb.require(p_payload->>'kind' in ('ingredient','packaging') and jsonb_typeof(p_payload->'suppliers')='array','Supplier quotes must be a list.');
   perform tlb.require(jsonb_array_length(p_payload->'suppliers') between 1 and 30,'Keep between 1 and 30 supplier options.');
   p_payload:=jsonb_set(p_payload,'{data,allow_unassigned_price}',to_jsonb(exists(select 1 from jsonb_array_elements(p_payload->'suppliers') o where nullif(o->>'supplier_id','') is null)));
  end if;
  response:=tlb.recipe_api_before_account_access(p_action,case when p_payload->'suppliers' is null then p_payload else p_payload-'price' end);
  saved_resource_id:=(response->>'id')::uuid;
  if target is not null then insert into tlb.recipe_supplier_items(resource_id,supplier_id) values((response->>'id')::uuid,target) on conflict do nothing;end if;
  if p_payload->'suppliers' is not null then
   for offer in select value from jsonb_array_elements(p_payload->'suppliers') loop
    target:=nullif(offer->>'supplier_id','')::uuid;
    perform tlb.require(not(coalesce(target,'00000000-0000-0000-0000-000000000000')=any(suppliers)),'Each supplier can appear only once.');suppliers:=array_append(suppliers,coalesce(target,'00000000-0000-0000-0000-000000000000'));
    if target is not null then
     perform tlb.require(exists(select 1 from tlb.recipe_resources where id=target and kind='supplier'),'Supplier not found.');
     insert into tlb.recipe_supplier_items(resource_id,supplier_id,notes) values(saved_resource_id,target,left(coalesce(offer->>'notes',''),2000)) on conflict on constraint recipe_supplier_items_pkey do update set notes=excluded.notes;
    end if;
    if nullif(offer#>>'{price,amount}','') is not null then
     quoted_amount:=tlb.recipe_quantity(offer#>>'{price,amount}');quoted_quantity:=tlb.recipe_quantity(offer#>>'{price,quantity}');
     select * into previous from tlb.recipe_prices p where p.resource_id=saved_resource_id and p.supplier_id is not distinct from target order by created_at desc,id limit 1;
     if previous.id is null or previous.amount<>quoted_amount or previous.quantity<>quoted_quantity or previous.unit is distinct from offer#>>'{price,unit}' then
      insert into tlb.recipe_prices(resource_id,supplier_id,amount,quantity,unit,currency,created_by) values(saved_resource_id,target,quoted_amount,quoted_quantity,offer#>>'{price,unit}','PHP',uid);
     end if;
    end if;
   end loop;
   delete from tlb.recipe_supplier_items i where i.resource_id=saved_resource_id and not(i.supplier_id=any(suppliers));
  end if;
  target:=nullif(p_payload#>>'{data,preferred_supplier_id}','')::uuid;
  if target is not null then perform tlb.require(exists(select 1 from tlb.recipe_supplier_items i where i.resource_id=saved_resource_id and i.supplier_id=target),'The preferred supplier must be listed for this item.');end if;
  return response;
 end if;
 if p_action in ('access','invite_access','save_access','remove_invitation') then
  perform tlb.recipe_assert(true,true);
  if p_action='access' then
   return (select coalesce(jsonb_agg(row order by row->>'email'),'[]') from (
    select jsonb_build_object('user_id',u.id,'email',u.email,'role',s.role,'recipe_permission',a.permission,'status',case when u.email_confirmed_at is null then 'Email verification required' else 'Active' end) row
    from auth.users u left join tlb.staff s on s.user_id=u.id left join tlb.recipe_access a on a.user_id=u.id where s.user_id is not null or a.user_id is not null
    union all
    select jsonb_build_object('invitation_id',i.id,'email',i.email,'recipe_permission',i.permission,'status',case when i.expires_at<=now() then 'Invitation expired' else 'Awaiting sign-up / email verification' end,'expires_at',i.expires_at,
     'email_status',(select status from tlb.outbox where event_key='recipe-access:'||i.id||':'||i.revision))
    from tlb.recipe_invitations i where accepted_at is null and revoked_at is null
   ) q);
  elsif p_action='save_access' then
   target:=(p_payload->>'user_id')::uuid;permission_name:=nullif(p_payload->>'permission','');
   perform tlb.require(exists(select 1 from auth.users where id=target),'Account not found.');
   perform tlb.require(tlb.role_for(target) is distinct from 'owner','Owners retain full recipe access.');
   if permission_name is null then
    delete from tlb.recipe_access where user_id=target;
    update tlb.recipe_invitations set revoked_at=now(),updated_at=now() where accepted_by=target and revoked_at is null;
   else
    perform tlb.require(permission_name in ('chef','kitchen'),'Choose Chef or Kitchen access.');
    perform tlb.require(tlb.is_verified(target),'The account must verify its email first.');
    insert into tlb.recipe_access(user_id,permission,granted_by) values(target,permission_name,uid) on conflict(user_id) do update set permission=excluded.permission,granted_by=uid,updated_at=now();
   end if;
   insert into tlb.recipe_audit(actor,action,details) values(uid,'access_changed',jsonb_build_object('user_id',target,'permission',permission_name));
   return jsonb_build_object('saved',true);
  elsif p_action='remove_invitation' then
   update tlb.recipe_invitations set revoked_at=now(),updated_at=now() where id=(p_payload->>'invitation_id')::uuid and accepted_at is null returning * into invitation;
   perform tlb.require(found,'Pending invitation not found.');
   update tlb.outbox set status='skipped',last_error='Invitation was revoked.' where event_type='recipe_access_invitation' and payload->>'invitation_id'=invitation.id::text and status='pending';
   insert into tlb.recipe_audit(actor,action,details) values(uid,'invitation_revoked',jsonb_build_object('invitation_id',invitation.id));
   return jsonb_build_object('saved',true);
  end if;
  address:=lower(btrim(p_payload->>'email'));permission_name:=p_payload->>'permission';
  perform tlb.require(address is not null and length(address)<=254 and address ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$','Enter a valid email address.');
  perform tlb.require(permission_name in ('chef','kitchen'),'Choose Chef or Kitchen access.');
  select id into target from auth.users where lower(btrim(email))=address and email_confirmed_at is not null order by created_at limit 1;
  perform tlb.require(target is null or tlb.role_for(target) is distinct from 'owner','That account already has owner access.');
  select * into invitation from tlb.recipe_invitations where email=address for update;
  changed:=not found or invitation.revoked_at is not null or invitation.expires_at<=now() or invitation.permission<>permission_name or coalesce((p_payload->>'resend')::boolean,false);
  if coalesce((p_payload->>'resend')::boolean,false) then perform tlb.require(invitation.last_emailed_at is null or invitation.last_emailed_at<now()-interval '1 minute','Wait one minute before sending another invitation.');end if;
  insert into tlb.recipe_invitations(email,permission,granted_by,accepted_by,accepted_at) values(address,permission_name,uid,target,case when target is not null then now() end)
  on conflict(email) do update set permission=excluded.permission,granted_by=uid,revision=tlb.recipe_invitations.revision+case when changed then 1 else 0 end,
   revoked_at=null,expires_at=case when changed then now()+interval '14 days' else tlb.recipe_invitations.expires_at end,updated_at=now(),
   accepted_by=excluded.accepted_by,accepted_at=case when excluded.accepted_by is not null then coalesce(tlb.recipe_invitations.accepted_at,now()) else null end
  returning * into invitation;
  if target is not null then
   insert into tlb.recipe_access(user_id,permission,granted_by) values(target,permission_name,uid) on conflict(user_id) do update set permission=excluded.permission,granted_by=uid,updated_at=now();
  end if;
  if coalesce((p_payload->>'send_email')::boolean,true) then
   insert into tlb.outbox(event_key,event_type,to_email,subject,payload) values('recipe-access:'||invitation.id||':'||invitation.revision,'recipe_access_invitation',address,'Your TLB recipe library access',
    jsonb_build_object('event_type','recipe_access_invitation','invitation_id',invitation.id,'revision',invitation.revision,'email',address,'permission',permission_name)) on conflict(event_key) do nothing;
   update tlb.recipe_invitations set last_emailed_at=now() where id=invitation.id;
   select status into email_status from tlb.outbox where event_key='recipe-access:'||invitation.id||':'||invitation.revision;
  end if;
  insert into tlb.recipe_audit(actor,action,details) values(uid,'account_access_added',jsonb_build_object('invitation_id',invitation.id,'user_id',target,'permission',permission_name));
  return jsonb_build_object('saved',true,'pending',target is null,'email_status',email_status,'invitation_id',invitation.id);
 end if;
 return tlb.recipe_api_before_account_access(p_action,p_payload);
end $$;
revoke all on function public.recipe_api(text,jsonb) from public,anon;
grant execute on function public.recipe_api(text,jsonb) to authenticated;

-- Keep the existing mail gateway and its authorization/maintenance behavior.
do $migration$
declare source text; anchor text:=$anchor$   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);$anchor$; addition text:=$code$
   if e.event_type='recipe_access_invitation' then
    select exists(select 1 from tlb.recipe_invitations i where i.id::text=e.payload->>'invitation_id' and i.revision::text=e.payload->>'revision' and i.email=e.to_email and i.revoked_at is null
     and ((i.accepted_at is null and i.expires_at>now()) or exists(select 1 from tlb.recipe_access a join auth.users u on u.id=a.user_id where a.user_id=i.accepted_by and a.permission=i.permission and lower(btrim(u.email))=i.email and u.email_confirmed_at is not null))) into good;
    if not good then update tlb.outbox set status='skipped',last_error='Recipe invitation is no longer active.',lease_token=null,leased_until=null where id=e.id;return jsonb_build_object('skip',true);end if;
   end if;
$code$;
begin
 source:=replace(pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure),chr(13),'');
 if strpos(source,anchor)=0 then raise exception 'Email gateway changed; review invitation validation migration.';end if;
 execute replace(source,anchor,addition||anchor);
end $migration$;

create or replace function tlb.recipe_backup_tables() returns text[] language sql immutable set search_path='' as $$
 select array['recipe_settings','recipe_categories','recipe_resources','recipe_supplier_items','recipe_prices','recipes','recipe_versions',
 'recipe_links','recipe_ingredient_links','recipe_tests','recipe_runs','recipe_files','recipe_file_links','recipe_user_state','recipe_drafts','recipe_audit','recipe_access','recipe_invitations']
$$;
do $$ declare source text; needle text:='union select user_id from tlb.recipe_drafts union select actor from tlb.recipe_audit'; begin
 source:=pg_get_functiondef('public.recipe_backup_service(text,jsonb)'::regprocedure);
 if strpos(source,needle)=0 then raise exception 'Recipe backup actor map has changed; review migration.';end if;
 execute replace(source,needle,needle||' union select accepted_by from tlb.recipe_invitations union select granted_by from tlb.recipe_invitations');
end $$;
commit;
