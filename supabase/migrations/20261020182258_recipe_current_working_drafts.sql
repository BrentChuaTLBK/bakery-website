-- Recovery copies remain available, but older or already-saved copies must not
-- label the current saved recipe as unfinished.
create function tlb.recipe_draft_is_current(p_draft tlb.recipe_drafts) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare recipe tlb.recipes;saved jsonb;
begin
 if p_draft.recipe_id is null then return true;end if;
 select * into recipe from tlb.recipes where id=p_draft.recipe_id;
 if recipe.id is null or recipe.deleted_at is not null or recipe.revision is distinct from p_draft.base_revision then return false;end if;
 if p_draft.visibility is distinct from recipe.visibility then return true;end if;
 select document into saved from tlb.recipe_versions where id=recipe.current_version_id;
 begin
  return tlb.recipe_save_comparison(p_draft.document) is distinct from tlb.recipe_save_comparison(saved);
 exception when others then
  -- Incomplete working documents are valid recovery copies. A comparison
  -- failure must not hide unsaved work or prevent the library from loading.
  return true;
 end;
end $$;
revoke all on function tlb.recipe_draft_is_current(tlb.recipe_drafts) from public,anon,authenticated,service_role;

do $migration$
declare definition text;hook text;
begin
 select pg_get_functiondef('tlb.recipe_api_before_account_access(text,jsonb)'::regprocedure) into definition;
 hook:='select * from tlb.recipe_drafts where user_id=uid and';
 perform tlb.require(strpos(definition,hook)>0,'Missing protected working-draft list hook.');
 -- Filter before pagination; keep existing ownership, visibility and R&D
 -- checks intact. The full recovery list is unchanged unless requested.
 execute replace(definition,hook,hook||' (not coalesce((p_payload->>''current_only'')::boolean,false) or tlb.recipe_draft_is_current(recipe_drafts)) and');
end $migration$;
