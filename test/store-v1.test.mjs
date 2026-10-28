import test from 'node:test';
import assert from 'node:assert/strict';
import {StoreV1} from '../store-v1.mjs';
import {normalize,transact,decode,counts} from '../data-v1.mjs';
const base='a'.repeat(40),next='b'.repeat(40);
export function data(){return transact(normalize({}),[{kind:'create',id:'S',type:'section',title:'Test workspace'},{kind:'create',id:'P',type:'project',title:'Test project',parent_id:'S'},{kind:'create',id:'T',type:'task',title:'Test task',parent_id:'P'}],{recorded_at:'2026-01-01T00:00:00Z'}).files;}
export function harness(initial=data()){
 let head=base,files={...initial},staged=null;const calls=[];let race=false,corrupt=false;
 const transport=async(url,opts)=>{
  const u=new URL(url),p=u.pathname,b=opts.body?JSON.parse(opts.body):null;calls.push({p,method:opts.method,b});let result;
  if(p.endsWith('/git/ref/heads/main'))result={object:{sha:head}};
  else if(p.includes('/contents/')){const path=p.split('/contents/')[1];if(!(path in files))return {ok:false,status:404};const text=files[path]+(corrupt?'mismatch':'');result={encoding:'base64',size:text.length,content:Buffer.from(text).toString('base64')};}
  else if(p.includes('/git/commits/')&&opts.method==='GET')result={tree:{sha:'tree'}};
  else if(p.endsWith('/git/trees/tree'))result={tree:Object.keys(files).map(path=>({path,type:'blob',sha:'unused'}))};
  else if(p.endsWith('/git/trees')&&opts.method==='POST'){staged={...files};for(const e of b.tree)if(e.sha===null)delete staged[e.path];else staged[e.path]=e.content;result={sha:'new-tree'};}
  else if(p.endsWith('/git/commits'))result={sha:next};
  else if(p.endsWith('/git/refs/heads/main')){if(race)return {ok:false,status:422};head=b.sha;files=staged;result={};}
  else throw Error('Unexpected '+p);
  return {ok:true,json:async()=>result};
 };
 return {store:new StoreV1('synthetic',transport),calls,head:x=>head=x,race:()=>race=true,corrupt:()=>corrupt=true,files:()=>files};
}
test('V1 index loads in two requests; warm refresh checks head only; no histories/archive',async()=>{const h=harness();let {base:b,model}=await h.store.load();assert.equal(h.calls.length,2);assert.equal(Object.keys(model.entities).length,0);model=await h.store.children(b,model);assert.equal(h.calls.length,3);assert.equal(counts(model,'S').loaded,false);model=await h.store.branch(b,model,'S');assert.equal(h.calls.length,5);assert.equal(counts(model,'S').total,1);assert.ok(h.calls.every(c=>!c.p.includes('/history/')&&!c.p.includes('/archive/')));await h.store.load();await h.store.branch(b,model,'S');assert.equal(h.calls.length,6);});
test('concurrent reads coalesce and transient errors do not poison cache',async()=>{const h=harness();await Promise.all([h.store.read(base,'index.md'),h.store.read(base,'index.md')]);assert.equal(h.calls.length,1);let n=0;const s=new StoreV1('synthetic',async()=>++n===1?{ok:false,status:500}:{ok:true,json:async()=>({encoding:'base64',content:Buffer.from('ok').toString('base64')})});await assert.rejects(s.read(base,'index.md'));assert.equal(await s.read(base,'index.md'),'ok');});
test('compare reads only; atomic multi-file Task/ancestor history publication is verified',async()=>{const h=harness(),{model}=await h.store.load();const r=await h.store.prepare(base,model,[{kind:'edit',id:'T',fields:{status:'Completed'}}],{recorded_at:'2026-10-26T00:00:00Z'});assert.ok(h.calls.every(c=>c.method==='GET'||c.p==='/graphql'));assert.equal(counts(r.model,'S').progress,100);const result=await h.store.commit(r);assert.equal(result.verified,true);assert.equal(h.calls.find(c=>c.method==='PATCH').b.force,false);assert.deepEqual(h.calls.find(c=>c.p.endsWith('/git/commits')&&c.method==='POST').b.parents,[base]);const n=h.calls.filter(c=>c.method!=='GET').length;await h.store.verify(r);assert.equal(h.calls.filter(c=>c.method!=='GET').length,n);});
test('conflict before compare or publish causes no writes',async()=>{const h=harness(),{model}=await h.store.load();h.head(next);await assert.rejects(h.store.prepare(base,model,[]),/changed/);assert.ok(h.calls.every(c=>c.method==='GET'||c.p==='/graphql'));h.head(base);const r=await h.store.prepare(base,model,[{kind:'edit',id:'T',fields:{note:'new'}}]);h.head(next);await assert.rejects(h.store.commit(r),/changed/);assert.ok(h.calls.every(c=>c.method==='GET'||c.p==='/graphql'));});
test('late race rejects non-fast-forward update; no success result',async()=>{const h=harness(),{model}=await h.store.load();const r=await h.store.prepare(base,model,[{kind:'edit',id:'T',fields:{note:'new'}}]);h.race();await assert.rejects(h.store.commit(r),/422/);assert.ok(!r.refUpdated);});
test('read-back mismatch never reports success',async()=>{const h=harness(),{model}=await h.store.load();const r=await h.store.prepare(base,model,[{kind:'edit',id:'T',fields:{note:'new'}}]);h.corrupt();await assert.rejects(h.store.commit(r),/mismatch/);});
test('archive moves and deletion use null SHA and verify removed files',async()=>{const h=harness(),{model}=await h.store.load();const r=await h.store.prepare(base,model,[{kind:'archive',id:'P'}]);assert.ok(r.changes.some(c=>c.path==='sections/S/projects/P/project.md'&&c.after===null));assert.ok(r.changes.some(c=>c.path==='archive/projects/P/project.md'&&c.after));await h.store.commit(r);assert.ok(!h.files()['sections/S/projects/P/project.md']);assert.ok(h.files()['archive/projects/P/project.md']);assert.ok(h.calls.find(c=>c.method==='POST'&&c.p.endsWith('/git/trees')).b.tree.some(e=>e.sha===null));});
test('active load batches multi-file reads through GraphQL and falls back to per-file reads',async()=>{
 const files=transact(normalize({}),[{kind:'create',id:'S',type:'section',title:'One'},{kind:'create',id:'R',type:'section',title:'Two'},{kind:'create',id:'P',type:'project',title:'P',parent_id:'S'},{kind:'create',id:'Q',type:'project',title:'Q',parent_id:'R'},{kind:'create',id:'T',type:'task',title:'T',parent_id:'P'},{kind:'create',id:'U',type:'task',title:'U',parent_id:'Q'}],{recorded_at:'2026-01-01T00:00:00Z'}).files;
 const run=async graphql=>{const calls=[];const store=new StoreV1('synthetic',async(url,opts)=>{const p=new URL(url).pathname;calls.push(p);
  if(p==='/graphql'){if(!graphql)return {ok:false,status:502};const b=JSON.parse(opts.body),repository={};for(const [k,v] of Object.entries(b.variables)){const path=v.slice(41);repository['f'+k.slice(1)]=path in files?{text:files[path],isTruncated:false}:null;}return {ok:true,json:async()=>({data:{repository}})};}
  if(p.endsWith('/git/ref/heads/main'))return {ok:true,json:async()=>({object:{sha:base}})};
  const path=p.split('/contents/')[1];if(!(path in files))return {ok:false,status:404};return {ok:true,json:async()=>({encoding:'base64',size:files[path].length,content:Buffer.from(files[path]).toString('base64')})};});
  const {base:b,model}=await store.load();const m=await store.active(b,model);return {calls,m};};
 const fast=await run(true),slow=await run(false);
 assert.deepEqual(Object.keys(fast.m.entities).sort(),Object.keys(slow.m.entities).sort());
 assert.equal(counts(fast.m,'S').total,1);assert.equal(counts(fast.m,'R').total,1);
 assert.ok(fast.calls.filter(p=>p.includes('/contents/')).length<slow.calls.filter(p=>p.includes('/contents/')).length);
 assert.ok(fast.calls.length<slow.calls.length);
});
test('GraphQL 401 is not swallowed by the fallback',async()=>{const store=new StoreV1('synthetic',async()=>({ok:false,status:401}));await assert.rejects(store.bulk(base,['a.md','b.md']),e=>e.status===401);});
test('GitHub requests bypass the browser HTTP cache so post-publish verification sees the new head',async()=>{const seen=[];const s=new StoreV1('synthetic',async(url,opts)=>{seen.push(opts.cache);return {ok:true,json:async()=>({object:{sha:base}})};});await s.head();assert.deepEqual(seen,['no-store']);});
