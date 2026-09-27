import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const tests=(await readdir(join(root,'tests'))).filter(name=>name.endsWith('.test.mjs')).sort();
if(!tests.length)throw Error('No unit tests found');
const result=spawnSync(process.execPath,['--test',...tests.map(name=>join(root,'tests',name))],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status??1;
