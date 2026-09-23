import assert from 'node:assert/strict';

export default async function ({db,check,state}) {
  const h=state.harness;
  const {api,ids,checkout,fixture}=h;
  const format=/^TLB-[A-HJ-NP-Z2-9]{6}$/;

  await check('short references contain letters and digits and remain stable across checkout retries and notifications',async()=>{
    const {product,date}=await fixture(30);
    const references=new Set();
    for(let i=0;i<12;i++){
      const input=checkout(product,date);
      const order=await api('create_order',input);
      assert.match(order.reference,format);
      assert.match(order.reference.slice(4),/[A-Z]/);
      assert.match(order.reference.slice(4),/[2-9]/);
      assert.equal(references.has(order.reference),false);
      references.add(order.reference);
      const retry=await api('create_order',input);
      assert.equal(retry.id,order.id);
      assert.equal(retry.reference,order.reference);
      assert.equal(retry.access_token,order.access_token);
      assert.match(order.access_token,/^[a-f0-9]{64}$/);
      const mail=(await db.query("select subject,payload->'order'->>'reference' as reference from tlb.outbox where order_id=$1 and event_type='order_submitted'",[order.id])).rows;
      assert.equal(mail.length,1);
      assert.equal(mail[0].reference,order.reference);
      assert.ok(mail[0].subject.includes(order.reference));
    }
  })();

  await check('a short reference cannot replace the private token or authorize another customer',async()=>{
    const {product,date}=await fixture();
    const guest=await api('create_order',checkout(product,date));
    await assert.rejects(api('get_order',{order_id:guest.id}),/access|authorized/i);
    await assert.rejects(api('get_order',{order_id:guest.id},null,guest.reference),/access|authorized/i);
    await assert.rejects(api('get_order',{reference:guest.reference}),/access|authorized/i);
    await assert.rejects(api('get_order',{order_id:guest.id},ids.stranger),/access|authorized/i);
    await assert.rejects(api('get_order',{order_id:guest.id},null,'f'.repeat(64)),/access|authorized/i);
    assert.equal((await api('get_order',{order_id:guest.id},null,guest.access_token)).reference,guest.reference);
    const owned=await api('create_order',checkout(product,date),ids.customer);
    assert.equal((await api('get_order',{order_id:owned.id},ids.customer)).reference,owned.reference);
    await assert.rejects(api('get_order',{order_id:owned.id},ids.stranger),/access|authorized/i);
    for(const role of ['anon','authenticated','service_role']){
      assert.equal(await h.scalar("select has_function_privilege($1,'tlb.new_order_reference()','execute')",[role]),false);
    }
  })();

  await check('legacy order references and secure links continue to work',async()=>{
    const {product,date}=await fixture();
    const input=checkout(product,date);
    const order=await api('create_order',input);
    const legacy='TLB-260919-012345ABCD';
    await db.query('update tlb.orders set reference=$1 where id=$2',[legacy,order.id]);
    assert.equal((await api('get_order',{order_id:order.id},null,order.access_token)).reference,legacy);
    assert.equal((await api('create_order',input)).reference,legacy);
  })();

  // Deterministic RNG substitution is confined to this local test transaction.
  // It proves collision retries/growth rather than hoping a random collision occurs.
  async function withControlledRandom(body,callback){
    await db.exec('begin');
    try{
      await db.exec('alter function extensions.gen_random_bytes(integer) rename to reference_test_random_bytes_original');
      await db.exec('create temporary table reference_test_random_calls(n integer); insert into reference_test_random_calls values(0)');
      await db.exec(`create function extensions.gen_random_bytes(size integer) returns bytea language plpgsql as $$ declare n integer; begin if size between 6 and 12 then update pg_temp.reference_test_random_calls set n=reference_test_random_calls.n+1 returning reference_test_random_calls.n into n; ${body} end if; return extensions.reference_test_random_bytes_original(size); end $$`);
      await callback();
    }finally{await db.exec('rollback');}
  }

  await check('reference allocation retries single-type codes and an existing reference collision',async()=>{
    const {product,date}=await fixture();
    const old=await api('create_order',checkout(product,date));
    await db.query("update tlb.orders set reference='TLB-A2B3C4' where id=$1",[old.id]);
    await withControlledRandom(`if n=1 then return decode('000000000000','hex'); elsif n=2 then return decode('181818181818','hex'); elsif n=3 then return decode('00180119021a','hex'); else return decode('00180119021b','hex'); end if;`,async()=>{
      const order=await api('create_order',checkout(product,date));
      assert.equal(order.reference,'TLB-A2B3C5');
      assert.equal(await h.scalar('select n from pg_temp.reference_test_random_calls'),4);
      assert.equal((await api('get_order',{order_id:old.id},null,old.access_token)).reference,'TLB-A2B3C4');
    });
  })();

  await check('reference allocation can grow past six characters after bounded collision retries',async()=>{
    const {product,date}=await fixture();
    const old=await api('create_order',checkout(product,date));
    await db.query("update tlb.orders set reference='TLB-D2E3F4' where id=$1",[old.id]);
    await withControlledRandom(`if size=6 then return decode('03180419051a','hex'); else return decode('03180419051a06','hex'); end if;`,async()=>{
      const order=await api('create_order',checkout(product,date));
      assert.equal(order.reference,'TLB-D2E3F4G');
      assert.equal(await h.scalar('select n from pg_temp.reference_test_random_calls'),65);
      assert.equal((await api('get_order',{order_id:order.id},null,order.access_token)).reference,order.reference);
    });
  })();
}
