begin;

-- Large camp batches can contain more than 500 images. Keep the existing
-- class-size, section-count, media ownership and per-photo validation limits.
do $migration$
declare definition text; old_check text := $old$perform tlb.require(jsonb_typeof(v->'photos')='array' and jsonb_array_length(v->'photos')<=500,'An album can contain up to 500 photos.');$old$;
new_check text := $new$perform tlb.require(jsonb_typeof(v->'photos')='array','Album photos must be a list. Reload the saved class and try again.');
  perform tlb.require(jsonb_array_length(v->'photos')<=2000,'An album can contain up to 2,000 photos. Add another batch or creation for the remaining photos.');$new$;
begin
 select pg_get_functiondef('tlb.academy_validate(jsonb,boolean)'::regprocedure) into definition;
 if strpos(definition,old_check)>0 then execute replace(definition,old_check,new_check);
 elsif strpos(definition,new_check)=0 then raise exception 'Academy album validation changed; review this migration before applying.';
 end if;
end $migration$;

commit;
