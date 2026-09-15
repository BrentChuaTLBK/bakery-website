-- Customer bookings use the current Manila calendar month plus the next two
-- months, through the final day of that second following month. The existing
-- no-same-day rule still applies. Staff amendments and existing order records,
-- allocations, payments, deadlines and queued emails are not changed.
-- Add only the guard to the installed quote function so all existing delivery,
-- stock, permission and pricing behavior remains intact. Reapplying is a no-op.

do $migration$
declare
  definition text := pg_get_functiondef('tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)'::regprocedure);
  old_value text := $old$  perform tlb.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');
 end if;$old$;
  new_value text := $new$  perform tlb.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');
  -- TLB_CUSTOMER_BOOKING_CALENDAR_V1
  perform tlb.require(ful<=(date_trunc('month',p_submitted at time zone 'Asia/Manila')+interval '3 months - 1 day')::date,'Choose a date within the current month or the next two months.');
 end if;$new$;
begin
  if position('TLB_CUSTOMER_BOOKING_CALENDAR_V1' in definition)=0 then
    -- Dashboard-installed SQL may use CRLF. Preserve its original line endings.
    if position(old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
      old_value:=replace(old_value,chr(10),chr(13)||chr(10));
      new_value:=replace(new_value,chr(10),chr(13)||chr(10));
    end if;
    if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
      raise exception 'Unexpected quote definition in customer booking calendar migration; review before applying.';
    end if;
    execute replace(definition,old_value,new_value);
  end if;
end;
$migration$;
