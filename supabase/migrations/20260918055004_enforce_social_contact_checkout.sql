-- Activate after the required-contact checkout UI is live.
-- Existing orders, quote/catalog requests and successful submission retries
-- remain unchanged; only genuinely new orders require a social contact or N/A.
begin;

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := E'  perform tlb.validate_contact(p_payload);\n  q:=tlb.calculate_quote(p_payload,u,null,false,submitted_at);';
  new_value text := E'  perform tlb.validate_contact(p_payload);\n  perform tlb.validate_social_contact(p_payload->\'buyer\',true);\n  q:=tlb.calculate_quote(p_payload,u,null,false,submitted_at);';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
    new_value:=replace(new_value,chr(10),chr(13)||chr(10));
  end if;
  if position(new_value in definition)>0 then return; end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
    raise exception 'shop_api create_order definition differs from the expected version; review before requiring social contact.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;

commit;
