import {config} from './config.js';
const button=document.getElementById('unsubscribe'),status=document.getElementById('status');
const token=new URL(location.href).searchParams.get('token');history.replaceState(null,'',location.pathname);
if(!/^[a-f0-9]{64}$/.test(token||'')){button.disabled=true;status.textContent='Please open the preference link in your Academy email.';}
button.onclick=async()=>{button.disabled=true;try{const r=await fetch(config.supabaseUrl+'/rest/v1/rpc/academy_unsubscribe',{method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:token})});if(!r.ok)throw Error();status.textContent='You are unsubscribed from Academy marketing.';}catch{status.textContent='We could not save your preference. Please try again.';button.disabled=false;}};
