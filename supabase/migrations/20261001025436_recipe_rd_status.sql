begin;
set local lock_timeout='3s';

-- Reuse the immutable Testing code as the owner-requested R&D status.
-- No historical recipe/version rows or cost snapshots are rewritten.
create or replace function tlb.recipe_status(p_status text) returns text
language sql immutable security invoker set search_path='' as $$
 select case p_status when 'testing' then 'testing'
  when 'production' then 'production' when 'final' then 'production'
  when 'hidden' then 'hidden' when 'archived' then 'archived'
  when 'archive' then 'archived' else 'draft' end
$$;
revoke all on function tlb.recipe_status(text) from public,anon,authenticated,service_role;

do $$ declare source text;hook text;begin
 source:=pg_get_functiondef('tlb.recipe_api_before_profitability(text,jsonb)'::regprocedure);
 hook:=$hook$p_payload->>'status' in ('draft','final','production','hidden','archive','archived')$hook$;
 perform tlb.require(strpos(source,hook)>0,'Missing recipe workflow status validation hook.');
 source:=replace(source,hook,$hook$p_payload->>'status' in ('draft','testing','final','production','hidden','archive','archived')$hook$);
 source:=replace(source,'Choose Draft, Final, Hidden or Archive.','Choose Draft, R&D, Final, Hidden or Archive.');
 -- Owner-only status transitions and optimistic revision checks remain in
 -- the existing function. R&D retains the last Final production pointer.
 execute source;
end $$;
revoke all on function tlb.recipe_api_before_profitability(text,jsonb) from public,anon,authenticated,service_role;
commit;
