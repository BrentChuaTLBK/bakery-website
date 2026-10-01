// Shared by browser preparation and Edge upload validation. Inspect bytes, never
// trust a filename or the browser-provided MIME type. No decoding or side effects.
export const ORIGINAL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic'];
export const imageExtension = mime => ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/heic':'heic','image/heif':'heic'})[mime];

export function inspectImage(bytes, {maxBytes = 25 * 1024 * 1024} = {}) {
  const fail = () => { throw Error('Choose a valid PNG, JPEG, WebP, or HEIC image. Renaming another file does not make it an image.'); };
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maxBytes) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (a,b) => String.fromCharCode(...bytes.subarray(a,b));
  const result = (mime,width,height) => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 60_000_000) fail();
    return {mime,extension:imageExtension(mime),width,height};
  };
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && text(12,16)==='IHDR' && view.getUint32(8)===13) {
    let offset=8, pixels=false;
    while(offset+12<=bytes.length) {
      const size=view.getUint32(offset),kind=text(offset+4,offset+8);
      if(offset+12+size>bytes.length) fail();
      if(kind==='IDAT'&&size>0) pixels=true;
      offset+=12+size;
      if(kind==='IEND') { if(size!==0||!pixels||offset!==bytes.length)fail(); return result('image/png',view.getUint32(16),view.getUint32(20)); }
    }
    fail();
  }
  if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217) {
    let offset=2,width=0,height=0;
    while(offset+4<=bytes.length) {
      if(bytes[offset]!==255) fail();
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++],size=(bytes[offset]<<8)|bytes[offset+1];
      if(size<2||offset+size>bytes.length-2)fail();
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if(size<8)fail(); height=view.getUint16(offset+3);width=view.getUint16(offset+5);
      }
      if(marker===218&&offset+size<bytes.length-2)return result('image/jpeg',width,height);
      offset+=size;
    }
    fail();
  }
  if(bytes.length>=20&&text(0,4)==='RIFF'&&text(8,12)==='WEBP') {
    if(view.getUint32(4,true)+8!==bytes.length)fail();
    let offset=12,width=0,height=0,pixels=false;
    while(offset+8<=bytes.length) {
      const kind=text(offset,offset+4),size=view.getUint32(offset+4,true),start=offset+8,end=start+size;
      if(end>bytes.length)fail();
      if(kind==='VP8 '){if(size<10||bytes[start+3]!==157||bytes[start+4]!==1||bytes[start+5]!==42)fail();width=view.getUint16(start+6,true)&0x3fff;height=view.getUint16(start+8,true)&0x3fff;pixels=true;}
      if(kind==='VP8L'){if(size<5||bytes[start]!==47)fail();const n=view.getUint32(start+1,true);width=(n&0x3fff)+1;height=((n>>>14)&0x3fff)+1;pixels=true;}
      if(kind==='VP8X'){if(size!==10)fail();width=1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16);height=1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16);}
      if(kind==='ANMF'&&size>16)pixels=true;
      offset=end+(size%2);
    }
    if(offset!==bytes.length||!pixels)fail();return result('image/webp',width,height);
  }
  if(bytes.length>=32&&text(4,8)==='ftyp') {
    let count=0;
    const boxes=(start,end)=>{
      const list=[];let offset=start;
      while(offset<end){
        if(++count>20000||offset+8>end)fail();
        let size=view.getUint32(offset),header=8;
        if(size===1){if(offset+16>end)fail();const wide=view.getBigUint64(offset+8);if(wide>BigInt(Number.MAX_SAFE_INTEGER))fail();size=Number(wide);header=16;}
        if(size===0)size=end-offset;
        if(size<header||offset+size>end)fail();
        list.push({kind:text(offset+4,offset+8),start:offset+header,end:offset+size});offset+=size;
      }return list;
    };
    const top=boxes(0,bytes.length),ftyp=top[0],brands=[];
    if(ftyp.end-ftyp.start<8||(ftyp.end-ftyp.start)%4)fail();
    brands.push(text(ftyp.start,ftyp.start+4));
    for(let p=ftyp.start+8;p<ftyp.end;p+=4)brands.push(text(p,p+4));
    if(!brands.some(b=>['heic','heix','hevc','hevx','heim','heis'].includes(b)))fail();
    const meta=top.find(b=>b.kind==='meta');if(!meta||meta.end-meta.start<4)fail();
    const children=boxes(meta.start+4,meta.end),handler=children.find(b=>b.kind==='hdlr');
    if(!handler||handler.end-handler.start<12||text(handler.start+8,handler.start+12)!=='pict')fail();
    if(!['pitm','iloc','iinf','iprp'].every(kind=>children.some(b=>b.kind===kind)))fail();
    if(![...top,...children].some(b=>['mdat','idat'].includes(b.kind)&&b.end-b.start>8))fail();
    const iprp=children.find(b=>b.kind==='iprp'),properties=boxes(iprp.start,iprp.end),ipco=properties.find(b=>b.kind==='ipco');
    if(!ipco)fail();const entries=boxes(ipco.start,ipco.end);
    if(!entries.some(b=>b.kind==='hvcC'&&b.end-b.start>=23))fail();
    const dimensions=entries.filter(b=>b.kind==='ispe'&&b.end-b.start===12).map(b=>({width:view.getUint32(b.start+4),height:view.getUint32(b.start+8)}));
    if(!dimensions.length)fail();
    // HEIC grids can include tile and auxiliary dimensions; the largest spatial
    // extent is a stable conservative bound even when native decoding is absent.
    dimensions.sort((a,b)=>b.width*b.height-a.width*a.height);
    return result('image/heic',dimensions[0].width,dimensions[0].height);
  }
  fail();
}
