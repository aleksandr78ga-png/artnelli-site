import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {recordCatalogHistory} from './catalog-history.mjs';
if (!process.argv[2]) throw new Error('Pass an authenticated complete catalogue observation');
const stateFile=fileURLToPath(new URL('../data/telegram-catalog-history.json',import.meta.url));
let previous=null;
try {previous=JSON.parse(await readFile(stateFile,'utf8'))} catch(error) {if(error.code!=='ENOENT')throw error}
const observation=JSON.parse(await readFile(process.argv[2],'utf8'));
const source=await readFile(new URL('../site/catalog-data.js',import.meta.url),'utf8');
const catalog=JSON.parse(source.slice(source.indexOf('=')+1).trim().replace(/;$/,''));
const next=recordCatalogHistory(previous,observation,catalog);
if (!next || next===previous) throw new Error('Incomplete catalogue traversal: no evidence changed');
await writeFile(stateFile,JSON.stringify(next,null,2)+'\n');
console.log(JSON.stringify({checkedAt:next.checkedAt,tracked:next.records.length,
  removed:next.records.filter(p=>p.removed).map(p=>p.id)}));
