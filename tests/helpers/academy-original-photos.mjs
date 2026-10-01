// Synthetic 4 by 3 pixel photos; no camera or personal data.
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWM4OcEZjhhwcgB/FhNRZ1DOWwAAAABJRU5ErkJggg==','base64');
export const jpeg=Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAAIKH/2Q==','base64');
// Structural HEIC fixture only. Real decoder checks use HEIC_TEST_FILE locally.
export function structuralHeic(width=4,height=3){
 const box=(name,...parts)=>{const body=Buffer.concat(parts),head=Buffer.alloc(8);head.writeUInt32BE(body.length+8);head.write(name,4);return Buffer.concat([head,body]);};
 const ispe=Buffer.alloc(12);ispe.writeUInt32BE(width,4);ispe.writeUInt32BE(height,8);
 const handler=Buffer.alloc(12);handler.write('pict',8);
 return Buffer.concat([box('ftyp',Buffer.from('heic'),Buffer.alloc(4),Buffer.from('mif1heic')),box('meta',Buffer.alloc(4),box('hdlr',handler),box('pitm',Buffer.alloc(6)),box('iloc',Buffer.alloc(8)),box('iinf',Buffer.alloc(6)),box('iprp',box('ipco',box('ispe',ispe),box('hvcC',Buffer.alloc(23))))),box('mdat',Buffer.from([1,2,3,4,5,6,7,8,9]))]);
}
