-- Support foreign-key checks and growing order/history lookups without scans.
-- Fail quickly rather than wait behind a busy production transaction.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index if not exists action_keys_order_id_idx on tlb.action_keys (order_id);
create index if not exists history_order_id_at_id_idx on tlb.history (order_id, at, id);
create index if not exists newsletter_campaign_tokens_campaign_id_idx on tlb.newsletter_campaign_tokens (campaign_id);
create index if not exists newsletter_campaigns_created_by_idx on tlb.newsletter_campaigns (created_by);
create index if not exists payments_approved_by_idx on tlb.payments (approved_by);
create index if not exists promo_usage_user_id_idx on tlb.promo_usage (user_id);

-- Supabase's optional internal DDL trigger is not a browser RPC. Retain the
-- trigger and its owner permissions; remove only unnecessary client access.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
