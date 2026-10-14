-- Undo an accidental fulfillment completion without reversing payment, stock,
-- accounting or the order's saved commercial details. Pop-up counter sales
-- use completion as the sale itself and retain their separate void workflow.
begin;
set local lock_timeout='3s';

do $migration$
declare
 definition text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 old_actions text:=$old$p_action in ('approve_payment','reject_payment','set_fulfillment','cancel_order','set_refund_label','edit_order','preview_edit_order','add_staff_note')$old$;
 new_actions text:=$new$p_action in ('approve_payment','reject_payment','set_fulfillment','reopen_order','cancel_order','set_refund_label','edit_order','preview_edit_order','add_staff_note')$new$;
 guard text:=$guard$ if p_action='reopen_order' then
  perform tlb.require(tlb.is_verified(u),'Verify your staff email before reopening an order.');
  perform tlb.require(jsonb_typeof(p_payload->'reason')='string','A reopening reason is required.');
  for field in select jsonb_object_keys(p_payload) loop
   perform tlb.require(field in ('order_id','revision','idempotency_key','reason'),'Unsupported reopening field: '||field);
  end loop;
 end if;
$guard$;
 marker text:=$marker$ elsif p_action='cancel_order' then
  perform tlb.require(reason is not null,'A cancellation reason is required.');$marker$;
 transition text:=$transition$ elsif p_action='reopen_order' then
  perform tlb.require(length(reason) between 1 and 4000,'Enter a reopening reason (maximum 4000 characters).');
  perform tlb.require(o.source in ('website','direct_message'),'Only website and direct fulfillment orders can be reopened.');
  perform tlb.require(o.payment_status='paid' and o.fulfillment_status='completed' and not o.refund_label,
   'Only a paid, completed order without a Refund label can be reopened.');
  update tlb.orders set fulfillment_status='confirmed',revision=revision+1 where id=oid;
$transition$;
begin
 -- Match the installed body's line endings without rewriting other routes.
 guard:=replace(guard,E'\r','');
 marker:=replace(marker,E'\r','');transition:=replace(transition,E'\r','');
 if position(E'\r\n' in definition)>0 then
  guard:=replace(guard,chr(10),chr(13)||chr(10));
  marker:=replace(marker,chr(10),chr(13)||chr(10));
  transition:=replace(transition,chr(10),chr(13)||chr(10));
 end if;
 -- The existing shop API already checks staff authority, takes the shop/order
 -- locks, validates revision/retry keys, and writes before/after audit history.
 -- Check verification before its retry path as well as before a new change.
 if position(new_actions in definition)=0 then
  perform tlb.require(position(old_actions in definition)>0,'Reopen order: action-list marker missing.');
  definition:=replace(definition,' perform tlb.require('||old_actions,
   guard||' perform tlb.require('||new_actions);
  perform tlb.require(position(guard in definition)>0,'Reopen order: verification marker missing.');
 end if;
 if position($needle$ elsif p_action='reopen_order' then$needle$ in definition)=0 then
  perform tlb.require(position(marker in definition)>0,'Reopen order: fulfillment marker missing.');
  definition:=replace(definition,marker,transition||marker);
 end if;
 execute definition;
end $migration$;

-- Existing order triggers update the same calendar event and mark the active
-- order backup dirty. Accounting receives unchanged amounts and adds no ledger
-- movement. The shared footer audits the reason and stores the retry key;
-- reopening itself sends no customer email and does not recreate payments.
commit;
