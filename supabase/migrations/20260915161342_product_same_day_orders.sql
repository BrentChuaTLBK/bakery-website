-- Same-day ordering is an explicit product option, valid only with zero full
-- production days. The shop's existing Manila cutoff applies: before cutoff
-- (or with none configured) today is eligible; at/after cutoff tomorrow is the
-- earliest eligible date. Non-opted-in products retain their production rules.
-- No products, settings, orders, allocations, payments or emails are changed.
-- Existing staff amendment behavior and customer booking horizon are retained.
-- Guarded replacements support LF/CRLF, fail on unexpected source, and replay
-- without changing already-installed functions or their existing privileges.

do $migration$
declare
  signature text;
  definition text;
  patch record;
begin
  foreach signature in array array[
    'tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
    'public.shop_api(text,jsonb,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('TLB_PRODUCT_SAME_DAY_V1' in definition)=0 then
      for patch in select * from (values
        ('tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
         $old$  perform tlb.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');$old$,
         $new$  -- TLB_PRODUCT_SAME_DAY_V1
  perform tlb.require(ful>=(p_submitted at time zone 'Asia/Manila')::date,'Past fulfillment dates are not available. Choose today or a future date.');$new$),
        ('tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
         $old$ earliest:=(p_submitted at time zone 'Asia/Manila')::date+1;$old$,
         $new$ earliest:=(p_submitted at time zone 'Asia/Manila')::date+case when p_admin then 1 else 0 end;$new$),
        ('tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
         $old$   item_earliest:=tlb.earliest_lead_date(p_submitted,coalesce((p->>'lead_days')::integer,0),s); earliest:=greatest(earliest,item_earliest);$old$,
         $new$   if ful=(p_submitted at time zone 'Asia/Manila')::date then
    perform tlb.require(coalesce(p->'allow_same_day'='true'::jsonb,false) and coalesce((p->>'lead_days')::integer,0)=0,(p->>'name')||' is not available for same-day orders. Choose a future date.');
    perform tlb.require(nullif(s->>'cutoff_time','') is null or (p_submitted at time zone 'Asia/Manila')::time<(s->>'cutoff_time')::time,'The same-day order cutoff has passed. Choose tomorrow or another available date.');
   end if;
   if coalesce(p->'allow_same_day'='true'::jsonb,false) and coalesce((p->>'lead_days')::integer,0)=0 then
    item_earliest:=(p_submitted at time zone 'Asia/Manila')::date;
    if nullif(s->>'cutoff_time','') is not null and (p_submitted at time zone 'Asia/Manila')::time>=(s->>'cutoff_time')::time then item_earliest:=item_earliest+1; end if;
   else
    item_earliest:=tlb.earliest_lead_date(p_submitted,coalesce((p->>'lead_days')::integer,0),s);
   end if;
   earliest:=greatest(earliest,item_earliest);$new$),
        ('public.shop_api(text,jsonb,text)',
         $old$   row_data:=p_payload->'product';$old$,
         $new$   -- TLB_PRODUCT_SAME_DAY_V1
   row_data:=p_payload->'product';
   perform tlb.require(not (row_data ? 'allow_same_day') or jsonb_typeof(row_data->'allow_same_day')='boolean','Same-day ordering must be enabled or disabled.');
   perform tlb.require(not coalesce((row_data->>'allow_same_day')::boolean,false) or coalesce((row_data->>'lead_days')::integer,0)=0,'Same-day products must have 0 full production days.');$new$),
        ('public.shop_api(text,jsonb,text)',
         $old$jsonb_build_object('pickup_only',false,'description','','category_id',null,'min_quantity',1$old$,
         $new$jsonb_build_object('allow_same_day',false,'pickup_only',false,'description','','category_id',null,'min_quantity',1$new$)
      ) as patches(function_signature,old_value,new_value)
      where function_signature=signature
      loop
        if position(patch.old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
          patch.old_value:=replace(patch.old_value,chr(10),chr(13)||chr(10));
          patch.new_value:=replace(patch.new_value,chr(10),chr(13)||chr(10));
        end if;
        if length(definition)-length(replace(definition,patch.old_value,''))<>length(patch.old_value) then
          raise exception 'Unexpected function definition in % same-day migration; review before applying.',signature;
        end if;
        definition:=replace(definition,patch.old_value,patch.new_value);
      end loop;
      execute definition;
    end if;
  end loop;
end;
$migration$;
