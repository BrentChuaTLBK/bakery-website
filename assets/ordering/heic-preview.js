// Display retained HEIC originals on browsers without native HEIC support. The
// preview stays in memory; the original upload is never replaced or made public.
const pending = new WeakMap(), previews = new Map();
let queue = Promise.resolve();
if (typeof document !== 'undefined') {
  document.addEventListener('error', event => {
    const img=event.target;
    if(!(img instanceof HTMLImageElement))return;
    const source=img.currentSrc||img.src;
    if(!source||pending.get(img)===source||(!source.startsWith('blob:')&&!/\.hei[cf](?:[?#]|$)/i.test(source)))return;
    pending.set(img,source);
    queue=queue.then(async()=>{
      if(!img.isConnected||(img.currentSrc||img.src)!==source)return;
      let bitmap,canvas;
      try{
        const response=await fetch(source,{credentials:'omit',signal:AbortSignal.timeout(30000)});
        if(!response.ok||Number(response.headers.get('content-length'))>25*1024*1024)return;
        const blob=await response.blob();
        if(blob.size>25*1024*1024||(!/image\/hei[cf]/i.test(blob.type)&&! /\.hei[cf](?:[?#]|$)/i.test(source)))return;
        const {heicTo}=await import('./vendor/heic-to-1.5.2/heic-to.js');
        bitmap=await heicTo({blob,type:'bitmap'});
        if(!img.isConnected||(img.currentSrc||img.src)!==source)return;
        const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
        canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        const preview=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!preview||!img.isConnected||(img.currentSrc||img.src)!==source)return;
        const url=URL.createObjectURL(preview);if(previews.has(img))URL.revokeObjectURL(previews.get(img));previews.set(img,url);pending.set(img,url);img.src=url;
      }catch{/* The original remains available even if this device cannot preview it. */}
      finally{bitmap?.close?.();if(canvas){canvas.width=1;canvas.height=1;}}
    });
  },true);
  new MutationObserver(()=>{for(const [img,url] of previews)if(!img.isConnected||img.src!==url){URL.revokeObjectURL(url);previews.delete(img);}}).observe(document,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>{for(const url of previews.values())URL.revokeObjectURL(url);previews.clear();});
}
