import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';

// Read the actual serialized XML, independently of the library that wrote it.
// Test fixtures use ordinary ZIP (stored/deflated entries), not ZIP64 archives.
export function xlsxParts(bytes){
 const zip=Buffer.from(bytes),end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 assert.ok(end>=0,'XLSX contains a ZIP central directory');
 const count=zip.readUInt16LE(end+10),parts=new Map();let offset=zip.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  assert.equal(zip.readUInt32LE(offset),0x02014b50);
  const method=zip.readUInt16LE(offset+10),size=zip.readUInt32LE(offset+20),nameSize=zip.readUInt16LE(offset+28),extraSize=zip.readUInt16LE(offset+30),commentSize=zip.readUInt16LE(offset+32),local=zip.readUInt32LE(offset+42);
  const name=zip.toString('utf8',offset+46,offset+46+nameSize);
  assert.equal(zip.readUInt32LE(local),0x04034b50);
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),compressed=zip.subarray(start,start+size);
  assert.ok(method===0||method===8,'Supported ZIP compression');
  parts.set(name,(method===0?compressed:inflateRawSync(compressed)).toString('utf8'));
  offset+=46+nameSize+extraSize+commentSize;
 }
 return parts;
}
