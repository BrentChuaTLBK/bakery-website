import {config} from './config.js';
// Reuse the page's Auth session. Loading a second version of client.js would
// create another Auth client for the same storage key.
export async function checkRecipeAccess(auth){
 const {data,error}=await auth.getSession();
 if(error||!data?.session?.access_token)throw Error('Sign in to open recipes.');
 const response=await fetch(`${config.supabaseUrl}/rest/v1/rpc/recipe_api`,{
  method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey,Authorization:`Bearer ${data.session.access_token}`},
  body:JSON.stringify({p_action:'bootstrap',p_payload:{}}),signal:AbortSignal.timeout(15000),
 });
 if(!response.ok)throw Error('Recipe access is unavailable.');return response.json();
}
