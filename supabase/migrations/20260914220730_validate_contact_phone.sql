-- Validate phone formatting for new orders and staff contact corrections.
-- Existing order data is preserved. The public API still calls the same
-- private validate_contact(jsonb) function for both create_order and edit_order.
create or replace function tlb.valid_contact_phone(value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select length(phone) <= 40
    and regexp_replace(phone, '^[+]', '') !~ '[^0-9 ()-]'
    and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15
  from (select btrim(coalesce(value, '')) as phone) normalized;
$$;

revoke all on function tlb.valid_contact_phone(text) from public, anon, authenticated;

create or replace function tlb.validate_contact(p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform tlb.require(length(trim(coalesce(p#>>'{buyer,name}',''))) between 1 and 200,'Enter the buyer name.');
  perform tlb.require(tlb.valid_contact_phone(p#>>'{buyer,phone}'),'Enter a valid buyer contact number using 7–15 digits. You may include a leading +, spaces, hyphens and parentheses.');
  perform tlb.require(length(coalesce(p#>>'{buyer,email}',''))<=254 and coalesce(p#>>'{buyer,email}','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid buyer email address.');
  if nullif(p#>>'{buyer,social_username}','') is not null then
    perform tlb.require(p#>>'{buyer,social_platform}' in ('Facebook','Instagram','facebook','instagram'),'Choose Facebook or Instagram for the social username.');
  end if;
  if p->>'method'='delivery' then
    perform tlb.require(length(trim(coalesce(p#>>'{recipient,name}',''))) between 1 and 200,'Enter the delivery recipient name separately.');
    perform tlb.require(tlb.valid_contact_phone(p#>>'{recipient,phone}'),'Enter a valid delivery recipient contact number using 7–15 digits. You may include a leading +, spaces, hyphens and parentheses.');
    perform tlb.require(length(trim(coalesce(p#>>'{address,line1}',''))) between 5 and 1000,'Enter the complete delivery address.');
  end if;
end;
$$;

revoke all on function tlb.validate_contact(jsonb) from public, anon, authenticated;
