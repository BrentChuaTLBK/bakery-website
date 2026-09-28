import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function({db,check,state}) {
  const h=state.harness;
  const api=(action,payload={},user=h.ids.owner)=>h.as(user,async()=>(await db.query('select public.homepage_api($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result);
  let current;
  await check('homepage: retains all 17 original photos, four categories and banner links',async()=>{
    current=await api('admin_get');assert.equal(current.revision,1);
    assert.deepEqual(current.content,JSON.parse(await readFile(new URL('../homepage-seed.json',import.meta.url),'utf8')));
    assert.deepEqual(await api('browse',{},null),current);
  })();
  await check('homepage: only verified owners can edit, with no direct table/helper access',async()=>{
    for(const user of [null,h.ids.staff,h.ids.customer,h.ids.unverified]){
      for(const action of ['admin_get','save'])await assert.rejects(api(action,{},user),/owner|verified/i);
      await assert.rejects(h.as(user,()=>db.query('select * from tlb.homepage_content')),/permission denied/);
      await assert.rejects(h.as(user,()=>db.query("select tlb.valid_homepage_content('{}')")),/permission denied/);
    }
  })();
  await check('homepage: add, replace, reorder, text and links persist together; retry is idempotent',async()=>{
    const content=structuredClone(current.content);content.hero.reverse();
    content.hero[0].title='New banner';content.hero[0].buttons=[{label:'Baking classes',href:'academy.html?class=summer#albums'}];
    content.specialties[3].photos.push({id:randomUUID(),photo_url:`https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/${h.ids.owner}/${randomUUID()}.webp`,alt:'Students in class'});
    const payload={content,revision:current.revision,operation_id:randomUUID()};
    current=await api('save',payload);assert.equal(current.revision,2);assert.deepEqual(current.content,content);
    assert.deepEqual(await api('browse',{},null),current);assert.deepEqual(await api('save',payload),current);
    await assert.rejects(api('save',{...payload,content:{...content,hero:content.hero.slice(1)}}),/already used/);
    await assert.rejects(api('save',{...payload,operation_id:randomUUID()}),/another window/);
  })();
  await check('homepage: rejects malformed content, unsafe links, duplicate IDs and empty slideshows',async()=>{
    const edits=[
      c=>{c.hero=[];},c=>{c.hero={};},c=>{c.hero=null;},c=>{c.hero=[null];},c=>{delete c.hero[0].title;},
      c=>{c.hero[0].title=' ';},c=>{c.hero[0].title='x'.repeat(101);},c=>{c.hero[0].description='x'.repeat(401);},
      c=>{c.hero[0].buttons=[{label:'Unsafe',href:'javascript:alert(1)'}];},
      c=>{c.hero[0].buttons=[{label:'Unsafe',href:'//evil.test'}];},
      c=>{c.hero[0].buttons=[{label:'Unsafe',href:'https://evil.test'}];},
      c=>{c.hero[0].buttons=[{label:'Unsafe',href:'../account.html'}];},
      c=>{c.hero[0].buttons=[{label:'',href:'shop.html'}];},c=>{c.hero[0].buttons=null;},
      c=>{c.hero[0].photo_url='assets/img/../../private.webp';},c=>{c.hero[0].photo_url='https://evil.test/image.webp';},
      c=>{c.hero[0].photo_url='assets/img/baking-classes.jpg';},c=>{c.hero[0].id=c.hero[1].id;},
      c=>{c.hero[0].alt=null;},c=>{c.hero[0].extra=true;},c=>{c.hero[0].id='wrong';},
      c=>{c.specialties.pop();},c=>{c.specialties[0].id='extra';},c=>{c.specialties[0].photos=[];},
      c=>{c.specialties[0].href='shop.html\n';},c=>{c.specialties[0].photos[0].id=c.hero[0].id;},
      c=>{c.specialties[0].photos=Array.from({length:51},()=>({...c.hero[0],id:randomUUID()}));},
    ];
    for(const edit of edits){const content=structuredClone(current.content);edit(content);await assert.rejects(api('save',{content,revision:current.revision,operation_id:randomUUID()}),/WebP photos/);}
    for(const content of [null,[],{},'bad'])await assert.rejects(api('save',{content,revision:current.revision,operation_id:randomUUID()}),/WebP photos/);
    await assert.rejects(api('save',{content:current.content,revision:current.revision}),/Refresh/);
    assert.deepEqual(await api('admin_get'),current);
  })();
  await check('homepage: later saves cannot be overwritten by an old retry',async()=>{
    const payload={content:current.content,revision:current.revision,operation_id:randomUUID()};
    current=await api('save',payload);
    current=await api('save',{content:current.content,revision:current.revision,operation_id:randomUUID()});
    await assert.rejects(api('save',payload),/another window/);assert.deepEqual(await api('admin_get'),current);
  })();
}
