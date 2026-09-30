import {credentials,json} from '../_shared/server.ts';
Deno.serve(async request=>{
 if(request.method!=='POST')return new Response('Use the unsubscribe button in your email or the TLB Academy preference page.',{status:405,headers:{Allow:'POST'}});
 const token=new URL(request.url).searchParams.get('token');if(!/^[a-f0-9]{64}$/.test(token||''))return json({error:'Invalid preference link.'},400);
 const {url,key}=credentials();const response=await fetch(`${url}/rest/v1/rpc/academy_unsubscribe`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_token:token}),signal:AbortSignal.timeout(15000)});
 return response.ok?json({unsubscribed:true}):json({error:'Please try again.'},503);
});
