-- Extra event flavors can be removed when they have no retained allocation.
-- Keep catalog choices and sold/retained extras so stock cannot be rewritten.
-- Order snapshots remain untouched, including voided sales with restored stock.
do $migration$
declare fn text; old text; replacement text;
begin
 fn:=pg_get_functiondef('tlb.pos_save_flavor_stock(uuid,jsonb)'::regprocedure);
 old:=$before$   -- Keep IDs for historical stock. Uncheck availability instead of dropping a flavor.
   perform tlb.require(not exists(select 1 from jsonb_array_elements(oldg->'choices') v where not exists(select 1 from jsonb_array_elements(g->'choices') n where n->>'id'=v->>'id')),'Keep existing flavors and turn off those not offered.');$before$;
 replacement:=$after$   -- Only unused event-only choices may be omitted. Catalog and retained stock stay.
   perform tlb.require(not exists(
    select 1 from jsonb_array_elements(oldg->'choices') v
    where (not coalesce((v->>'custom')::boolean,false) or coalesce((usage#>>array[g->>'id',v->>'id'])::bigint,0)>0)
     and not exists(select 1 from jsonb_array_elements(g->'choices') n where n->>'id'=v->>'id')
   ),'Keep existing catalog flavors and flavors with sold or retained stock. Turn off those not offered.');$after$;
 if position(old in fn)=0 then raise exception 'Flavor removal migration target was not found'; end if;
 execute replace(fn,old,replacement);
end $migration$;
