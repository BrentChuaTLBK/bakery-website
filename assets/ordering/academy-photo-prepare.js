import {prepareGalleryImage} from './gallery-image.js?v=approved-20261002-1';

export async function prepareAcademyPhoto(source,options={}){
 const prepared=await prepareGalleryImage(source,options);
 return {...prepared,original:!prepared.converted};
}
