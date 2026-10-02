// Reservations are immutable and stay tied to the same File and draft context.
// A retry updates the existing preview/progress row rather than adding a new one.
export function createPhotoUploader({api,preparePhoto,upload,esc,errorMessage}){
 const reservations=new WeakMap(),rows=new WeakMap();
 return async function uploadPhotos(files,context,container){
  if(files.length>8)throw Error('Choose up to eight photos.');
  const form=container.closest('form'),inTray=Boolean(form?.querySelector('.ap-photo-tray'));
  const current=()=>{if(!container.isConnected||(form&&!form.isConnected))throw Object.assign(new Error(''),{code:'ACADEMY_STALE'});};
  const records=[],contextKey=JSON.stringify(context);
  let items=rows.get(container);if(!items){items=new WeakMap();rows.set(container,items);}
  for(const source of files){
   current();let item;
   if(!inTray){
    item=items.get(source);
    if(!item?.isConnected){item=document.createElement('div');item.className='ap-upload-item';item.innerHTML=`<strong>${esc(source.name)}</strong><progress max="100" value="0" aria-label="Upload progress for ${esc(source.name)}"></progress><span role="status"></span>`;container.append(item);items.set(source,item);}
   }
   const status=(state,progress,message)=>{
    if(form?.isConnected)form.dispatchEvent(new CustomEvent('academy:photo-upload',{detail:{file:source,state,progress,message}}));
    if(item?.isConnected){item.querySelector('progress').value=progress;item.querySelector('span').textContent=message;item.classList.toggle('has-error',state==='error');}
   };
   status('preparing',0,'Preparing photo…');
   try{
    let saved=reservations.get(source);if(saved?.context!==contextKey)saved=null;
    if(!saved){
     const prepared=await preparePhoto(source,context.purpose!=='welcome');current();
     const {file,width,height,original}=prepared;
     if(context.purpose==='welcome'&&(file.type!=='image/webp'||original))throw Error('This public picture could not be prepared. Choose a JPG or PNG photo and try again.');
     saved={file,width,height,reservation:null,requestKey:crypto.randomUUID(),original,context:contextKey,completed:false};reservations.set(source,saved);
    }
    if(!saved.reservation){saved.reservation=await api('reserve_media',{...context,size_bytes:saved.file.size,width:saved.width,height:saved.height,mime_type:saved.file.type,idempotency_key:saved.requestKey});current();}
    if(!saved.completed){await upload(saved.reservation.id,saved.file,n=>status('uploading',n,`Uploading ${n}%`));saved.completed=true;}
    current();status('ready',100,saved.original?'Original photo ready':'Photo ready');records.push(saved.reservation);
   }catch(error){
    if(error.code==='ACADEMY_STALE')throw error;
    const message=errorMessage(error);status('error',0,`Upload paused. ${message}`);
    const submit=form?.querySelector('button[type=submit]');if(submit)submit.textContent=['submission','message'].includes(context.purpose)?'Retry upload & send':'Retry photo upload';
    throw Error('A photo could not be uploaded. Retry to continue, or change your photos. '+message);
   }
  }
  return records;
 };
}
