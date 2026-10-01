begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Bounded conversation reads. The public wrapper remains the only browser entry.
create function tlb.academy_reaudit_read(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 u uuid:=auth.uid(); target uuid:=nullif(p_payload->>'id','')::uuid; result jsonb; context jsonb;
 filter_name text:=coalesce(p_payload->>'filter','all'); search_text text:=btrim(coalesce(p_payload->>'query',''));
 page_size integer:=coalesce((p_payload->>'limit')::integer,30);
 cursor_at timestamptz:=nullif(p_payload->'cursor'->>'at','')::timestamptz;
 cursor_id uuid:=nullif(p_payload->'cursor'->>'id','')::uuid;
 class_filter uuid:=nullif(p_payload->>'class_id','')::uuid;
begin
 perform tlb.academy_assert(u is not null and exists(select 1 from auth.users where id=u));
 if p_action='thread_page' then
  perform tlb.require(filter_name in ('all','needs_reply','resolved'),'Choose a conversation filter.');
  perform tlb.require(length(search_text)<=160,'Search using up to 160 characters.');
  perform tlb.require(page_size between 1 and 50,'Choose a page size from 1 to 50.');
  perform tlb.require((cursor_at is null)=(cursor_id is null),'Choose a complete conversation cursor.');
  with matched as materialized (
   select t.id,t.class_id,t.subject,t.type,t.resolved,t.last_activity,c.name as class_name,
    i.display_name as instructor,tlb.academy_display_name(t.user_id) as account_name,
    r.title as recipe_title,m.name as module_name,
    (not t.resolved and latest.sender_id=t.user_id) as needs_reply,
    left(regexp_replace(latest.body,'\s+',' ','g'),180) as last_message_preview,
    (select count(*) from tlb.academy_messages q where q.thread_id=t.id and q.submitted and q.sender_id<>u
     and q.created_at>coalesce((select read_at from tlb.academy_message_reads rr where rr.thread_id=t.id and rr.user_id=u),'-infinity')) as unread
   from tlb.academy_message_threads t join tlb.academy_curricula c on c.id=t.class_id
   left join tlb.academy_instructors i on i.user_id=c.instructor_id
   join lateral(select q.sender_id,q.body from tlb.academy_messages q where q.thread_id=t.id and q.submitted order by q.created_at desc,q.id desc limit 1) latest on true
   left join tlb.academy_modules m on m.id=t.module_id and m.class_id=t.class_id
   left join tlb.academy_student_recipes r on r.id=t.recipe_id and exists(select 1 from tlb.academy_class_recipes cr where cr.class_id=t.class_id and cr.recipe_id=r.id)
   where tlb.academy_thread_access(t.id)
    and (class_filter is null or t.class_id=class_filter)
    and (cursor_at is null or (t.last_activity,t.id)<(cursor_at,cursor_id))
    and (filter_name='all' or (filter_name='needs_reply' and not t.resolved and latest.sender_id=t.user_id) or (filter_name='resolved' and t.resolved))
    and (search_text='' or strpos(lower(t.subject),lower(search_text))>0 or strpos(lower(tlb.academy_display_name(t.user_id)),lower(search_text))>0)
   order by t.last_activity desc,t.id desc limit page_size+1
  ), page as (select * from matched order by last_activity desc,id desc limit page_size)
  select jsonb_build_object('threads',(select coalesce(jsonb_agg(to_jsonb(p) order by p.last_activity desc,p.id desc),'[]') from page p),
   'next_cursor',case when (select count(*) from matched)>page_size then
    (select jsonb_build_object('at',p.last_activity,'id',p.id) from page p order by p.last_activity,p.id limit 1) else null end) into result;
  return result;
 end if;
 if p_action='thread' then
  -- Reuse the existing private thread and read-state boundary before enriching it.
  result:=tlb.academy_portal_dispatch(p_action,p_payload);
  select jsonb_build_object('module_name',m.name,'module_id',m.id,'recipe_title',r.title,'recipe_id',r.id) into context
   from tlb.academy_message_threads t
   left join tlb.academy_modules m on m.id=t.module_id and m.class_id=t.class_id and tlb.academy_class_access(t.class_id)
   left join tlb.academy_student_recipes r on r.id=t.recipe_id and tlb.academy_class_access(t.class_id)
    and exists(select 1 from tlb.academy_class_recipes cr where cr.class_id=t.class_id and cr.recipe_id=r.id)
   where t.id=target;
  return result||coalesce(context,'{}');
 end if;
 if p_action='admin_attention' then
  perform tlb.academy_assert(tlb.academy_owner());
  return jsonb_build_object('needs_reply',(select count(*) from tlb.academy_message_threads t
   join lateral(select q.sender_id from tlb.academy_messages q where q.thread_id=t.id and q.submitted order by q.created_at desc,q.id desc limit 1) latest on true
   where tlb.academy_thread_access(t.id) and not t.resolved and latest.sender_id=t.user_id),
   'pending_gallery',(select count(*) from tlb.academy_submissions s where s.submitted and s.visibility='gallery' and s.moderation='pending'));
 end if;
 raise exception 'Unknown Academy view.' using errcode='22023';
end $$;
revoke all on function tlb.academy_reaudit_read(text,jsonb) from public,anon,authenticated,service_role;

-- Preserve legacy array reads and mutation replay for already-open clients.
do $migration$
declare definition text:=replace(pg_get_functiondef('public.academy_portal_api(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 anchor text:=$anchor$ if p_action in ('navigation','gallery_post','threads','thread_status') then$anchor$;
 hook text:=$hook$ if p_action in ('thread_page','thread','admin_attention') then
  return tlb.academy_reaudit_read(p_action,p_payload);
 end if;
$hook$;
begin
 if position(anchor in definition)=0 then raise exception 'Review Academy API before adding conversation pagination';end if;
 execute replace(definition,anchor,hook||anchor);
end $migration$;
revoke all on function public.academy_portal_api(text,jsonb) from public,anon,service_role;
grant execute on function public.academy_portal_api(text,jsonb) to authenticated;
-- Filter the moderation audience before the existing bounded result window.
do $migration$
declare definition text:=replace(pg_get_functiondef('tlb.academy_portal_base(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 anchor text:=$anchor$and (nullif(p_payload->>'status','') is null or q.moderation=p_payload->>'status') order by q.created_at desc limit 100$anchor$;
 replacement text:=$replacement$and (nullif(p_payload->>'status','') is null or q.moderation=p_payload->>'status') and (nullif(p_payload->>'visibility','') is null or q.visibility=p_payload->>'visibility') order by q.created_at desc limit 100$replacement$;
begin
 if position(anchor in definition)=0 then raise exception 'Review Academy moderation read before adding audience filter';end if;
 execute replace(definition,anchor,replacement);
end $migration$;
commit;
