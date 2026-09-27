import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {galleryPhoto,galleryThumbnail,bindThumbnailFallback} from '../assets/ordering/gallery-thumbnail.js';
import {galleryThumbnails} from '../assets/ordering/gallery-thumbnail-map.js';

test('gallery images use WebP originals for saved JPEG URLs and thumbnails for both versions',()=>{
  for(const name of ['IMG_4116','IMG_4140','IMG_8639']){
    const old=`https://thelittlebakerkitchen.com/assets/pastries/CookieBottle/${name}.jpeg`;
    assert.equal(galleryPhoto(old),old.replace('.jpeg','.webp'));
    assert.equal(galleryThumbnail(old),galleryThumbnail(galleryPhoto(old)));
    assert.match(galleryThumbnail(old),/^\/assets\/img\/gallery-thumbnails\/[a-f0-9]+\.webp$/);
  }
});
test('unmapped uploads retain their original URLs and unsafe URLs never become image sources',()=>{
  for(const value of ['https://uploads.example.test/photo.webp','https://thelittlebakerkitchen.com/assets/new.webp','https://thelittlebakerkitchen.com/assets/pastries/CookieBottle/IMG_4116.jpeg?v=2'])assert.equal(galleryThumbnail(value),value);
  for(const value of ['javascript:alert(1)','data:image/png;base64,x','https://user:secret@example.test/image.webp',''])assert.equal(galleryThumbnail(value),'');
});
test('every shipped thumbnail mapping resolves to WebP bytes and all mapped originals exist',async()=>{
  assert.ok(Object.keys(galleryThumbnails).length>=583);
  for(const [original,thumbnail] of Object.entries(galleryThumbnails)){
    const bytes=await readFile(new URL('..'+thumbnail,import.meta.url));
    assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');
    const full=await readFile(new URL('..'+original,import.meta.url));assert.ok(bytes.length<full.length,original);
  }
});
test('a thumbnail failure tries the original before the admin unavailable-image handler and never loops',()=>{
  let handler,stops=0;
  bindThumbnailFallback({addEventListener(name,fn){assert.equal(name,'error');handler=fn;}});
  const original='https://uploads.example.test/photo.webp',image={tagName:'IMG',src:'https://example.test/thumb.webp',dataset:{fullPhoto:original}};
  const event={target:image,stopImmediatePropagation(){stops++;}};
  handler(event);assert.equal(image.src,original);assert.equal(stops,1);assert.equal(image.dataset.fullPhoto,undefined);
  handler(event);assert.equal(stops,1);
});
