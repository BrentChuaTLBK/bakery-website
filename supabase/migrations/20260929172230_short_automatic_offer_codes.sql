begin;

-- New automatic offers and newsletter welcome offers share one six-character
-- generator. Existing promo rows, terms and queued emails are never rewritten.
create function tlb.short_offer_code() returns text
language plpgsql volatile security invoker set search_path='' as $$
declare bytes bytea; code text;
begin
 loop
  bytes:=extensions.gen_random_bytes(6);
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',get_byte(bytes,i)%32+1,1),'' order by i)
   into code from generate_series(0,5) as i;
  if code ~ '[A-Z]' and code ~ '[2-9]' then return code; end if;
 end loop;
end $$;
revoke all on function tlb.short_offer_code() from public,anon,authenticated,service_role;

-- Keep each issuer's unique-code insert/retry and eligibility rules intact.
do $patch$ declare d text; h text; begin
 d:=replace(pg_get_functiondef('tlb.queue_newsletter_welcome(text,text)'::regprocedure),E'\r\n',E'\n');
 h:=$h$      v_random:=extensions.gen_random_bytes(6);
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',get_byte(v_random,i)%32+1,1),'' order by i)
        into v_code from generate_series(0,5) as i;
      -- Easy to type, always a mix, without ambiguous I/O/0/1 characters.
      if v_code !~ '[A-Z]' or v_code !~ '[2-9]' then continue; end if;$h$;
 perform tlb.require(position(h in d)>0,'Missing newsletter code generator.');
 execute replace(d,h,'      v_code:=tlb.short_offer_code();');

 d:=pg_get_functiondef('tlb.voucher_completed_order()'::regprocedure);
 h:=$h$v_code:='TLB-'||upper(encode(extensions.gen_random_bytes(5),'hex'));$h$;
 perform tlb.require(position(h in d)>0,'Missing automatic offer code generator.');
 execute replace(d,h,'v_code:=tlb.short_offer_code();');

 d:=pg_get_functiondef('tlb.voucher_api(text,jsonb)'::regprocedure);
 h:=$h$'code','TLB-PREVIEW'$h$;
 perform tlb.require(position(h in d)>0,'Missing automatic offer preview code.');
 execute replace(d,h,$h$'code','A7K2M9'$h$);
end $patch$;

commit;
