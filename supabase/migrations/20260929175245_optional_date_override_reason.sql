begin;

-- An owner can intentionally override a direct order date without a note.
-- Preserve authorization, stock checks and the existing maximum note length.
do $patch$ declare definition text; previous text; replacement text; begin
 definition:=pg_get_functiondef('tlb.pos_quote(jsonb,uuid,uuid)'::regprocedure);
 previous:=$old$perform tlb.require(length(trim(coalesce(p_payload->>'override_reason',''))) between 3 and 500,'Explain the owner date override.');$old$;
 replacement:=$new$perform tlb.require(length(trim(coalesce(p_payload->>'override_reason','')))<=500,'Override reason must be at most 500 characters.');$new$;
 perform tlb.require(position(previous in definition)>0,'Missing owner date override reason validation.');
 execute replace(definition,previous,replacement);
end $patch$;

commit;
