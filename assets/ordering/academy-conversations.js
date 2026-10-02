import {academyErrorMessage} from './academy-errors.js?v=academy-audit-1';
const inboxMemory=new Map();let memoryGeneration=0;
export function clearConversationMemory(actorId){
 memoryGeneration++;
 for(const key of inboxMemory.keys())if(!actorId||key.startsWith(actorId+':'))inboxMemory.delete(key);
}
export const conversationTime=(value,esc)=>value?`<time datetime="${esc(value)}" title="${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'}).format(new Date(value)))}">${esc(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)))}</time>`:'';

export async function mountConversationList(ui,{admin=false,classes=[],actorId='',attentionMarkup=''}={}){
 const {api,root,draw,heading,select,empty,esc,registerCleanup}=ui;
 const mountedGeneration=memoryGeneration;
 const memoryKey=actorId?actorId+':'+(admin?'admin':'student'):'',prior=memoryKey?inboxMemory.get(memoryKey):null;
 const saved=prior&&Date.now()-prior.at<30*60*1000?prior:null;
 let state={filter:admin?'needs_reply':'all',class_id:'',query:'',...saved?.state},ticket=0,disposed=false;
 if(state.class_id&&!classes.some(c=>c.id===state.class_id))state.class_id='';
 const initial=await api('thread_page',state);let rows=initial.threads,cursor=initial.next_cursor;
 // Refresh authorized pages instead of keeping private conversation previews in
 // memory. Restore enough rows to make returning from a thread useful.
 let restoredPages=1;
 while(saved&&rows.length<Math.min(saved.loaded,120)&&cursor&&restoredPages<5){const page=await api('thread_page',{...state,cursor});const seen=new Set(rows.map(r=>r.id));rows.push(...page.threads.filter(r=>!seen.has(r.id)));cursor=page.next_cursor;restoredPages++;}
 const rowMarkup=t=>`<a class="ap-thread-row" href="#thread/${t.id}"><div><strong>${esc(t.subject)}</strong><p class="ap-small">${admin?esc(t.account_name)+' · ':''}${esc(t.class_name)}${!admin?' · '+esc(t.instructor||'Your instructor'):''}</p>${t.recipe_title||t.module_name?`<p class="ap-small ap-muted">${[t.module_name,t.recipe_title].filter(Boolean).map(esc).join(' · ')}</p>`:''}<p class="ap-message-preview">${esc(t.last_message_preview)}</p></div><span class="ap-small ap-thread-meta">${admin?(t.needs_reply?'Needs reply':t.resolved?'Resolved':'Replied'):(t.resolved?'Resolved':'Open')}${t.unread?` · <strong>${t.unread} ${admin?'unread':'new'}</strong>`:''}${conversationTime(t.last_activity,esc)}</span></a>`;
 draw(`${heading(admin?'Instructor Inbox':'Your conversations',admin?'Private questions and conversations for your classes.':'Questions, baking tips, and replies from your instructors.')}${attentionMarkup}<div class="ap-inbox-controls">${admin?`<div class="ap-inbox-tabs" role="group" aria-label="Conversation status">${[['needs_reply','Needs reply'],['all','All'],['resolved','Resolved']].map(([value,label])=>`<button type="button" class="ap-button ${value===state.filter?'':'secondary'}" data-inbox-filter="${value}" aria-pressed="${value===state.filter}">${label}</button>`).join('')}</div>`:''}${select('Class','inbox_class',[['','All your classes'],...classes.map(c=>[c.id,c.name])],state.class_id)}</div><form class="ap-conversation-search ap-search-tools"><label>${admin?'Search student or subject':'Search conversations'}<input name="conversation_query" type="search" maxlength="160" value="${esc(state.query)}" placeholder="${admin?'Student name or subject':'Subject or your name'}"></label><div class="ap-actions"><button class="ap-button secondary" type="submit">Search</button><button class="ap-button secondary" type="button" data-conversation-clear>Clear</button></div></form><p class="ap-small" data-inbox-status role="status"></p><div class="ap-thread-list" id="ap-inbox-list"></div><div class="ap-actions"><button type="button" class="ap-button secondary" data-load-threads>Load older conversations</button></div>`);
 const host=root.querySelector('#ap-inbox-list'),status=root.querySelector('[data-inbox-status]'),search=root.querySelector('.ap-conversation-search'),classPicker=root.querySelector('[name=inbox_class]'),older=root.querySelector('[data-load-threads]');
 registerCleanup(()=>{disposed=true;ticket++;if(memoryKey&&mountedGeneration===memoryGeneration)inboxMemory.set(memoryKey,{state:{...state},loaded:rows.length,scrollY:window.scrollY,at:Date.now()});});
 const controls=()=>{classPicker.value=state.class_id;search.elements.conversation_query.value=state.query;root.querySelectorAll('[data-inbox-filter]').forEach(b=>{const selected=b.dataset.inboxFilter===state.filter;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('secondary',!selected);});};
 const render=()=>{
  host.innerHTML=rows.map(rowMarkup).join('')||empty(state.query?'No matching conversations.':admin&&state.filter==='needs_reply'?'No conversations need a reply.':admin&&state.filter==='resolved'?'No resolved conversations.':admin?'Your inbox is clear.':'No conversations yet.',state.query?'Try another student name or subject.':admin?'':'Open one of your classes to ask your instructor a question.');
  status.textContent=`${rows.length} ${rows.length===1?'conversation':'conversations'} shown${cursor?' · older conversations available':''}`;older.hidden=!cursor;controls();
 };
 const load=async(next,append=false)=>{
  const current=++ticket;host.setAttribute('aria-busy','true');older.disabled=true;status.textContent='Loading conversations…';
  try{
   const page=await api('thread_page',{...next,...(append?{cursor}:{})});if(disposed||current!==ticket)return;
   const ids=new Set(append?rows.map(t=>t.id):[]);rows=append?[...rows,...page.threads.filter(t=>!ids.has(t.id))]:page.threads;cursor=page.next_cursor;state=next;render();
  }catch(error){if(disposed||current!==ticket)return;controls();status.textContent=academyErrorMessage(error);status.setAttribute('role','alert');}
  finally{if(!disposed&&current===ticket){host.setAttribute('aria-busy','false');older.disabled=false;}}
 };
 const change=next=>{status.setAttribute('role','status');return load(next);};
 search.onsubmit=event=>{event.preventDefault();change({...state,query:search.elements.conversation_query.value.trim()});};
 root.querySelector('[data-conversation-clear]').onclick=()=>{change({...state,query:''});search.elements.conversation_query.focus();};
 classPicker.onchange=()=>change({...state,class_id:classPicker.value,query:search.elements.conversation_query.value.trim()});root.querySelectorAll('[data-inbox-filter]').forEach(b=>b.onclick=()=>change({...state,class_id:classPicker.value,query:search.elements.conversation_query.value.trim(),filter:b.dataset.inboxFilter}));
 older.onclick=()=>load({...state},true);render();
 if(saved)requestAnimationFrame(()=>{if(!disposed&&host.isConnected)window.scrollTo({top:saved.scrollY,left:0,behavior:'instant'});});
}
