import {prepareGalleryImage} from './gallery-image.js?v=approved-20261002-1';

export async function prepareAcademyPhoto(source){
 const prepared=await prepareGalleryImage(source);
 return {...prepared,original:!prepared.converted};
}
