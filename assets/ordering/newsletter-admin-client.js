import {config} from './config.js';
import {newsletterSession} from './newsletter-client.js';
export async function newsletterAdmin(action,payload={}){
 const session=await newsletterSession();if(!session?.access_token)throw Error('Sign in as the owner to manage newsletters.');
 const response=await fetch(`${config.supabaseUrl}/rest/v1/rpc/newsletter_admin`,{method:'POST',headers:{apikey:config.supabasePublishableKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_payload:payload}),signal:AbortSignal.timeout(30000),credentials:'omit'});
 const data=await response.json().catch(()=>null);if(!response.ok||data?.error)throw Error(data?.message||data?.error||'Newsletter update failed. Try again.');return data;
}
