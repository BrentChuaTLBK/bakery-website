begin;
set local lock_timeout='3s';

alter table tlb.academy_email_templates add column email_content jsonb not null default '{}';

-- Structured email fields only. Text is escaped by the shared renderer; HTML,
-- scripts and non-HTTPS assets/links are never accepted as layout instructions.
create function tlb.academy_validate_email_content(c jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text;v jsonb;item jsonb;lim integer;url text;
begin
 perform tlb.require(jsonb_typeof(c)='object' and octet_length(c::text)<=60000,'Email layout is too large or invalid.');
 if c='{}'::jsonb then return c;end if;
 perform tlb.require(c->>'layout' in ('invitation','showcase','launch','journal'),'Choose an email layout.');
 for k,v in select * from jsonb_each(c) loop
  if k='items' then continue;end if;
  lim:=case k when 'layout' then 20 when 'preheader' then 200 when 'eyebrow' then 100 when 'headline' then 180 when 'intro' then 2000 when 'hero_url' then 2048 when 'hero_alt' then 300 when 'cta_label' then 100 when 'cta_url' then 2048 else null end;
  perform tlb.require(lim is not null and jsonb_typeof(v)='string' and length(v#>>'{}')<=lim,'An email field is invalid or too long.');
 end loop;
 perform tlb.require(jsonb_typeof(coalesce(c->'items','[]'))='array','Email highlights must be a list.');
 perform tlb.require(jsonb_array_length(coalesce(c->'items','[]'))<=4,'Use up to four highlights.');
 for item in select value from jsonb_array_elements(coalesce(c->'items','[]')) loop
  perform tlb.require(jsonb_typeof(item)='object' and length(btrim(item->>'title')) between 1 and 160,'Add a title to each highlight.');
  for k,v in select * from jsonb_each(item) loop
   lim:=case k when 'title' then 160 when 'image_url' then 2048 when 'alt' then 300 when 'description' then 1000 else null end;
   perform tlb.require(lim is not null and jsonb_typeof(v)='string' and length(v#>>'{}')<=lim,'A highlight field is invalid or too long.');
  end loop;
  if coalesce(item->>'image_url','')<>'' then
   perform tlb.require(length(btrim(item->>'alt')) between 1 and 300,'Describe each highlight photo.');
  end if;
 end loop;
 if coalesce(c->>'hero_url','')<>'' then perform tlb.require(length(btrim(c->>'hero_alt')) between 1 and 300,'Describe the main photo.');end if;
 if coalesce(c->>'cta_url','')<>'' then perform tlb.require(length(btrim(c->>'cta_label')) between 1 and 100,'Add a label for the email button.');end if;
 for url in select c->>'hero_url' union all select c->>'cta_url' union all select value->>'image_url' from jsonb_array_elements(coalesce(c->'items','[]')) loop
  if coalesce(url,'')<>'' then
   perform tlb.require(length(url)<=2048 and url ~ '^https://[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]<>\\]*)?$','Use a full HTTPS photo or button link without a username or password.');
  end if;
 end loop;
 return c;
end $$;
revoke all on function tlb.academy_validate_email_content(jsonb) from public,anon,authenticated,service_role;

do $$ declare source text;anchor text;begin
 source:=pg_get_functiondef('tlb.academy_resources_api(text,jsonb)'::regprocedure);
 anchor:='jsonb_build_object(''templates'',';
 perform tlb.require(strpos(source,anchor)>0,'Missing email capabilities hook.');
 source:=replace(source,anchor,'jsonb_build_object(''visual_email_templates'',true,''templates'',');
 anchor:='if p_action=''save_email_template'' then';
 perform tlb.require(strpos(source,anchor)>0,'Missing template save hook.');
 source:=replace(source,anchor,anchor||E'\n  p_payload:=jsonb_set(p_payload,''{email_content}'',tlb.academy_validate_email_content(coalesce(p_payload->''email_content'',''{}''::jsonb)));');
 anchor:='and t.body=btrim(p_payload->>''body'')';
 perform tlb.require(strpos(source,anchor)>0,'Missing template retry hook.');
 source:=replace(source,anchor,anchor||' and t.email_content=p_payload->''email_content''');
 anchor:='id,kind,name,subject,body,created_by)';
 perform tlb.require(strpos(source,anchor)>0,'Missing template insert hook.');
 source:=replace(source,anchor,'id,kind,name,subject,body,email_content,created_by)');
 source:=replace(source,'btrim(p_payload->>''body''),u) returning','btrim(p_payload->>''body''),p_payload->''email_content'',u) returning');
 source:=replace(source,'body=btrim(p_payload->>''body''),revision=','body=btrim(p_payload->>''body''),email_content=p_payload->''email_content'',revision=');
 execute source;

 -- The existing gateway owns authorization, consent, recipients, leases and
 -- idempotency. Add validation and snapshot the layout into each outbox item.
 source:=pg_get_functiondef('tlb.academy_portal_dispatch(text,jsonb)'::regprocedure);
 anchor:='select count(*) into n from tlb.academy_recipients(p_payload);';
 perform tlb.require(strpos(source,anchor)>0,'Missing broadcast validation hook.');
 source:=replace(source,anchor,'p_payload:=jsonb_set(p_payload,''{email_content}'',tlb.academy_validate_email_content(coalesce(p_payload->''email_content'',''{}''::jsonb)));'||E'\n '||anchor);
 anchor:='''preview'',b.body,''recipient_id''';
 perform tlb.require(strpos(source,anchor)>0,'Missing broadcast payload hook.');
 source:=replace(source,anchor,'''preview'',b.body,''email_content'',b.filter->''email_content'',''recipient_id''');
 execute source;
end $$;
commit;
