import {academyApi,academyUpload,academySignedUrls} from './client.js?v=academy-1';
import {prepareGalleryImage,galleryImageAccept} from './gallery-image.js?v=heic-2';
import {assetIds} from './academy-model.js';
export {academyApi,galleryImageAccept};
export async function academyImages(content){
 const ids=assetIds(content),map={};
 for(let i=0;i<ids.length;i+=500){const assets=await academyApi('assets',{ids:ids.slice(i,i+500)});if(!assets.length)continue;const urls=await academySignedUrls(assets.map(a=>a.storage_path));for(let j=0;j<assets.length;j++)map[assets[j].id]={...assets[j],url:urls[j]?.signedUrl||''};}
 return map;
}
export async function uploadAcademyPhoto(file,onProgress=()=>{}){
 onProgress('Converting to WebP…');const prepared=await prepareGalleryImage(file),id=crypto.randomUUID();
 onProgress('Uploading…');await academyUpload(prepared.file,id);
 onProgress('Saving image…');const asset=await academyApi('register_asset',{id,name:file.name,width:prepared.width,height:prepared.height});
 const urls=await academySignedUrls([asset.storage_path]);return {...asset,url:urls[0]?.signedUrl||''};
}

const imageRefreshBindings=new WeakMap();
// A long upload/editor session can outlast a private photo's five-minute URL.
// Recover failed images in small batches, without replacing the editor or draft.
export function bindAcademyImageRefresh(root,getImages){
 if(imageRefreshBindings.has(root))return imageRefreshBindings.get(root);
 const queued=new Set(),retriedAt=new Map();let timer=null,running=false,disposed=false;
 async function flush(){
  timer=null;if(running||disposed)return;
  if(!root.isConnected){queued.clear();return;}
  const ids=[...queued].slice(0,100);if(!ids.length)return;
  ids.forEach(id=>queued.delete(id));running=true;
  try{
   const fresh=await academyImages(ids.map(asset_id=>({asset_id})));
   if(disposed||!root.isConnected)return;
   Object.assign(getImages(),fresh);
   for(const img of root.querySelectorAll('img[data-academy-asset]')){
    const image=fresh[img.dataset.academyAsset];
    if(image?.url&&img.getAttribute('src')!==image.url)img.src=image.url;
   }
  }catch{/* Keep photo captions and the unsaved draft intact while offline. */}
  finally{running=false;if(queued.size&&!disposed)timer=setTimeout(flush,50);}
 }
 function failed(event){
  const img=event.target,id=img?.dataset?.academyAsset;
  if(img?.tagName!=='IMG'||!id||!root.contains(img))return;
  const now=Date.now(),last=retriedAt.get(id);
  if(last!==undefined&&now-last<60000)return;
  retriedAt.set(id,now);queued.add(id);
  if(timer===null&&!running)timer=setTimeout(flush,50);
 }
 root.addEventListener('error',failed,true);
 const dispose=()=>{disposed=true;if(timer!==null)clearTimeout(timer);queued.clear();root.removeEventListener('error',failed,true);imageRefreshBindings.delete(root);};
 imageRefreshBindings.set(root,dispose);return dispose;
}
