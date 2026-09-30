begin;
-- New messages snapshot the shorter public brand. Existing outbox payloads
-- retain their original settings and rendered-body identity for provider retries.
update tlb.settings
set data=jsonb_set(data,'{shop_name}',to_jsonb('TLB Kitchen'::text),true)
where id and (nullif(btrim(data->>'shop_name'),'') is null
  or lower(btrim(data->>'shop_name'))='the little baker kitchen');
commit;
