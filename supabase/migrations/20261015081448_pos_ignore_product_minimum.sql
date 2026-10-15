-- Product minimums apply to customer website orders, not staff POS sales.
-- Direct-order create and edit both use this private quote function; pop-up
-- sales already allow one item. All other POS validation remains in place.
begin;
set local lock_timeout='3s';

do $patch$
declare
 definition text:=pg_get_functiondef('tlb.pos_quote(jsonb,uuid,uuid)'::regprocedure);
 previous text:=$old$perform tlb.require(requested>=coalesce((product->>'min_quantity')::integer,1),'The product minimum quantity has not been met.');$old$;
 replacement text:=$new$-- Staff POS sales can contain one unit regardless of the website product minimum.$new$;
begin
 if position(replacement in definition)>0 then
  perform tlb.require(position(previous in definition)=0,'POS minimum policy contains conflicting guards.');
  return;
 end if;
 perform tlb.require((length(definition)-length(replace(definition,previous,'')))/length(previous)=1,
  'Expected exactly one POS product minimum guard.');
 execute replace(definition,previous,replacement);
end $patch$;

commit;
