// Shared browser/Edge inspection for unconverted student originals. Inspect the
// bytes, not the supplied filename or MIME type. No image decoder is required.
export const originalPhotoLimit=25*1024*1024;
export function inspectOriginalPhoto(bytes){
 const invalid=()=>{throw new Error('Choose a valid PNG, JPEG or HEIC photo.');};
 if(!bytes?.length||bytes.length>originalPhotoLimit)throw new Error('Choose a photo up to 25 MB.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(a,b)=>new TextDecoder().decode(bytes.subarray(a,b));
 const dimensions=(width,height,mime_type,extension)=>{
  if(width<1||height<1||width>16384||height>16384||width*height>60_000_000)throw new Error('Choose a photo under 60 megapixels, with each side up to 16,384 pixels.');
  return {width,height,mime_type,extension};
 };
 if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
  if(view.getUint32(8)!==13||text(12,16)!=='IHDR')invalid();
  const result=dimensions(view.getUint32(16),view.getUint32(20),'image/png','png');
  let offset=8,pixels=false;
  while(offset+12<=bytes.length){
   const size=view.getUint32(offset),kind=text(offset+4,offset+8),end=offset+size+12;if(end>bytes.length)invalid();
   if(kind==='IDAT'&&size>0)pixels=true;
   if(kind==='IEND'){if(size!==0||!pixels||end!==bytes.length)invalid();return result;}
   offset=end;
  }
  invalid();
 }
 if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217){
  let offset=2,result;
  while(offset+4<=bytes.length){
   if(bytes[offset++]!==255)invalid();while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];if(marker===0||marker===217)invalid();
   const size=view.getUint16(offset);if(size<2||offset+size>bytes.length-2)invalid();
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    if(size<8)invalid();result=dimensions(view.getUint16(offset+5),view.getUint16(offset+3),'image/jpeg','jpg');
   }
   if(marker===0xda){if(!result||offset+size>=bytes.length-2)invalid();return result;}
   offset+=size;
  }
  invalid();
 }
 // HEIC uses an ISO BMFF container. Require HEVC brands, image properties and
 // pixel data; reject other containers and truncated or oversized boxes.
 if(bytes.length>=32&&text(4,8)==='ftyp'){
  let boxes=0;
  const walk=(start,end,visit)=>{
   for(let offset=start;offset<end;){
    if(offset+8>end||++boxes>4096)invalid();
    let size=view.getUint32(offset),header=8;
    if(size===1){if(offset+16>end)invalid();const n=view.getBigUint64(offset+8);if(n>BigInt(end-offset))invalid();size=Number(n);header=16;}
    else if(size===0)size=end-offset;
    if(size<header||offset+size>end)invalid();visit(text(offset+4,offset+8),offset+header,offset+size);offset+=size;
   }
  };
  let branded=false,meta=false,pixels=false,config=false,width=0,height=0,primary=false,locations=false,items=false;
  walk(0,bytes.length,(kind,start,end)=>{
   if(kind==='ftyp'){
    if(end-start<8||(end-start)%4)invalid();const brands=[text(start,start+4)];for(let p=start+8;p<end;p+=4)brands.push(text(p,p+4));
    if(brands.some(b=>['avif','avis'].includes(b))||!brands.some(b=>['heic','heix'].includes(b)))invalid();branded=true;
   }else if(kind==='mdat')pixels ||= end>start;
   else if(kind==='meta'){
    if(end-start<4)invalid();meta=true;
    walk(start+4,end,(child,a,b)=>{
     if(child==='pitm')primary ||= b-a>=6;
     if(child==='iloc')locations ||= b-a>=8;
     if(child==='iinf')items ||= b-a>=6;
     if(child==='idat')pixels ||= b>a;
     if(child==='iprp')walk(a,b,(property,c,d)=>{
      if(property==='ipco')walk(c,d,(entry,e,f)=>{
       if(entry==='hvcC')config ||= f-e>=23;
       if(entry==='ispe'){if(f-e!==12)invalid();const w=view.getUint32(e+4),h=view.getUint32(e+8);dimensions(w,h,'image/heic','heic');if(w*h>width*height){width=w;height=h;}}
      });
     });
    });
   }
  });
  if(branded&&meta&&pixels&&config&&primary&&locations&&items&&width&&height)return dimensions(width,height,'image/heic','heic');
 }
 invalid();
}
