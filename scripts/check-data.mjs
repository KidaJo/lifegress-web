// Validates a local lifegress-hq checkout with the same rules the app uses before every save.
// Usage: node scripts/check-data.mjs <path-to-lifegress-hq>
import {readFile,readdir} from 'node:fs/promises';
import {join,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decode,normalize,validate,eventContributor} from '../data-v1.mjs';

// V1 record files (DATA_MODEL_V1 section 6): the two catalogs, the crew registry, plus every Markdown file under these folders.
// Docs, legacy locators and notes elsewhere (including archive/README.md) are not records.
const dataRoots=['sections','standalone','archive/sections','archive/projects'];
export const isDataPath=path=>path==='index.md'||path==='archive/index.md'||path==='crew.md'||dataRoots.some(root=>path.startsWith(root+'/'))&&path.endsWith('.md');

async function walk(dir){const out=[];let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return out;throw e;}
 for(const e of entries){const p=join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}

export async function loadData(dir){
 dir=resolve(dir);const files={},errors=[];
 const paths=[join(dir,'index.md'),join(dir,'archive/index.md'),join(dir,'crew.md'),...(await Promise.all(dataRoots.map(r=>walk(join(dir,r))))).flat()];
 for(const p of paths){const path=relative(dir,p).split(sep).join('/');if(!isDataPath(path))continue;
  let text;try{text=await readFile(p,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;if(path==='index.md')errors.push('index.md: missing');continue;}
  try{decode(text);files[path]=text;}catch(e){errors.push(`${path}: ${e.message}`);}}
 return {dir,files,errors};
}

// Contributors are derived data: each record's list must equal, in order, the people in its History (derived completion excluded).
export function expectedContributors(model){
 const events=Object.entries(model.files).filter(([p])=>p.includes('/history/')).flatMap(([,t])=>decode(t).events||[]).sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at));
 const out={};for(const ev of events){if(ev.event_type==='derived-completion'||!model.entities[ev.entity_id])continue;const id=eventContributor(model,ev);if(!id)continue;const list=out[ev.entity_id]??=[];if(!list.includes(id))list.push(id);}
 return out;
}
function contributorErrors(model){const expected=expectedContributors(model),errors=[];
 for(const e of Object.values(model.entities)){if(e.contributors==null)continue;const want=expected[e.id]||[];if(JSON.stringify(want)!==JSON.stringify(e.contributors))errors.push(`${e.id}: contributors ${JSON.stringify(e.contributors)} do not match History ${JSON.stringify(want)}`);}
 return errors;}

export async function checkData(dir){
 const {files,errors}=await loadData(dir);
 let model=null;
 if(!errors.length){try{model=normalize(files);validate(model);errors.push(...contributorErrors(model));}catch(e){errors.push(e.message);}}
 return {ok:!errors.length,errors,files:Object.keys(files).length,entities:model?Object.keys(model.entities).length:0};
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const dir=process.argv[2];
 if(!dir){console.error('Usage: node scripts/check-data.mjs <path-to-lifegress-hq>');process.exit(2);}
 const result=await checkData(dir);
 if(result.ok)console.log(`Lifegress data check passed: ${result.files} files, ${result.entities} records.`);
 else{console.error('Lifegress data check failed:');for(const e of result.errors)console.error('- '+e);process.exit(1);}
}
