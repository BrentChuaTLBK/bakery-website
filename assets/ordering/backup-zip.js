// ZIP "store" format: proof images are already compressed. No runtime dependency.
const utf8=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function backupZip(files,maximum=50*1024*1024){
 const names=new Set(),entries=[];let size=22,offset=0;
 for(const file of files){
  if(!/^[A-Za-z0-9_./-]+$/.test(file.name)||file.name.startsWith('/')||file.name.split('/').some(x=>!x||x==='.'||x==='..')||names.has(file.name))throw Error('Invalid archive filename.');
  names.add(file.name);const name=utf8.encode(file.name),bytes=typeof file.bytes==='string'?utf8.encode(file.bytes):file.bytes;
  if(!(bytes instanceof Uint8Array)||name.length>65535||entries.length>=65535)throw Error('Invalid archive entry.');
  size+=76+2*name.length+bytes.length;if(size>maximum)throw Error('Archive is too large.');
  entries.push({name,bytes,crc:crc32(bytes),offset});offset+=30+name.length+bytes.length;
 }
 const output=new Uint8Array(size),view=new DataView(output.buffer);let pos=0;
 const u16=(at,n)=>view.setUint16(at,n,true),u32=(at,n)=>view.setUint32(at,n,true);
 for(const e of entries){
  u32(pos,0x04034b50);u16(pos+4,20);u16(pos+6,0x800);u16(pos+12,33);u32(pos+14,e.crc);u32(pos+18,e.bytes.length);u32(pos+22,e.bytes.length);u16(pos+26,e.name.length);
  output.set(e.name,pos+30);output.set(e.bytes,pos+30+e.name.length);pos+=30+e.name.length+e.bytes.length;
 }
 const central=pos;
 for(const e of entries){
  u32(pos,0x02014b50);u16(pos+4,20);u16(pos+6,20);u16(pos+8,0x800);u16(pos+14,33);u32(pos+16,e.crc);u32(pos+20,e.bytes.length);u32(pos+24,e.bytes.length);u16(pos+28,e.name.length);u32(pos+42,e.offset);
  output.set(e.name,pos+46);pos+=46+e.name.length;
 }
 u32(pos,0x06054b50);u16(pos+8,entries.length);u16(pos+10,entries.length);u32(pos+12,pos-central);u32(pos+16,central);return output;
}
