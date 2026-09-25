begin;

-- Optional client names remain inside owner-only accounting records.
alter table tlb.accounting_entries add column if not exists client_name text not null default '' check(length(client_name)<=160);
alter table tlb.accounting_entries add column if not exists payment_method text not null default '' check(payment_method in ('','gcash','cash','bank_transfer'));

do $$ declare definition text; patch record; begin
 definition:=pg_get_functiondef('tlb.accounting_api(uuid,text,jsonb)'::regprocedure);
 for patch in select * from (values
  ('reports jsonb; deliveries jsonb; val bigint;',
   'reports jsonb; deliveries jsonb; client_value text; method_value text; val bigint;'),
  ($old$select coalesce(jsonb_agg(to_jsonb(r) order by r.entry_date,r.source,r.id),'[]') into entries from tlb.accounting_rows(start_date,end_date) r;$old$,
   $new$select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('client_name',coalesce(manual.client_name,''),'payment_method',coalesce(manual.payment_method,'')) order by r.entry_date,r.source,r.id),'[]') into entries from tlb.accounting_rows(start_date,end_date) r left join tlb.accounting_entries manual on r.source='Manual' and manual.id=r.id;$new$),
  ($old$category_uuid:=(p_payload->>'category_id')::uuid; note_value:=trim(coalesce(p_payload->>'note',''));$old$,
   $new$category_uuid:=(p_payload->>'category_id')::uuid; note_value:=trim(coalesce(p_payload->>'note',''));
   -- Older open browser tabs may omit the new field; preserve an existing name.
   client_value:=case when p_payload ? 'client_name' then trim(coalesce(p_payload->>'client_name','')) else coalesce(e.client_name,'') end;
   perform tlb.require(length(client_value)<=160,'Client name must be 160 characters or fewer.');
   method_value:=case when p_payload ? 'payment_method' then coalesce(p_payload->>'payment_method','') else coalesce(e.payment_method,'') end;
   perform tlb.require(method_value in ('','gcash','cash','bank_transfer'),'Choose GCash, Cash or Bank Transfer.');$new$),
  ('(e.entry_date,e.category_id,e.amount_cents,e.note) is not distinct from (date_value,category_uuid,val,note_value)',
   '(e.entry_date,e.category_id,e.amount_cents,e.note,e.client_name,e.payment_method) is not distinct from (date_value,category_uuid,val,note_value,client_value,method_value)'),
  ('insert into tlb.accounting_entries(id,entry_date,category_id,amount_cents,note) values(target,date_value,category_uuid,val,note_value)',
   'insert into tlb.accounting_entries(id,entry_date,category_id,amount_cents,note,client_name,payment_method) values(target,date_value,category_uuid,val,note_value,client_value,method_value)'),
  ('note=excluded.note,revision=tlb.accounting_entries.revision+1',
   'note=excluded.note,client_name=excluded.client_name,payment_method=excluded.payment_method,revision=tlb.accounting_entries.revision+1')
 ) changes(old_text,new_text) loop
  if position(patch.new_text in definition)=0 then
   perform tlb.require(position(patch.old_text in definition)>0,'Accounting client-name marker missing.');
   definition:=replace(definition,patch.old_text,patch.new_text);
  end if;
 end loop;
 execute definition;
end $$;
revoke all on function tlb.accounting_api(uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
