import {credentials, env, HttpError} from './server.ts';
import {renderNewsletterCampaign} from '../../../assets/ordering/newsletter-templates.js';

async function service(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const {url,key}=credentials();
  const response=await fetch(`${url}/rest/v1/rpc/newsletter_broadcast_service`,{
    method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_action:action,p_payload:payload}),signal:AbortSignal.timeout(8000),
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error('Broadcast database operation failed');
  return data;
}

// Broadcast send does not document the transactional email idempotency contract.
// Store its ID, then persist send intent BEFORE asking Resend to send. After an
// ambiguous response, reconcile that same ID; never blindly issue another send.
export async function processNewsletterBroadcast(): Promise<string> {
  const job=await service('claim');
  if(!job)return 'idle';
  const lease={id:job.campaign_id,lease_token:job.lease_token};
  let nextRequest=0;
  try{
    const key=env('NEWSLETTER_RESEND_API_KEY')||env('RESEND_API_KEY');
    const sender=env('NEWSLETTER_FROM')||env('EMAIL_FROM');
    if(!key||!sender)throw new HttpError(503,'Newsletter sender configuration is missing.');
    const provider=async(path:string,body?:any)=>{
      const delay=nextRequest-Date.now();
      if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      nextRequest=Date.now()+600;
      const response=await fetch(`https://api.resend.com/broadcasts${path}`,{
        method:body===undefined?'GET':'POST',
        headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000),
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok)throw new HttpError(502,`Resend Broadcast request failed (HTTP ${response.status}). Check the newsletter API key permissions, sender and Resend logs.`);
      return result;
    };
    let id=job.provider_id;
    if(!id){
      const rendered=renderNewsletterCampaign(job.content,job.settings,'{{{RESEND_UNSUBSCRIBE_URL}}}');
      const created=await provider('',{
        name:`TLB newsletter ${job.campaign_id}`,segment_id:job.segment_id,topic_id:job.topic_id,
        from:sender,subject:String(job.content.subject).replace(/[\r\n]/g,' '),
        preview_text:job.content.preheader||'',...rendered,send:false,
      });
      if(!/^[0-9a-f-]{36}$/i.test(created?.id||''))throw new Error('Missing Broadcast ID');
      id=created.id;
      // A lost create response can leave an unsent draft, never a second send.
      await service('record_draft',{...lease,provider_id:id});
    }
    if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid stored Broadcast ID');
    const current=await provider(`/${id}`);
    if(current?.id!==id||current.segment_id!==job.segment_id||current.topic_id!==job.topic_id){
      await service('failed',{...lease,terminal:true,error:'The Resend Broadcast audience or topic does not match the saved TLB Newsletter settings. Sending was stopped.'});
      return 'needs_review';
    }
    if(['queued','scheduled','sent','canceled'].includes(current.status)){
      await service('accepted',{...lease,provider_status:current.status});
      return current.status;
    }
    if(current.status!=='draft'||job.send_started_at){
      await service('failed',{...lease,terminal:true,error:'Broadcast delivery is unconfirmed. Inspect this Broadcast in Resend before taking further action; automatic resending is disabled to prevent duplicate emails.'});
      return 'needs_review';
    }
    const begin=await service('begin_send',lease);
    if(begin?.deferred)return 'deferred';
    const sent=await provider(`/${id}/send`,{});
    if(sent?.id!==id)throw new Error('Broadcast send acknowledgement missing');
    await service('accepted',{...lease,provider_status:'queued'});
    return 'queued';
  }catch(error){
    // A later lease reads provider status before deciding anything about sending.
    try{await service('failed',{...lease,error:error instanceof HttpError?error.message:'Broadcast delivery is unconfirmed. The next check will reconcile its saved Resend ID before proceeding.'});}catch{/* Lease expiry recovers safely. */}
    return 'pending';
  }
}
