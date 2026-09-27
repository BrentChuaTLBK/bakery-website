import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export default async function({db,check}) {
  const migration=await readFile(new URL('../../supabase/migrations/20260927193156_system_audit_indexes_and_internal_privileges.sql',import.meta.url),'utf8');
  await check('Gallery WebP migration updates only converted originals, invalidates stale edits and is repeatable',async()=>{
    const sql=await readFile(new URL('../../supabase/migrations/20260927194251_gallery_webp_originals.sql',import.meta.url),'utf8');
    await db.exec('begin');
    try {
      const old='https://thelittlebakerkitchen.com/assets/pastries/CookieBottle/IMG_4116.jpeg';
      const {rows:[photo]}=await db.query("insert into tlb.gallery_photos(gallery,title,category,photo_url) values('pastries','WebP migration fixture','Cookies',$1) returning id,revision",[old]);
      await db.exec(sql);await db.exec(sql);
      const {rows:[saved]}=await db.query('select photo_url,revision from tlb.gallery_photos where id=$1',[photo.id]);
      assert.equal(saved.photo_url,old.replace('.jpeg','.webp'));assert.equal(saved.revision,photo.revision+1);
    } finally {await db.exec('rollback');}
  })();
  await check('Order and newsletter foreign keys have usable leading-column indexes',async()=>{
    const expected=[['action_keys','order_id'],['history','order_id'],['newsletter_campaign_tokens','campaign_id'],['newsletter_campaigns','created_by'],['payments','approved_by'],['promo_usage','user_id']];
    for(const [table,column] of expected){
      const {rows}=await db.query(`select i.indexrelid::regclass::text as name from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace join pg_attribute a on a.attrelid=t.oid and a.attnum=i.indkey[0] where n.nspname='tlb' and t.relname=$1 and a.attname=$2 and i.indisvalid and i.indpred is null`,[table,column]);
      assert.ok(rows.length,`${table}.${column} needs an index usable by its foreign key`);
    }
  })();
  await check('Audit migration is repeatable and removes client execution without disabling the internal RLS trigger',async()=>{
    await db.exec('begin');
    try {
      await db.exec(`create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path=pg_catalog as $$ begin return; end $$;
        grant execute on function public.rls_auto_enable() to public,anon,authenticated;
        create event trigger audit_rls_fixture on ddl_command_end when tag in ('CREATE TABLE') execute function public.rls_auto_enable();`);
      await db.exec(migration);await db.exec(migration);
      const {rows}=await db.query(`select has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') as anon,has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') as customer,(select evtenabled from pg_event_trigger where evtname='audit_rls_fixture') as trigger_enabled`);
      assert.deepEqual(rows[0],{anon:false,customer:false,trigger_enabled:'O'});
      await db.exec('create table public.audit_rls_smoke(id integer)');
    } finally {await db.exec('rollback');}
  })();
}
