import { prepareGalleryImage, galleryImageAccept } from './gallery-image.js?v=heic-2';
import { confirmDialog } from './site-dialog.js?v=branded-dialogs-1';
import { defaultShopFeature, shopFeatureMarkup } from './website-content.js?v=shop-feature-1';
import { esc, validPage } from './homepage-view.js?v=homepage-1';

export function mountHomepage(root, { role, connected, api, upload }) {
  if (!connected || role !== 'owner') { root.textContent = 'The Website content editor is available to the shop owner.'; return; }
  let content, saved, revision, operation, section = 'hero', lastHomeSection = 'hero', selected = 0, busy = false, dirty = false, loaded = false;
  root.innerHTML = `<div class="section-heading"><div><p class="eyebrow">The Little Baker Kitchen</p><h1>Website content</h1><p>Manage photos and captions by page. Choose a section to edit, then save to publish.</p></div><a class="button button-secondary" href="index.html" target="_blank" rel="noopener" data-home-view>View home page ↗</a></div><section class="panel home-editor"><div class="home-editor-pages" role="group" aria-label="Website page"><button class="button button-secondary" type="button" data-home-page="home" aria-pressed="true">Home page</button><button class="button button-secondary" type="button" data-home-page="shop" aria-pressed="false">Shop page</button></div><div class="home-editor-toolbar"><label data-home-section-label>Section<select data-home-section><option value="hero">Main banner</option><option value="custom">Custom Orders</option><option value="pastries">Pastries</option><option value="party">Party Carts &amp; Events</option><option value="academy">Baking Classes</option></select></label><button class="button button-secondary" type="button" data-home-reload>Reload saved version</button></div><p class="muted" data-home-help>Photos rotate every 4 seconds. The first photo opens the slideshow. Add photos, change their order, then save to publish.</p><p role="status" aria-live="polite" data-home-message></p><form data-home-form><div data-home-content></div><div class="home-editor-save row-actions"><button class="button" type="submit" data-home-save disabled>Save website content</button><button class="button button-secondary" type="button" data-home-reset disabled>Discard changes</button><span class="muted" data-home-state></span></div></form></section><datalist id="home-page-links">${['index','customorders','pastries','partycarts','dessertbar','academy','contactus','shop'].map(p=>`<option value="${p}.html">`).join('')}</datalist>`;
  const $ = s => root.querySelector(s);
  const isHero = () => section === 'hero';
  const isShop = () => section === 'shop';
  const card = () => content.specialties.find(s => s.id === section);
  const photos = () => isShop() ? [content.shop_feature] : isHero() ? content.hero : card().photos;
  const message = (text, error = false) => { const el = $('[data-home-message]'); el.textContent = text; el.className = error ? 'notice danger' : text ? 'notice' : ''; };
  function controls() {
    root.dataset.busy = String(busy); root.dataset.dirty = String(dirty);
    root.querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = busy || !loaded; });
    $('[data-home-reload]').disabled = busy;
    $('[data-home-save]').disabled = busy || !dirty;
    $('[data-home-reset]').disabled = busy || !dirty;
    $('[data-home-state]').textContent = dirty ? 'Unsaved changes · Save publishes all edited sections' : loaded ? 'All changes saved' : '';
    root.querySelectorAll('[data-home-move]').forEach(el => { const [i,step]=el.dataset.homeMove.split(',').map(Number); el.disabled = busy || i+step < 0 || i+step >= photos().length; });
    root.querySelectorAll('[data-home-remove]').forEach(el => { el.disabled = busy || photos().length <= 1; });
  }
  function changed() { dirty = true; operation = crypto.randomUUID(); controls(); }
  const field = (name, label, value, max, extra='') => `<label class="field">${label}<input data-home-field="${name}" value="${esc(value)}" maxlength="${max}" ${extra}></label>`;
  function paint() {
    if (!loaded) { controls(); return; }
    $('[data-home-section-label]').hidden=isShop();
    root.querySelectorAll('[data-home-page]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.homePage==='shop')===isShop())));
    const view=$('[data-home-view]');view.href=isShop()?'shop.html':'index.html';view.textContent=isShop()?'View shop page ↗':'View home page ↗';
    $('[data-home-help]').textContent=isShop()?'Edit the feature photo beside the shop introduction. Leave the caption blank to hide it. Save to publish.':'Photos rotate every 4 seconds. The first photo opens the slideshow. Add photos, change their order, then save to publish.';
    if(isShop()){
      const p=content.shop_feature;
      $('[data-home-content]').innerHTML=`<section aria-label="Shop feature image"><div class="section-heading"><h2>Shop feature image</h2><label class="button button-secondary home-upload">Replace photo<input data-home-replace type="file" accept="${galleryImageAccept}" aria-label="Replace shop feature photo"></label></div><p class="help-text">JPG, PNG, WebP, AVIF, GIF, BMP or HEIC · up to 25 MB. Converted to WebP, at most 1600 px.</p><div class="home-detail-layout"><div class="home-shop-feature-preview" data-shop-feature-preview>${shopFeatureMarkup(p)}</div><div class="home-detail-fields">${field('alt','Photo description · for accessibility',p.alt,200)}${field('caption','Photo caption · optional',p.caption,120)}<p class="help-text">This photo belongs to the Shop page. It is separate from the homepage slideshows and product photos.</p></div></div></section>`;
      controls();return;
    }
    selected = Math.max(0,Math.min(selected,photos().length-1));
    const list=photos(), p=list[selected];
    $('[data-home-content]').innerHTML = `${!isHero()?`<div class="form-grid">${field('card.title','Category button text',card().title,60,'required')}${field('card.href','Website page',card().href,300,'required list="home-page-links"')}</div>`:''}<div class="section-heading"><h2>${isHero()?'Banner slides':esc(card().title)} <span class="muted">· ${list.length} photo${list.length===1?'':'s'}</span></h2><label class="button home-upload">Add photos<input data-home-upload type="file" multiple accept="${galleryImageAccept}" aria-label="Add photos"></label></div><p class="help-text">JPG, PNG, WebP, AVIF, GIF, BMP or HEIC · up to 25 MB each. Converted to WebP, at most 1600 px. Up to 50 photos per slideshow.</p><div class="home-photo-grid">${list.map((photo,i)=>`<article class="home-photo ${selected===i?'is-selected':''}"><button class="home-photo-select" type="button" data-home-select="${i}" aria-label="Edit photo ${i+1}" aria-pressed="${selected===i}"><img src="${esc(photo.photo_url)}" alt="${esc(photo.alt||`Photo ${i+1}`)}" loading="lazy"><span>${i+1}${isHero()?` · ${esc(photo.title)}`:''}</span></button><div class="home-photo-actions"><button type="button" class="button button-secondary" data-home-move="${i},-1" aria-label="Move photo ${i+1} earlier">←</button><button type="button" class="button button-secondary" data-home-move="${i},1" aria-label="Move photo ${i+1} later">→</button><button type="button" class="button button-quiet" data-home-remove="${i}" aria-label="Remove photo ${i+1}">Remove</button></div></article>`).join('')}</div><section class="home-photo-details" aria-label="Selected photo"><div class="section-heading"><h3>Photo ${selected+1}${isHero()?' · banner details':''}</h3><label class="button button-secondary home-upload">Replace photo<input data-home-replace type="file" accept="${galleryImageAccept}" aria-label="Replace selected photo"></label></div><div class="home-detail-layout"><div class="home-photo-preview"><img src="${esc(p.photo_url)}" alt="${esc(p.alt)}"><p data-home-preview-title>${esc(isHero()?p.title:card().title)}</p></div><div class="home-detail-fields">${field('alt','Photo description · for accessibility',p.alt,200)}${isHero()?`${field('title','Banner heading',p.title,100,'required')}<label>Short introduction<textarea data-home-field="description" maxlength="400" rows="3">${esc(p.description)}</textarea></label><p class="help-text">Optional buttons · use a website page such as academy.html. Leave a button’s text blank to remove it.</p>${[0,1].map(i=>`<div class="form-grid">${field(`button.${i}.label`,`Button ${i+1} text`,p.buttons[i]?.label||'',40)}${field(`button.${i}.href`,`Button ${i+1} page`,p.buttons[i]?.href||'',300,'list="home-page-links"')}</div>`).join('')}`:''}</div></div></section>`;
    controls();
  }
  root.addEventListener('error', event => {
    if (event.target.tagName !== 'IMG') return;
    event.target.classList.add('home-photo-missing'); event.target.alt='Photo unavailable — replace this image';
  },true);
  function clearValidation() { root.querySelectorAll('input').forEach(el=>el.setCustomValidity('')); }
  async function load() {
    if (busy) return;
    if (dirty && !await confirmDialog('Discard your unsaved website content changes and reload the saved version?',{title:'Reload website content?',confirmLabel:'Discard and reload',cancelLabel:'Keep editing',danger:true})) return;
    if (!root.isConnected || busy) return;
    busy=true; controls(); message('Loading website content…');
    try { const data=await api('admin_get'); if(!root.isConnected)return; content={...data.content,shop_feature:data.content.shop_feature||{...defaultShopFeature}}; revision=data.revision; saved=structuredClone(content); dirty=false; loaded=true; paint(); message(''); }
    catch(error){message(error.message||'The home page editor could not load. Try again.',true);}
    finally{busy=false;controls();}
  }
  root.addEventListener('input',event=>{
    const input=event.target, name=input.dataset.homeField; if(busy||!name)return;
    clearValidation();
    if(name.startsWith('card.')) card()[name.slice(5)]=input.value;
    else if(name.startsWith('button.')) {
      // Read both controls together, retaining incomplete input until Save validates it.
      photos()[selected].buttons=[0,1].map(i=>({label:$(`[data-home-field="button.${i}.label"]`).value,href:$(`[data-home-field="button.${i}.href"]`).value}));
    } else photos()[selected][name]=input.value;
    if(isShop())$('[data-shop-feature-preview]').innerHTML=shopFeatureMarkup(content.shop_feature);
    else $('[data-home-preview-title]').textContent=isHero()?photos()[selected].title:card().title;
    changed();
  });
  root.addEventListener('change',async event=>{
    const input=event.target;if(busy)return;
    if(input.matches('[data-home-section]')){section=input.value;selected=0;paint();message('');return;}
    if(!input.matches('[data-home-upload],[data-home-replace]'))return;
    const files=[...input.files];input.value='';if(!files.length)return;
    const replacing=input.hasAttribute('data-home-replace'), list=photos(),target=selected;
    if(!replacing&&list.length+files.length>50){message('Each slideshow can contain up to 50 photos.',true);return;}
    busy=true;controls();let added=0;const failures=[];
    try{
      for(const [i,file] of files.entries()){
        message(`Converting and uploading photo ${i+1} of ${files.length}…`);
        try{
          const prepared=await prepareGalleryImage(file), result=await upload(prepared.file,{kind:'product'});
          if(!root.isConnected)return;
          if(replacing)list[target].photo_url=result.url;
          else list.push({id:crypto.randomUUID(),photo_url:result.url,alt:'',...(isHero()?{title:'New banner',description:'',buttons:[]}: {})});
          selected=replacing?target:list.length-1;added++;changed();paint();
        }catch(error){failures.push(`${file.name}: ${error.message}`);}
      }
      message(`${added?`${added} photo${added===1?'':'s'} ready. Save website content to publish. `:''}${failures.join(' ')}`,failures.length>0);
    }finally{busy=false;controls();}
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    if(button.hasAttribute('data-home-page')){
      if(!isShop())lastHomeSection=section;
      section=button.dataset.homePage==='shop'?'shop':lastHomeSection;selected=0;$('[data-home-section]').value=lastHomeSection;paint();message('');return;
    }
    if(button.hasAttribute('data-home-reload')){await load();return;}
    if(button.hasAttribute('data-home-select')){selected=Number(button.dataset.homeSelect);paint();return;}
    if(button.hasAttribute('data-home-move')){
      const [i,step]=button.dataset.homeMove.split(',').map(Number),list=photos(),item=list[i];
      if(!item||i+step<0||i+step>=list.length)return;
      list.splice(i,1);list.splice(i+step,0,item);selected=i+step;changed();paint();$(`[data-home-select="${selected}"]`).focus({preventScroll:true});return;
    }
    if(button.hasAttribute('data-home-reset')){
      if(!await confirmDialog('Discard all unsaved website content changes?',{title:'Discard website content changes?',confirmLabel:'Discard changes',cancelLabel:'Keep editing',danger:true})||!root.isConnected||busy)return;
      content=structuredClone(saved);dirty=false;paint();message('Saved version restored.');return;
    }
    if(button.hasAttribute('data-home-remove')){
      const i=Number(button.dataset.homeRemove);if(photos().length<=1)return;
      if(!await confirmDialog(`Remove photo ${i+1} from this slideshow? Save website content to publish the change.`,{title:'Remove photo?',confirmLabel:'Remove photo',cancelLabel:'Keep photo',danger:true})||!root.isConnected||busy)return;
      photos().splice(i,1);selected=Math.min(i,photos().length-1);changed();paint();message('Photo removed from the draft.');
    }
  });
  $('[data-home-form]').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!dirty)return;
    // Validate every section, including edits made before switching slideshows.
    const next=structuredClone(content);
    for(const slide of next.hero)slide.buttons=slide.buttons.filter(b=>b.label.trim());
    for(const [i,slide] of next.hero.entries()){
      if(!slide.title.trim()||slide.buttons.some(b=>!validPage(b.href))){section='hero';selected=i;$('[data-home-section]').value=section;paint();message('Complete the banner heading and use a valid website page for each button.',true);return;}
    }
    for(const s of next.specialties){if(!s.title.trim()||!validPage(s.href)){section=s.id;selected=0;$('[data-home-section]').value=section;paint();message('Complete the category button text and use a valid website page.',true);return;}}
    busy=true;controls();message('Saving website content…');
    try{
      const result=await api('save',{content:next,revision,operation_id:operation});if(!root.isConnected)return;
      content=result.content;revision=result.revision;saved=structuredClone(content);dirty=false;paint();message('Saved. Your website now uses these photos, text and links.');
    }catch(error){message(`${error.message||'The website content could not save.'} Your changes are still here.`,true);}
    finally{busy=false;controls();}
  });
  void load();
}
