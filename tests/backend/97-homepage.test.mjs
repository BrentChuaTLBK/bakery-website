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
  await check('website content: shop feature saves independently and appears in the public catalog',async()=>{
    const original=structuredClone(current.content);
    const content={...original,shop_feature:{photo_url:`https://aulhqofjjckwwjmdvqgi.supabase.co/storage/v1/object/public/product-images/${h.ids.owner}/${randomUUID()}.webp`,alt:'Macarons in a box',caption:'A little treat <for you>'}};
    current=await api('save',{content,revision:current.revision,operation_id:randomUUID()});
    assert.deepEqual(current.content.hero,original.hero);assert.deepEqual(current.content.specialties,original.specialties);
    assert.deepEqual((await h.api('catalog')).shop_feature,content.shop_feature);
    assert.deepEqual((await api('browse',{},null)).content.shop_feature,content.shop_feature);
    const oldEditor=structuredClone(current.content);delete oldEditor.shop_feature;
    const payload={content:oldEditor,revision:current.revision,operation_id:randomUUID()};
    current=await api('save',payload);assert.deepEqual(current.content.shop_feature,content.shop_feature);
    assert.deepEqual(await api('save',payload),current,'Retry from an older editor preserves the feature');
  })();
  await check('website content: a successful pre-upgrade save can still be retried without overwriting content',async()=>{
    await db.exec('begin');
    try{
      await db.exec("update tlb.homepage_content set content=content-'shop_feature'");
      const previous=(await db.query('select content,revision,last_save from tlb.homepage_content where id')).rows[0];
      const retry=await api('save',{content:previous.content,revision:previous.revision,operation_id:previous.last_save});
      assert.equal(retry.revision,previous.revision);
      assert.deepEqual(retry.content.hero,previous.content.hero);
      assert.equal(retry.content.shop_feature.caption,'Baked with a little love.');
    }finally{await db.exec('rollback');}
  })();
  await check('website content: shop image validates paths, types, caption length and owner access',async()=>{
    for(const feature of [null,[],{...current.content.shop_feature,photo_url:'javascript:alert(1)'},{...current.content.shop_feature,photo_url:'https://evil.test/a.webp'},{...current.content.shop_feature,alt:null},{...current.content.shop_feature,caption:null},{...current.content.shop_feature,caption:'x'.repeat(121)},{...current.content.shop_feature,alt:'x'.repeat(201)},{...current.content.shop_feature,extra:true}]){
      await assert.rejects(api('save',{content:{...current.content,shop_feature:feature},revision:current.revision,operation_id:randomUUID()}),/WebP photos/);
    }
    const content={...current.content,shop_feature:{...current.content.shop_feature,caption:''}};
    await assert.rejects(api('save',{content,revision:current.revision,operation_id:randomUUID()},h.ids.staff),/owner/);
    current=await api('save',{content,revision:current.revision,operation_id:randomUUID()});assert.equal((await h.api('catalog')).shop_feature.caption,'');
    assert.equal(await h.scalar("select has_function_privilege('authenticated','tlb.default_shop_feature()','execute')"),false);
  })();
}
