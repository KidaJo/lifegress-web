import {readFile,writeFile,mkdir,readdir,cp} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {parseProject,section} from '../model.mjs';
import {encode,normalize,serialize,validate,dateValue,reference} from '../data-v1.mjs';
export async function migrate(source,destination){
 source=resolve(source);destination=resolve(destination);if(source===destination||destination.startsWith(source+'/'))throw Error('Migration requires a separate output directory');
 try{await readdir(destination);throw Error('Destination exists; refuse overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
 const sources={};async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='.git')continue;const p=dir+'/'+e.name;if(e.isDirectory())await walk(p);else if(e.name.endsWith('.md'))sources[relative(source,p)]=await readFile(p,'utf8');}}await walk(source);
 if(sources['index.md'])throw Error('V1 index already exists; inspect instead of migrating twice');
 const registry=sources['README.md'];const paths=[...registry.matchAll(/\]\((projects\/[^)]+\.md)\)/g)].map(m=>m[1]).filter(p=>!p.endsWith('README.md'));const unique=[...new Set(paths)];
 const actual=Object.keys(sources).filter(p=>/^projects\/[^/]+\/[A-Z]+-\d+\.md$/.test(p));if(actual.some(p=>!unique.includes(p)))throw Error('Unindexed project; reconcile before migration');
 const records=unique.map(path=>{if(!sources[path])throw Error('Missing project '+path);return {...parseProject(path,sources[path]),source:sources[path]};});
 const model=normalize({});const sectionNames={work:'Marriott',digital:'Digital Assets',system:'System',apps:'App Development','commercial-photography':'Commercial Photography',business:'Side Income',finance:'Finance',personal:'Personal',career:'Career'};const mapping=[];
 
 for(const p of records){
  const sid='SEC-'+p.category.toUpperCase();if(!model.entities[sid]){model.entities[sid]={id:sid,type:'section',title:sectionNames[p.category]||p.category,parent_id:null,children:[]};model.paths[sid]=`sections/${p.category}/section.md`;model.index.children.push(reference(model,sid));}
  const parent=p.parent.match(/[A-Z]+-\d+/)?.[0]||sid;
  if(p.parent&&!model.entities[parent])throw Error('Parent must precede child in registry: '+p.id);
  const type=p.parent?'stage':'project';const dir=p.parent?dirname(model.paths[parent]):`sections/${p.category}/projects/${p.id}`;
  const field=name=>p.source.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`,'m'))?.[1]||null;
  const legacy={source_path:p.path,source_sha256:createHash('sha256').update(p.source).digest('hex'),metadata:p.source.split('\n## ')[0],objective:section(p.source,'Objective'),summary:p.summary,milestones:p.milestones,next_actions:p.next,blockers:section(p.source,'Dependencies / Blockers'),open_questions:section(p.source,'Open Questions'),references:section(p.source,'References'),task_preamble:section(p.source,'Task Checklist').split('\n').filter(l=>!l.startsWith('- [')).join('\n')};
  const e={id:p.id,type,title:p.name,parent_id:parent,children:[],legacy,confidence:p.confidence,note:''};model.entities[e.id]=e;model.paths[e.id]=dir+(type==='stage'?'/stages.md':'/project.md');model.entities[parent].children.push(reference(model,e.id));
  for(const t of p.tasks){let completed=null;const raw=t.detail.match(/Completed At: ([^|]+)/)?.[1]?.trim();if(t.done&&raw&&!/^Unconfirmed/.test(raw))completed=dateValue(raw);
   const task={id:t.id,type:'task',title:t.label,parent_id:e.id,status:t.done?'Completed':'Not Started',actual_completion:completed,legacy:{detail:t.detail,confidence:p.confidence,source_path:p.path}};
   model.entities[t.id]=task;model.paths[t.id]=dir+'/tasks.md';e.children.push(reference(model,t.id));
  }
  // Normalize each existing event without changing its ID, evidence or date precision.
  const events=[];const consumed=[];
  for(const match of p.history.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)){
   if(match[1].trim()==='Event ID')continue;
   const [event_id,recorded_at,occurred,change,actor,evidence,confidence,previous,status]=match.slice(1).map(x=>x.trim());
   const task=change.match(/\b[A-Z]+-\d+-T\d+\b/)?.[0];
   events.push({event_id,entity_id:task||p.id,event_type:'imported',occurred_at:occurred==='Unconfirmed'?null:occurred,recorded_at,actor,source:evidence,confidence,change:{description:change,before:previous,after:status},source_text:match[0]});consumed.push(match[0]);
  }
  for(const match of p.history.matchAll(/^- \*\*Event ID:\*\* ([^\n]+)\n([\s\S]*?)(?=\n- \*\*Event ID:|(?![\s\S]))/gm)){
   const get=label=>match[2].match(new RegExp('^  - \\*\\*'+label+':\\*\\* (.*)$','m'))?.[1]||null;
   const change=get('Change')||'',task=change.match(/\b[A-Z]+-\d+-T\d+\b/)?.[0];
   events.push({event_id:match[1].trim(),entity_id:task||p.id,event_type:'imported',occurred_at:get('Effective At')==='Unconfirmed'?null:get('Effective At'),recorded_at:get('Recorded At'),actor:get('Updated By'),source:get('Evidence'),confidence:get('Confidence'),change:{description:change},source_text:match[0]});consumed.push(match[0]);
  }
  let remainder=p.history;for(const text of consumed)remainder=remainder.replace(text,'');
  for(const ev of events){const year=ev.recorded_at?.match(/^\d{4}/)?.[0]||'undated',hp=dir+'/history/'+year+'.md';const doc=model.files[hp]?JSON.parse(model.files[hp].match(/```json\n([\s\S]*?)\n```/)[1]):{schema:1,events:[]};doc.events.push(ev);model.files[hp]=encode(doc,'History');}
  if(remainder.trim()){const hp=dir+'/history/'+(field('Recorded At')?.slice(0,4)||'undated')+'.md';const doc=model.files[hp]?JSON.parse(model.files[hp].match(/```json\n([\s\S]*?)\n```/)[1]):{schema:1,events:[]};(doc.source_context??=[]).push({entity_id:p.id,source:p.path,text:remainder});model.files[hp]=encode(doc,'History');}
  mapping.push({id:p.id,type,parent_id:parent,from:p.path,to:model.paths[e.id],tasks:p.tasks.map(t=>t.id),source_sha256:legacy.source_sha256,legacy_status:p.status});
 }
 // Associate the pre-handoff source with its entity so cascade deletion covers it.
 const oldArchive='archive/LEGACY_PETHWAY_PROGRESS.md';let archivedSource;
 try{archivedSource=await readFile(source+'/'+oldArchive,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(archivedSource&&model.entities['WRK-004']){const hp=dirname(model.paths['WRK-004'])+'/history/2026.md';const doc=model.files[hp]?JSON.parse(model.files[hp].match(/```json\n([\s\S]*?)\n```/)[1]):{schema:1,events:[]};(doc.source_context??=[]).push({entity_id:'WRK-004',source:oldArchive,text:archivedSource});model.files[hp]=encode(doc,'History');}
 validate(model);const files=serialize(model);
 if(archivedSource&&model.entities['WRK-004'])files[oldArchive]='# Preserved PETHWAY source — migrated\n\nThe original source is retained verbatim in WRK-004 scoped history. Resolve the stable ID through the active index or archive catalog.\n';
 await cp(source,destination,{recursive:true,filter:p=>!p.split('/').includes('.git')});
 try{files['.gitignore']=(await readFile(source+'/.gitignore','utf8')).replace(/^work\/$/gm,'/work/');}catch(error){if(error.code!=='ENOENT')throw error;}
 // Replace legacy canonical records with stable-ID redirects, not duplicate editable state.
 for(const p of records)files[p.path]=`# ${p.id} — migrated\n\nCanonical record: [${p.id}](${relative(dirname(p.path),model.paths[p.id])}).\n\nLegacy history and provenance are retained in the canonical subtree. This file is a locator only.\n`;
 files['README.md']=`# Lifegress\n\nEnglish Markdown is the canonical data source. Start at [index.md](index.md).\n\n[Foundation](docs/FOUNDATION.md) · [Data Model V1](docs/DATA_MODEL_V1.md) · [Migration report](docs/MIGRATION_V1.md)\n\nThe index contains ordered Section and standalone Task references. Archive is a separate catalog.\n`;
 files['docs/MIGRATION_V1.md']=`# V1 migration report\n\nCandidate migration; source remote head has not been verified by this script.\n\n${records.length} legacy records; ${Object.values(model.entities).filter(e=>e.type==='task').length} Tasks. Stable entity and Task IDs retained. Legacy child projects become Stages under their original parent; no new task-level progress is inferred. Unchecked legacy Tasks map to Not Started with original evidence retained. Historical project status remains provenance, not editable workflow state.\n\nOriginal source SHA-256 values and mappings:\n\n\`\`\`json\n${JSON.stringify(mapping,null,2)}\n\`\`\`\n`;
 for(const [path,text]of Object.entries(files)){await mkdir(dirname(destination+'/'+path),{recursive:true});await writeFile(destination+'/'+path,text);}
 // Validate every task and legacy source fragment before accepting the output.
 for(const p of records){const e=model.entities[p.id];if(e.legacy.source_sha256!==createHash('sha256').update(p.source).digest('hex'))throw Error('Source mismatch');for(const t of p.tasks)if(model.entities[t.id].legacy.detail!==t.detail)throw Error('Task evidence lost');for(const id of [...p.history.matchAll(/(?:^\| |^- \*\*Event ID:\*\* )([A-Z]+-\d+-(?:E\d+|WEB-[a-z0-9-]+))/gm)].map(m=>m[1]))if(!Object.values(model.files).some(t=>t.includes('\"event_id\": \"'+id+'\"')))throw Error('History event lost: '+id);}
 return {records:records.length,tasks:Object.values(model.entities).filter(e=>e.type==='task').length,sections:Object.values(model.entities).filter(e=>e.type==='section').length,stages:records.filter(p=>p.parent).length,files:Object.keys(files).length,mapping};
}
if(process.argv[1]===new URL(import.meta.url).pathname){const [source,destination]=process.argv.slice(2);if(!source||!destination)throw Error('Usage: migrate.mjs SOURCE NEW_DESTINATION');const r=await migrate(source,destination);console.log(JSON.stringify({...r,mapping:undefined},null,2));}
