-- Compatibility stage: accept explicit N/A while retaining existing blank contacts.
-- Deploy this before the required-contact checkout UI. The following migration
-- enables strict validation for new customer submissions after that UI is live.
begin;

create or replace function tlb.validate_social_contact(p_buyer jsonb, p_required boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  platform text := lower(regexp_replace(coalesce(p_buyer->>'social_platform',''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  username text := regexp_replace(coalesce(p_buyer->>'social_username',''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if not p_required and platform='' and username='' then
    return;
  end if;
  perform tlb.require(jsonb_typeof(p_buyer->'social_platform')='string'
    and platform in ('facebook','instagram','na'), 'Choose Facebook, Instagram, or N/A.');
  perform tlb.require(jsonb_typeof(p_buyer->'social_username')='string'
    and length(username)>0,
    'Enter your social username or profile name, or N/A if unavailable.');
  perform tlb.require(length(username)<=100,
    'Keep your social username or profile name to 100 characters or fewer.');
  perform tlb.require(platform<>'na' or lower(username)='n/a',
    'Use N/A when no social platform is available.');
end;
$$;

revoke all on function tlb.validate_social_contact(jsonb,boolean) from public, anon, authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('tlb.validate_contact(jsonb)'::regprocedure);
  old_value text := E'  if nullif(p#>>\'{buyer,social_username}\',\'\') is not null then\n    perform tlb.require(p#>>\'{buyer,social_platform}\' in (\'Facebook\',\'Instagram\',\'facebook\',\'instagram\'),\'Choose Facebook or Instagram for the social username.\');\n  end if;';
  new_value text := E'  perform tlb.validate_social_contact(p->\'buyer\',false);';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
  end if;
  if position(new_value in definition)>0 then return; end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
    raise exception 'validate_contact definition differs from the expected version; review before adding social contact validation.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;

commit;
