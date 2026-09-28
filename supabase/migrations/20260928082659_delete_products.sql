-- Keep only deleted IDs so an old product editor cannot recreate a removed item.
create table tlb.deleted_products (
  id uuid primary key,
  deleted_at timestamptz not null default clock_timestamp()
);
alter table tlb.deleted_products enable row level security;
revoke all on tlb.deleted_products from public, anon, authenticated;

create function tlb.guard_deleted_product() returns trigger
language plpgsql set search_path='' as $$
begin
  -- Shares the catalog reorder lock; prevents delete/save/reorder races.
  perform pg_advisory_xact_lock(841721950318::bigint);
  perform tlb.require(not exists(select 1 from tlb.deleted_products where id=new.id),
    'This product was deleted. Refresh Products before making further changes.');
  return new;
end;
$$;
revoke all on function tlb.guard_deleted_product() from public, anon, authenticated;
create trigger guard_deleted_product before insert or update on tlb.products
for each row execute function tlb.guard_deleted_product();

create function tlb.delete_product(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare p tlb.products; product_id uuid:=(p_payload->>'id')::uuid;
begin
  perform tlb.require(tlb.is_verified(auth.uid()),'A verified owner account is required.');
  perform tlb.assert_staff(auth.uid(),true);
  perform tlb.require(product_id is not null,'Choose a product to delete.');
  perform pg_advisory_xact_lock(841721950318::bigint);
  select * into p from tlb.products where id=product_id for update;
  if not found then
    perform tlb.require(exists(select 1 from tlb.deleted_products where id=product_id),
      'Product not found. Refresh Products and try again.');
    return jsonb_build_object('id',product_id,'deleted',true);
  end if;
  perform tlb.require(jsonb_typeof(p_payload->'expected_product')='object'
    and p_payload->'expected_product'=p.data||jsonb_build_object('id',p.id),
    'This product changed in another window. Refresh Products and review it before deleting.');
  perform tlb.require(not exists(select 1 from tlb.allocations a where a.product_id=p.id)
    and not exists(select 1 from tlb.orders o, jsonb_array_elements(o.data->'items') item where item->>'product_id'=p.id::text),
    'This product has order history and cannot be deleted. Turn off "Show this product in the shop" to hide it instead.');
  insert into tlb.deleted_products(id) values(p.id);
  delete from tlb.inventory i where i.product_id=p.id;
  delete from tlb.products where id=p.id;
  -- Photo files may also be used by orders, newsletters or the homepage.
  return jsonb_build_object('id',p.id,'deleted',true);
end;
$$;
revoke all on function tlb.delete_product(jsonb) from public, anon, authenticated;

do $$
declare
  original text:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  definition text:=replace(original,E'\r\n',E'\n');
  needle text:=$old$ elsif p_action='save_inventory' then$old$;
begin
  if length(definition)-length(replace(definition,needle,''))<>length(needle) then
    raise exception 'Unexpected shop API definition; review product deletion migration.';
  end if;
  definition:=replace(definition,needle,$new$ elsif p_action='delete_product' then
  return tlb.delete_product(p_payload);
 elsif p_action='save_inventory' then$new$);
  if position(E'\r\n' in original)>0 then definition:=replace(definition,E'\n',E'\r\n'); end if;
  execute definition;
end;
$$;
