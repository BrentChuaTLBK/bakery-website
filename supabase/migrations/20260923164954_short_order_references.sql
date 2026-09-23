-- A rider-friendly label, never an order access credential. Existing references,
-- UUIDs, encrypted access tokens and links are intentionally left unchanged.
create or replace function tlb.new_order_reference()
returns text language plpgsql volatile security invoker set search_path='' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  random_bytes bytea;
  code_length integer;
  attempt integer;
begin
  -- Match create_order's transaction lock, held through the eventual INSERT.
  -- The UNIQUE constraint on orders.reference remains the final safeguard.
  perform pg_advisory_xact_lock(841721950318::bigint);
  for code_length in 6..12 loop
    for attempt in 1..64 loop
      random_bytes:=extensions.gen_random_bytes(code_length);
      select string_agg(substr(alphabet,get_byte(random_bytes,i)%32+1,1),'' order by i)
        into code from generate_series(0,code_length-1) as i;
      -- 32 symbols divide 256 evenly. Require a mix; omit I/O/0/1.
      if code !~ '[A-Z]' or code !~ '[2-9]' then continue; end if;
      code:='TLB-'||code;
      if not exists(select 1 from tlb.orders where reference=code) then
        return code;
      end if;
    end loop;
    -- If a shorter namespace becomes crowded, extend without renumbering orders.
  end loop;
  raise exception 'Could not assign a unique order reference. Please retry.' using errcode='54000';
end;
$$;
revoke all on function tlb.new_order_reference() from public,anon,authenticated,service_role;

-- Change only the generated display reference in the established checkout path.
do $$
declare
  definition text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  previous text:=$old$'TLB-'||to_char(now() at time zone 'Asia/Manila','YYMMDD')||'-'||upper(substr(replace(oid::text,'-',''),1,10))$old$;
  replacement text:='tlb.new_order_reference()';
begin
  if position('pg_advisory_xact_lock(841721950318::bigint)' in definition)=0 then
    raise exception 'Review checkout transaction locking before changing order references.';
  end if;
  if position(previous in definition)>0 then
    if length(definition)-length(replace(definition,previous,''))<>length(previous) then
      raise exception 'Order reference expression is not unique; review checkout before replacing it.';
    end if;
    execute replace(definition,previous,replacement);
  elsif position(replacement in definition)=0 then
    raise exception 'Checkout reference generation differs from the expected version.';
  end if;
end;
$$;
