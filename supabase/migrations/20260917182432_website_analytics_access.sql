-- The reporting Edge Function supplies a remotely verified auth user ID.
-- This action remains behind the existing service-role-only gateway. It returns
-- no customer/order data and runs before the gateway's order maintenance/lock.
begin;
do $migration$
declare
  definition text := pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
  old_value text := E'begin\n perform pg_advisory_xact_lock(841721950318::bigint);';
  new_value text := E'begin\n if p_action=\'authorize_analytics\' then\n  perform tlb.assert_staff(u,false);\n  return jsonb_build_object(\'allowed\',true);\n end if;\n perform pg_advisory_xact_lock(841721950318::bigint);';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
    new_value:=replace(new_value,chr(10),chr(13)||chr(10));
  end if;
  if position(new_value in definition)>0 then
    return;
  end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
    raise exception 'shop_service definition differs from the expected version; review before adding analytics access.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;
revoke all on function public.shop_service(text,jsonb) from public, anon, authenticated;
grant execute on function public.shop_service(text,jsonb) to service_role;
commit;
