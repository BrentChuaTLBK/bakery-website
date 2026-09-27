-- Deploy the three .webp assets before applying this data migration.
-- The browser also recognizes old JPEG URLs during the deployment transition.
set local lock_timeout = '3s';
update tlb.gallery_photos
set photo_url = regexp_replace(photo_url, '\.jpeg$', '.webp'),
    revision = revision + 1
where photo_url in (
  'https://thelittlebakerkitchen.com/assets/pastries/CookieBottle/IMG_4116.jpeg',
  'https://thelittlebakerkitchen.com/assets/pastries/CookieBottle/IMG_4140.jpeg',
  'https://thelittlebakerkitchen.com/assets/pastries/CookieBottle/IMG_8639.jpeg'
);
