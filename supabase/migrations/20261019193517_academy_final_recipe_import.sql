-- Academy imports only recipes in the Final category, at their current Final
-- version. Draft/R&D recipes can retain an older production pointer for kitchen
-- use; that pointer alone does not make them eligible for an Academy import.
begin;

do $migration$
declare
 definition text;
 search_anchor text := 'where rp.deleted_at is null and rp.name ilike';
 auth_anchor text := 'perform tlb.academy_assert(auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid()));';
begin
 definition := pg_get_functiondef('tlb.academy_portal_base(text,jsonb)'::regprocedure);
 perform tlb.require((length(definition)-length(replace(definition,search_anchor,'')))/length(search_anchor)=1,
  'Review the Academy recipe search before restricting Final imports.');
 execute replace(definition,search_anchor,
  'where rp.deleted_at is null and rp.current_version_id=v.id and rp.production_version_id=v.id and v.status=''production'' and rp.name ilike');

 definition := pg_get_functiondef('public.academy_portal_api(text,jsonb)'::regprocedure);
 perform tlb.require((length(definition)-length(replace(definition,auth_anchor,'')))/length(auth_anchor)=1,
  'Review Academy authorization before restricting Final imports.');
 execute replace(definition,auth_anchor,auth_anchor || $guard$
 if p_action='import_recipe' then
  perform tlb.academy_assert(tlb.academy_owner());
  -- Check before idempotent replay too: a withdrawn or superseded source must
  -- never be offered as a new import. Existing independent Academy copies stay.
  -- SHARE locks hold eligibility and the exact source document through copying;
  -- pointer/status changes and deletion must wait for this transaction to end.
  perform 1 from tlb.recipes rp join tlb.recipe_versions v on v.recipe_id=rp.id
   where v.id=(p_payload->>'version_id')::uuid
    and rp.deleted_at is null and rp.current_version_id=v.id
    and rp.production_version_id=v.id and v.status='production'
   for share of rp,v;
  perform tlb.require(found,'This recipe is no longer the current Final version. Search Final recipes again.');
 end if;
$guard$);
end $migration$;

commit;
