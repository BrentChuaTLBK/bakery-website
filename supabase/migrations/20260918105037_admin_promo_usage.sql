-- Report the authoritative usage ledger in the existing owner-only promo list.
-- This adds counts only; it does not change reservations, orders, or permissions.
do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := $old$'promos',case when role_name='owner' then (select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from tlb.promos) else '[]'::jsonb end$old$;
  new_value text := $new$'promos',case when role_name='owner' then (
    select coalesce(jsonb_agg(p.data||jsonb_build_object(
      'id',p.id,
      'usage_count',coalesce(usage.usage_count,0),
      'redeemed_count',coalesce(usage.redeemed_count,0),
      'reserved_count',coalesce(usage.reserved_count,0)
    )),'[]'::jsonb)
    from tlb.promos p
    left join (
      select promo_id,count(*) as usage_count,
        count(*) filter (where state='redeemed') as redeemed_count,
        count(*) filter (where state='reserved') as reserved_count
      from tlb.promo_usage group by promo_id
    ) usage on usage.promo_id=p.id
  ) else '[]'::jsonb end$new$;
begin
  -- Preserve every other live API change and its ownership/security settings.
  -- Abort on unexpected source instead of silently replacing the wrong query.
  if length(definition) - length(replace(definition,old_value,'')) = length(old_value) then
    execute replace(definition,old_value,new_value);
  elsif position(old_value in definition)=0
    and length(definition) - length(replace(definition,new_value,'')) = length(new_value) then
    null; -- Safe to replay without touching existing data.
  else
    raise exception 'Unexpected admin_bootstrap promo query; review public.shop_api before applying promo usage counts.';
  end if;
end;
$migration$;
