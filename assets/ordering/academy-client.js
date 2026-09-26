import {academyApi,academyUpload,academySignedUrls} from './client.js?v=academy-1';
import {prepareGalleryImage,galleryImageAccept} from './gallery-image.js';
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
