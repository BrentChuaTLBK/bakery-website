-- Homepage media is independent of product, Academy and event-page content.
create function tlb.valid_homepage_link(value text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(length(value) <= 300 and value ~ '^[A-Za-z0-9_-]+\.html([?#][A-Za-z0-9_~.%=&/?#:+,-]*)?$', false);
$$;

create function tlb.valid_homepage_content(content jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare section jsonb; photo jsonb; button jsonb; photos jsonb; hero boolean; ids text[] := '{}';
begin
  if jsonb_typeof(content) is distinct from 'object' or content - 'hero' - 'specialties' <> '{}'::jsonb
    or jsonb_typeof(content->'hero') is distinct from 'array'
    or jsonb_typeof(content->'specialties') is distinct from 'array' then return false; end if;
  if jsonb_array_length(content->'specialties') <> 4 then return false; end if;
  if (select array_agg(s->>'id' order by s->>'id') from jsonb_array_elements(content->'specialties') s)
    is distinct from array['academy','custom','party','pastries'] then return false; end if;
  for section in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('id','hero','photos',content->'hero')) || (content->'specialties')) loop
    hero := section->>'id' = 'hero'; photos := section->'photos';
    if not hero and (jsonb_typeof(section->'title') is distinct from 'string' or length(trim(section->>'title')) not between 1 and 60
      or not tlb.valid_homepage_link(section->>'href') or section - 'id' - 'title' - 'href' - 'photos' <> '{}'::jsonb) then return false; end if;
    if jsonb_typeof(photos) is distinct from 'array' then return false; end if;
    if jsonb_array_length(photos) not between 1 and 50 then return false; end if;
    for photo in select value from jsonb_array_elements(photos) loop
      if jsonb_typeof(photo) is distinct from 'object'
        or coalesce(photo->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or lower(photo->>'id') = any(ids)
        or jsonb_typeof(photo->'alt') is distinct from 'string' or length(photo->>'alt') > 200
        or jsonb_typeof(photo->'photo_url') is distinct from 'string'
        or not (coalesce(photo->>'photo_url','') ~ '^assets/img/(products-webp/([A-Za-z0-9_-]|%20)+|baking-classes)\.webp$'
          or coalesce(photo->>'photo_url','') ~ '^https://aulhqofjjckwwjmdvqgi\.supabase\.co/storage/v1/object/public/product-images/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$') then return false; end if;
      ids := array_append(ids,lower(photo->>'id'));
      if hero then
        if photo - 'id' - 'photo_url' - 'alt' - 'title' - 'description' - 'buttons' <> '{}'::jsonb
          or jsonb_typeof(photo->'title') is distinct from 'string' or length(trim(photo->>'title')) not between 1 and 100
          or jsonb_typeof(photo->'description') is distinct from 'string' or length(photo->>'description') > 400
          or jsonb_typeof(photo->'buttons') is distinct from 'array' then return false; end if;
        if jsonb_array_length(photo->'buttons') > 2 then return false; end if;
        for button in select value from jsonb_array_elements(photo->'buttons') loop
          if jsonb_typeof(button) is distinct from 'object' or button - 'label' - 'href' <> '{}'::jsonb
            or jsonb_typeof(button->'label') is distinct from 'string' or length(trim(button->>'label')) not between 1 and 40
            or not tlb.valid_homepage_link(button->>'href') then return false; end if;
        end loop;
      elsif photo - 'id' - 'photo_url' - 'alt' <> '{}'::jsonb then return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;
revoke all on function tlb.valid_homepage_link(text),tlb.valid_homepage_content(jsonb) from public,anon,authenticated;

create table tlb.homepage_content (
  id boolean primary key default true check(id),
  content jsonb not null check(tlb.valid_homepage_content(content)),
  revision integer not null default 1,
  last_save uuid,
  updated_at timestamptz not null default now()
);
alter table tlb.homepage_content enable row level security;
revoke all on tlb.homepage_content from public,anon,authenticated;

-- Seeded from the existing homepage; preserve every current slide and link.
insert into tlb.homepage_content(content) values ($homepage${"hero": [{"id": "00000000-0000-4000-8000-000000000001", "photo_url": "assets/img/products-webp/HomePage1-1600w.webp", "alt": "The Little Baker Kitchen", "title": "The Little Baker Kitchen", "description": "We specialize in crafting delicious pastries and custom cakes for your special occasions.", "buttons": [{"label": "View Portfolio", "href": "customorders.html"}]}, {"id": "00000000-0000-4000-8000-000000000002", "photo_url": "assets/img/products-webp/Home_Page_2-1600w.webp", "alt": "Custom Cakes and Pastries", "title": "Custom Cakes and Pastries", "description": "Choose from our vast selection of designs or create your own!", "buttons": [{"label": "View Pastries", "href": "pastries.html"}, {"label": "View Designs", "href": "customorders.html"}]}, {"id": "00000000-0000-4000-8000-000000000003", "photo_url": "assets/img/products-webp/Home_Page_3-1600w.webp", "alt": "Perfect for Any Occasion", "title": "Perfect for Any Occasion", "description": "We're excited to help make your celebration extra special.", "buttons": [{"label": "View Party Carts", "href": "partycarts.html"}]}, {"id": "00000000-0000-4000-8000-000000000004", "photo_url": "assets/img/products-webp/HomePage4-1600w.webp", "alt": "Ready to plan your event?", "title": "Ready to plan your event?", "description": "Just send us a message on any of our social media accounts, viber, or email.", "buttons": [{"label": "Contact Us!", "href": "contactus.html"}]}], "specialties": [{"id": "custom", "title": "Custom Orders", "href": "customorders.html", "photos": [{"id": "00000000-0000-4000-8000-000000000005", "photo_url": "assets/img/products-webp/IMG_3958-1600w.webp", "alt": "Custom Orders"}, {"id": "00000000-0000-4000-8000-000000000006", "photo_url": "assets/img/products-webp/Custom%20Orders%202-1600w.webp", "alt": "Custom Orders"}, {"id": "00000000-0000-4000-8000-000000000007", "photo_url": "assets/img/products-webp/Custom_Orders_3-1600w.webp", "alt": "Custom Orders"}, {"id": "00000000-0000-4000-8000-000000000008", "photo_url": "assets/img/products-webp/reviews3-1600w.webp", "alt": "Custom Orders"}]}, {"id": "pastries", "title": "Pastries", "href": "pastries.html", "photos": [{"id": "00000000-0000-4000-8000-000000000009", "photo_url": "assets/img/products-webp/IMG_7181-1600w.webp", "alt": "Pastries"}, {"id": "00000000-0000-4000-8000-000000000010", "photo_url": "assets/img/products-webp/Pastries_2-1600w.webp", "alt": "Pastries"}, {"id": "00000000-0000-4000-8000-000000000011", "photo_url": "assets/img/products-webp/Pastries_3-1600w.webp", "alt": "Pastries"}, {"id": "00000000-0000-4000-8000-000000000012", "photo_url": "assets/img/products-webp/Pastries_4-1600w.webp", "alt": "Pastries"}]}, {"id": "party", "title": "Party Carts & Events", "href": "partycarts.html", "photos": [{"id": "00000000-0000-4000-8000-000000000013", "photo_url": "assets/img/products-webp/Party_Cart_1-1600w.webp", "alt": "Party Carts & Events"}, {"id": "00000000-0000-4000-8000-000000000014", "photo_url": "assets/img/products-webp/Party_Cart_2-1600w.webp", "alt": "Party Carts & Events"}, {"id": "00000000-0000-4000-8000-000000000015", "photo_url": "assets/img/products-webp/Party_Cart_3-1600w.webp", "alt": "Party Carts & Events"}, {"id": "00000000-0000-4000-8000-000000000016", "photo_url": "assets/img/products-webp/Party_Cart_4-1600w.webp", "alt": "Party Carts & Events"}]}, {"id": "academy", "title": "Baking Classes", "href": "academy.html", "photos": [{"id": "00000000-0000-4000-8000-000000000017", "photo_url": "assets/img/baking-classes.webp", "alt": "Baking Classes"}]}]}$homepage$::jsonb);

create function public.homepage_api(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg tlb.homepage_content; operation uuid;
begin
  if p_action is distinct from 'browse' then
    perform tlb.require(tlb.is_verified(auth.uid()),'Sign in with a verified owner account.');
    perform tlb.assert_staff(auth.uid(),true);
  end if;
  if p_action in ('browse','admin_get') then
    select * into cfg from tlb.homepage_content where id;
  elsif p_action = 'save' then
    perform tlb.require(octet_length(p_payload::text) <= 200000 and tlb.valid_homepage_content(p_payload->'content'),
      'Use 1–50 WebP photos per slideshow, complete banner titles, and valid website page links. Keep all four category cards.');
    operation := (p_payload->>'operation_id')::uuid;
    perform tlb.require(operation is not null,'Refresh the Home page editor before saving.');
    select * into cfg from tlb.homepage_content where id for update;
    if cfg.last_save = operation then
      perform tlb.require(cfg.content = p_payload->'content','This save ID was already used. Refresh the editor.');
    else
      perform tlb.require(cfg.revision = (p_payload->>'revision')::integer,
        'The home page changed in another window. Your edits are still here; copy any text you need, then reload the saved version.');
      update tlb.homepage_content set content=p_payload->'content',revision=revision+1,last_save=operation,updated_at=now()
        where id returning * into cfg;
    end if;
  else raise exception 'Unknown Home page action.';
  end if;
  return jsonb_build_object('content',cfg.content,'revision',cfg.revision);
end;
$$;
revoke all on function public.homepage_api(text,jsonb) from public,anon,authenticated;
grant execute on function public.homepage_api(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
