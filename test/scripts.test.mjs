import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {normalize,transact,decode} from '../data-v1.mjs';
import {checkData} from '../scripts/check-data.mjs';
import {main} from '../scripts/lifegress.mjs';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'lifegress-'));
 const files=transact(normalize({}),[{kind:'create',id:'S',type:'section',title:'Workspace'},{kind:'create',id:'P',type:'project',title:'Project',parent_id:'S'},{kind:'create',id:'T',type:'task',title:'Task',parent_id:'P'}],{recorded_at:'2026-01-01T00:00:00Z'}).files;
 for(const [path,text] of Object.entries(files)){await mkdir(dirname(join(dir,path)),{recursive:true});await writeFile(join(dir,path),text);}
 await mkdir(join(dir,'docs'));await writeFile(join(dir,'docs/README.md'),'# Not a record');await mkdir(join(dir,'archive'));await writeFile(join(dir,'archive/README.md'),'# Archive notes');
 return dir;
}
const quiet=()=>{};

test('data check passes valid records and ignores non-record docs',async()=>{const dir=await fixture();try{const r=await checkData(dir);assert.equal(r.ok,true);assert.equal(r.entities,3);}finally{await rm(dir,{recursive:true});}});

test('data check reports a broken record file instead of skipping it',async()=>{const dir=await fixture();try{const path=join(dir,'sections/S/projects/P/tasks.md');await writeFile(path,(await readFile(path,'utf8')).replace('"status"','"status" "'));const r=await checkData(dir);assert.equal(r.ok,false);assert.match(r.errors.join('\n'),/sections\/S\/projects\/P\/tasks\.md/);}finally{await rm(dir,{recursive:true});}});

test('data check reports inconsistent references',async()=>{const dir=await fixture();try{const path=join(dir,'sections/S/projects/P/tasks.md');await writeFile(path,(await readFile(path,'utf8')).replace('"parent_id": "P"','"parent_id": "S"'));const r=await checkData(dir);assert.equal(r.ok,false);}finally{await rm(dir,{recursive:true});}});

test('AI writer records actor, source and partial completion date in History',async()=>{const dir=await fixture();try{
 await main([dir,'status','T','Completed','--actor','Claude Code','--source','Owner chat 2026-10-28','--occurred','2026-10'],quiet);
 assert.equal((await checkData(dir)).ok,true);
 const tasks=decode(await readFile(join(dir,'sections/S/projects/P/tasks.md'),'utf8'));const task=tasks.records.find(r=>r.id==='T');
 assert.equal(task.status,'Completed');assert.equal(task.actual_completion,'2026-10');
 const events=decode(await readFile(join(dir,'sections/S/projects/P/history/2026.md'),'utf8')).events;const last=events.at(-1);
 assert.equal(last.actor,'Claude Code');assert.equal(last.source,'Owner chat 2026-10-28');
}finally{await rm(dir,{recursive:true});}});

test('AI writer refuses writes without provenance, invalid status, or container status; files stay unchanged',async()=>{const dir=await fixture();try{
 const before=await readFile(join(dir,'sections/S/projects/P/tasks.md'),'utf8');
 await assert.rejects(main([dir,'status','T','Completed'],quiet),/--actor and --source/);
 await assert.rejects(main([dir,'status','T','Done','--actor','A','--source','B'],quiet),/Status must be/);
 await assert.rejects(main([dir,'status','P','Completed','--actor','A','--source','B'],quiet),/derived/);
 assert.equal(await readFile(join(dir,'sections/S/projects/P/tasks.md'),'utf8'),before);
}finally{await rm(dir,{recursive:true});}});

test('AI writer dry run and create',async()=>{const dir=await fixture();try{
 const dry=await main([dir,'note','T','Draft','--actor','A','--source','B','--dry-run'],quiet);assert.ok(dry.changes.length);
 assert.equal(decode(await readFile(join(dir,'sections/S/projects/P/tasks.md'),'utf8')).records[0].note,'');
 const made=await main([dir,'create','task','New task','--parent','P','--actor','A','--source','B'],quiet);
 const r=await checkData(dir);assert.equal(r.ok,true);assert.equal(r.entities,4);assert.match(made.op.id,/^TASK-/);
}finally{await rm(dir,{recursive:true});}});
