-- Payment proof remains required. A bank/transfer reference is supplementary
-- and may be omitted without preventing proof review or payment approval.
begin;

create or replace function tlb.normalize_payment_reference(value jsonb)
returns text language plpgsql immutable security invoker set search_path=''
as $$
declare
  reference_text text;
begin
  perform tlb.require(value is null or jsonb_typeof(value) in ('null','string'),
    'Payment reference must be text (maximum 200 characters).');
  reference_text:=nullif(regexp_replace(coalesce(value#>>'{}',''),
    '^[[:space:]]+|[[:space:]]+$','','g'),'');
  perform tlb.require(reference_text is null or length(reference_text)<=200,
    'Payment reference must be text (maximum 200 characters).');
  return reference_text;
end
$$;
revoke all on function tlb.normalize_payment_reference(jsonb) from public, anon, authenticated;

-- The approval inserts the same optional reference stored with the order.
-- Existing records and all required proof columns are unchanged.
alter table tlb.payments alter column payment_reference drop not null;

do $migration$
declare
  definition text:=pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
  old_value text:=E'  perform tlb.require(length(trim(coalesce(p_payload->>\'payment_reference\',\'\'))) between 1 and 200,\'Enter a payment reference (maximum 200 characters).\');\n  update tlb.orders set proof_path=v_path,payment_reference=trim(p_payload->>\'payment_reference\'),payment_status=\'under_review\',revision=revision+1 where id=oid;';
  new_value text:=E'  update tlb.orders set proof_path=v_path,payment_reference=tlb.normalize_payment_reference(p_payload->\'payment_reference\'),payment_status=\'under_review\',revision=revision+1 where id=oid;';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
    new_value:=replace(new_value,chr(10),chr(13)||chr(10));
  end if;
  if length(definition)-length(replace(definition,new_value,''))=length(new_value)
    and position(old_value in definition)=0 then return; end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value)
    or position(new_value in definition)>0 then
    raise exception 'shop_service proof submission differs from the expected version; review before making payment reference optional.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;

commit;
