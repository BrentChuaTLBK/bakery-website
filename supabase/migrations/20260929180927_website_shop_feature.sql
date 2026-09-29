begin;

create function tlb.default_shop_feature() returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('photo_url','assets/img/products-webp/Pastries_4-800w.webp',
  'alt','Pastries from The Little Baker Kitchen','caption','Baked with a little love.')
$$;
revoke all on function tlb.default_shop_feature() from public,anon,authenticated,service_role;

do $patch$ declare d text; anchor text; begin
 d:=pg_get_functiondef('tlb.valid_homepage_content(jsonb)'::regprocedure);
 anchor:=$a$content - 'hero' - 'specialties' <> '{}'::jsonb$a$;
 perform tlb.require(position(anchor in d)>0,'Missing website content validation.');
 d:=replace(d,anchor,$a$content - 'hero' - 'specialties' - 'shop_feature' <> '{}'::jsonb$a$);
 anchor:='  return true;';
 perform tlb.require(position(anchor in d)>0,'Missing website content validation return.');
 execute replace(d,anchor,$a$
  if content ? 'shop_feature' then
   if jsonb_typeof(content->'shop_feature') is distinct from 'object'
    or (content->'shop_feature') - 'photo_url' - 'alt' - 'caption' <> '{}'::jsonb
    or jsonb_typeof(content#>'{shop_feature,alt}') is distinct from 'string' or length(content#>>'{shop_feature,alt}')>200
    or jsonb_typeof(content#>'{shop_feature,caption}') is distinct from 'string' or length(content#>>'{shop_feature,caption}')>120
    or jsonb_typeof(content#>'{shop_feature,photo_url}') is distinct from 'string'
    or not (coalesce(content#>>'{shop_feature,photo_url}','') ~ '^assets/img/(products-webp/([A-Za-z0-9_-]|%20)+|baking-classes)\.webp$'
      or coalesce(content#>>'{shop_feature,photo_url}','') ~ '^https://aulhqofjjckwwjmdvqgi\.supabase\.co/storage/v1/object/public/product-images/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$') then return false; end if;
  end if;
  return true;$a$);

 d:=pg_get_functiondef('public.homepage_api(text,jsonb)'::regprocedure);
 anchor:='select * into cfg from tlb.homepage_content where id for update;';
 perform tlb.require(position(anchor in d)>0,'Missing website save lock.');
 -- Older open editors may omit the new section. Retain the current saved image
 -- under the same lock/revision check instead of deleting that section.
 d:=replace(d,anchor,anchor||$a$
    cfg.content:=cfg.content||jsonb_build_object('shop_feature',coalesce(cfg.content->'shop_feature',tlb.default_shop_feature()));
    p_payload:=jsonb_set(p_payload,'{content}',(p_payload->'content')||jsonb_build_object('shop_feature',
      coalesce(p_payload#>'{content,shop_feature}',cfg.content->'shop_feature',tlb.default_shop_feature())));$a$);
 anchor:=$a$jsonb_build_object('content',cfg.content,'revision',cfg.revision)$a$;
 perform tlb.require(position(anchor in d)>0,'Missing website content response.');
 execute replace(d,anchor,$a$jsonb_build_object('content',cfg.content||jsonb_build_object('shop_feature',coalesce(cfg.content->'shop_feature',tlb.default_shop_feature())),'revision',cfg.revision)$a$);

 -- The shop already requests its catalog. Include its public image there so
 -- rendering does not need another request or wait for the content editor API.
 d:=pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
 anchor:=$a$return jsonb_build_object('products',result,'categories',$a$;
 perform tlb.require(position(anchor in d)>0,'Missing public shop catalog.');
 execute replace(d,anchor,$a$return jsonb_build_object('shop_feature',coalesce((select content->'shop_feature' from tlb.homepage_content where id),tlb.default_shop_feature()),'products',result,'categories',$a$);
end $patch$;

commit;
