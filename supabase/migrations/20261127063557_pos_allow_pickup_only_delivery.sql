-- POS direct-order creation and edits share this quote. Website checkout has
-- its own pickup-only validation.
begin;
set local lock_timeout='3s';

do $patch$
declare
  definition text := pg_get_functiondef('tlb.pos_quote(jsonb,uuid,uuid)'::regprocedure);
  previous text := $old$perform tlb.require(method<>'delivery' or not coalesce((product->>'pickup_only')::boolean,false),'This product is pickup only.');$old$;
  replacement text := $new$-- Staff choose the fulfillment method for direct orders.$new$;
begin
  if strpos(definition,replacement)>0 then
    perform tlb.require(strpos(definition,previous)=0,'POS delivery policy contains conflicting guards.');
    return;
  end if;
  perform tlb.require(length(definition)-length(replace(definition,previous,''))=length(previous),
    'Expected exactly one pickup-only guard in the POS quote.');
  execute replace(definition,previous,replacement);
end $patch$;

commit;
