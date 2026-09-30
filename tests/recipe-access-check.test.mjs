import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRecipeAccess} from '../assets/ordering/recipe-access-check.js';
test('account recipe access reuses the current Auth session and calls only the private bootstrap RPC',async()=>{
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({role:'kitchen'}),{status:200});};
 try{
  assert.deepEqual(await checkRecipeAccess({getSession:async()=>({data:{session:{access_token:'isolated-test-token'}}})}),{role:'kitchen'});
  assert.ok(calls[0].url.endsWith('/rest/v1/rpc/recipe_api'));assert.equal(calls[0].options.headers.Authorization,'Bearer isolated-test-token');assert.deepEqual(JSON.parse(calls[0].options.body),{p_action:'bootstrap',p_payload:{}});
  await assert.rejects(()=>checkRecipeAccess({getSession:async()=>({data:{session:null}})}),/Sign in/);assert.equal(calls.length,1);
  globalThis.fetch=async()=>new Response('{}',{status:403});await assert.rejects(()=>checkRecipeAccess({getSession:async()=>({data:{session:{access_token:'test'}}})}),/unavailable/);
 }finally{globalThis.fetch=old;}
});
