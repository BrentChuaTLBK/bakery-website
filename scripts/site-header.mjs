import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,relative,dirname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
const template=(await readFile(join(root,'assets/partials/site-header.html'),'utf8')).trim();
const start='<!-- tlb-site-header:start -->',end='<!-- tlb-site-header:end -->';
const assetStart='<!-- tlb-site-header-assets:start -->',assetEnd='<!-- tlb-site-header-assets:end -->';
export function renderSiteHeader(html,filename){
 const prefix=relative(dirname(filename),'.').split(sep).join('/'),base=prefix?prefix+'/':'';
 const eol=html.includes('\r\n')?'\r\n':'\n';
 const nav=[start,template.replaceAll('__ROOT__',base),end].join('\n').replaceAll('\n',eol);
 const assets=[assetStart,`<link rel="stylesheet" href="${base}assets/ordering/site-header.css?v=shared-20261002-1">`,`<script defer src="${base}assets/ordering/site-header.js?v=shared-20261002-1"></script>`,assetEnd].join(eol);
 if(!html.includes(start)||!html.includes(assetStart))throw Error('Missing shared header markers in '+filename);
 return html.replace(new RegExp(start+'[\\s\\S]*?'+end),nav).replace(new RegExp(assetStart+'[\\s\\S]*?'+assetEnd),assets);
}
export async function syncSiteHeaders(target=root,{check=false}={}){
 async function pages(dir){const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isFile()&&entry.name.endsWith('.html'))files.push(join(dir,entry.name));else if(entry.isDirectory()&&(dir!==target||entry.name==='academy'))files.push(...await pages(join(dir,entry.name)));}return files;}
 const changed=[],files=await pages(target);
 for(const file of files){const html=await readFile(file,'utf8'),next=renderSiteHeader(html,relative(target,file));if(html!==next){changed.push(relative(target,file));if(!check)await writeFile(file,next);}}
 if(check&&changed.length)throw Error('Run node scripts/site-header.mjs to update: '+changed.join(', '));
 return {pages:files.length,changed};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(await syncSiteHeaders(root,{check:process.argv.includes('--check')}));
