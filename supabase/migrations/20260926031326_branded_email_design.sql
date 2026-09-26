begin;
-- Version the rendered body and capture public menu photos when queued. Never
-- fetch changing product data from the worker during a provider retry.
create function tlb.brand_email_payload(p_payload jsonb,p_order_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare photos jsonb; saved jsonb;
begin
 if p_order_id is not null then
  select data->'items' into saved from tlb.orders where id=p_order_id;
  select coalesce(jsonb_agg(to_jsonb(coalesce(p.data#>>'{photos,0}','')) order by item.pos),'[]'::jsonb)
   into photos from jsonb_array_elements(coalesce(p_payload#>'{order,items}','[]'::jsonb)) with ordinality item(value,pos)
   left join tlb.products p on p.id::text=coalesce(item.value->>'product_id',saved->(item.pos::int-1)->>'product_id');
 end if;
 return p_payload||jsonb_build_object('email_design_version',2,'product_photos',coalesce(photos,'[]'::jsonb));
end $$;
revoke all on function tlb.brand_email_payload(jsonb,uuid) from public,anon,authenticated;

create function tlb.brand_outbox_email() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.payload:=tlb.brand_email_payload(new.payload,new.order_id);
 elsif old.payload->>'email_design_version'='2' then
  if old.attempts>1 then
   new.payload:=old.payload; new.to_email:=old.to_email;
  elsif new.payload#>'{order,items}' is distinct from old.payload#>'{order,items}' then
   new.payload:=tlb.brand_email_payload(new.payload,new.order_id);
  else
   new.payload:=new.payload||jsonb_build_object('email_design_version',2,'product_photos',old.payload->'product_photos');
  end if;
 end if;
 return new;
end $$;
revoke all on function tlb.brand_outbox_email() from public,anon,authenticated;
create trigger brand_outbox_email before insert or update of payload on tlb.outbox
 for each row execute function tlb.brand_outbox_email();
-- Only upgrade messages that have never been attempted. Accepted/uncertain
-- messages retain their legacy renderer and exact original provider body.
update tlb.outbox set payload=tlb.brand_email_payload(payload,order_id)
 where status='pending' and attempts=0 and first_attempt_at is null;
commit;
