-- Include the buyer already recorded on website orders in accounting/export rows.
-- Amounts, category mapping, eligibility and recorded payment methods are unchanged.
do $$
declare
 definition text:=pg_get_functiondef('tlb.accounting_rows_v2(date,date)'::regprocedure);
 old_text text:=$before$case when o.source<>'website' then coalesce(o.data#>>'{buyer,name}','') else '' end$before$;
 new_text text:=$after$coalesce(o.data#>>'{buyer,name}','')$after$;
begin
 if position(old_text in definition)>0 then
  execute replace(definition,old_text,new_text);
 elsif position(new_text in definition)=0 then
  raise exception 'Accounting buyer-name lookup was not found';
 end if;
end;
$$;
revoke all on function tlb.accounting_rows_v2(date,date) from public,anon,authenticated,service_role;
