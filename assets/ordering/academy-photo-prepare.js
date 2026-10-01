import {prepareGalleryImage} from './gallery-image.js?v=heic-2';
import {inspectOriginalPhoto,originalPhotoLimit} from './academy-photo-format.js?v=academy-original-1';

export async function prepareAcademyPhoto(source,{allowOriginal=false}={}){
 if(!(source instanceof File)||!source.size)throw new Error('Choose a photo to upload.');
 if(source.size>originalPhotoLimit)throw new Error('Choose a photo up to 25 MB.');
 if(!/\.(jpe?g|png|webp|heic|heif)$/i.test(source.name)&&!/^image\/(jpeg|png|webp|heic|heif)$/.test(source.type))throw new Error('Choose a JPEG, PNG, WebP or HEIC photo.');
 try{return {...await prepareGalleryImage(source),original:false};}
 catch(error){
  if(!allowOriginal)throw error;
  const inspected=inspectOriginalPhoto(new Uint8Array(await source.arrayBuffer()));
  // File construction changes only its label; the original bytes are preserved.
  const file=new File([source],`${source.name.replace(/\.[^.]+$/,'')||'photo'}.${inspected.extension}`,{type:inspected.mime_type,lastModified:source.lastModified});
  return {...inspected,file,original:true};
 }
}
