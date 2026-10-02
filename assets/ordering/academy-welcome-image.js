import {config} from './config.js';
export const academyWelcomeDefaultPhoto='/assets/pastries/CookieBottle/IMG_4116.webp';
export const academyWelcomeDefaultAlt='Freshly baked cookies from TLB Kitchen';
export function academyWelcomeImageURL(path){
 // Only the dedicated public bucket is addressable here. Private Academy
 // media must keep its authenticated, permission-checked download path.
 if(typeof path!=='string'||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.webp$/.test(path))return '';
 return `${config.supabaseUrl.replace(/\/$/,'')}/storage/v1/object/public/academy-welcome/${path.split('/').map(encodeURIComponent).join('/')}`;
}
