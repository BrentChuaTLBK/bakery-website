begin;
set local lock_timeout = '3s';

create function tlb.staff_order_link(p_order_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  saved_order tlb.orders;
begin
  perform tlb.assert_staff(auth.uid(),false);
  perform tlb.require(tlb.is_verified(auth.uid()),'Verify your staff email to copy a private order link.');
  select * into saved_order from tlb.orders where id=p_order_id and source in ('website','direct_message');
  perform tlb.require(found,'Order not found.');
  return jsonb_build_object('id',saved_order.id,'access_token',tlb.order_token(saved_order));
end $$;
revoke all on function tlb.staff_order_link(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  anchor text := ' perform pg_advisory_xact_lock(841721950318::bigint);';
  branch text := $new$ if p_action='staff_order_link' then return tlb.staff_order_link((p_payload->>'order_id')::uuid);end if;$new$;
begin
  perform tlb.require(length(definition)-length(replace(definition,anchor,''))=length(anchor),
    'Expected one shop API dispatch hook.');
  execute replace(definition,anchor,branch||chr(10)||anchor);
end $patch$;

commit;
