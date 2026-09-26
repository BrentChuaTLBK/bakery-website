export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clone=value=>structuredClone(value);
export const uid=()=>crypto.randomUUID();
export const slugify=value=>String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100);
export function instagramUrl(value){
 let url;try{url=new URL(value);}catch{throw Error('Paste an Instagram Reel or post link.');}
 if(url.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(url.hostname)||url.username||url.password||url.port||!/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))throw Error('Use an Instagram Reel or post URL, not embed HTML.');
 return 'https://www.instagram.com/'+url.pathname.split('/').filter(Boolean).join('/')+'/';
}
export function enquiryUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function classLink(content,preview=false){return 'academy.html?class='+encodeURIComponent(content.slug)+(preview?'&preview=1':'');}
export function assetIds(value){const ids=new Set();function visit(v){if(!v||typeof v!=='object')return;if(v.asset_id)ids.add(v.asset_id);for(const item of Object.values(v))visit(item);}visit(value);return [...ids];}
export function emptyClass(title='New class'){return {title,slug:slugify(title),category_label:'',short_description:'',description:'',module_description:'',instructor:'',location:'',age_group:'',duration:'',date_text:'',achievement:'',student_total:null,allow_photo_placeholders:false,thumbnail:null,hero:null,creations:[],batches:[],videos:[]};}
export function photoRef(asset_id){return {id:uid(),asset_id,caption:'',alt:'',focal_x:50,focal_y:50,batch_id:'',kind:'activity'};}
export function moveItem(items,from,to){if(from<0||to<0||from>=items.length||to>=items.length)return;items.splice(to,0,items.splice(from,1)[0]);}
export function orderedClasses(classes,settings){const ranks=new Map((settings.class_order||[]).map((id,i)=>[id,i]));return classes.slice().sort((a,b)=>(ranks.get(a.id)??1e6)-(ranks.get(b.id)??1e6)||a.content.title.localeCompare(b.content.title));}
export function missingContent(c){return [!c.thumbnail&&'Thumbnail photo',!c.hero&&'Hero photo',!c.description&&'Class introduction',!c.creations.length&&'Student creations and photos',c.creations.some(x=>!x.photos.length)&&'Photos for some creations',!c.module_description&&'Recipes / module details',!c.batches.length&&'Batch labels, dates and activity albums',c.batches.some(b=>!b.photos.length)&&'Activity photos for some batches',c.batches.some(b=>!b.cover&&!b.photos.length)&&'Covers for some albums',!c.videos.length&&'Instagram videos (optional)'].filter(Boolean);}
export function plain(value){return esc(value).replace(/\n/g,'<br>');}
export function dateLabel(value){if(!value)return '';const date=new Date(value+'T12:00:00Z');return Number.isNaN(date.getTime())?'':date.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});}
