import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEdit,parseProject,projectPath} from '../model.mjs';
import {GitHub} from '../github.mjs';
const path='projects/work/TST-001.md',base='a'.repeat(40),next='b'.repeat(40);
const original=`# Test
- **Stable Project ID:** TST-001
- **Project Name:** Test Project
- **Category:** work
- **Status:** In Progress
- **Status Confidence:** Confirmed

## Current Summary
A test only.

## Task Checklist
- [ ] **TST-001-T01** Test task | Completed At: Not completed | Evidence: Original

## Progress History
Historical evidence stays intact.

## References
Original
`;
const edit={tasks:{'TST-001-T01':true},note:'Reviewed | confirmed',date:''};
test('schema-preserving updates distinguish recorded/effective dates',()=>{
 const out=applyEdit(path,original,edit,'2026-10-23T00:00:00Z');
 assert.equal(parseProject(path,out).tasks[0].done,true);
 assert.match(out,/Completed At: Unconfirmed/);
 assert.match(out,/Effective At:\*\* Unconfirmed/);
 assert.match(out,/Recorded At:\*\* 2026-10-23T00:00:00Z/);
 assert.ok(out.includes('Historical evidence stays intact.'));
 assert.ok(out.endsWith('## References\nOriginal\n'));
 assert.ok(!out.includes('Reviewed | confirmed'));
});
test('reject invalid dates, paths and unknown tasks; no-op preserves bytes',()=>{
 assert.equal(applyEdit(path,original,{tasks:{},note:'  ',date:''}),original);
 assert.throws(()=>applyEdit(path,original,{...edit,date:'2026-02-30'}));
 assert.throws(()=>applyEdit(path,original,{...edit,tasks:{unknown:true}}));
 assert.equal(projectPath('../README.md'),false);
});
function harness(){
 let head=base, changed=original;const calls=[];
 const client=new GitHub('fake',async(url,opts)=>{
  const p=new URL(url).pathname;const b=opts.body?JSON.parse(opts.body):null;calls.push({p,method:opts.method,b});
  let result;
  if(p.endsWith('/git/ref/heads/main')) result={object:{sha:head}};
  else if(p.endsWith('/git/refs/heads/main')){head=b.sha;result={};}
  else if(p.includes('/git/commits/')&&opts.method==='GET')result={tree:{sha:'tree'}};
  else if(p.endsWith('/git/trees/tree'))result={tree:[{path,type:'blob',sha:'blob'}]};
  else if(p.endsWith('/git/blobs/blob'))result={encoding:'base64',size:changed.length,content:Buffer.from(changed).toString('base64')};
  else if(p.endsWith('/git/trees')){changed=b.tree[0].content;result={sha:'newtree'};}
  else if(p.endsWith('/git/commits'))result={sha:next};
  else throw Error('Unexpected request '+p);
  return {ok:true,json:async()=>result};
 });
 return {client,calls,setHead:x=>head=x};
}
test('compare performs reads only; publish is atomic, non-force, verified',async()=>{
 const h=harness(),review=await h.client.compare(base,{[path]:edit});
 assert.ok(h.calls.every(c=>c.method==='GET'));
 const r=await h.client.commit(review);assert.equal(r.verified,true);
 const ref=h.calls.find(c=>c.method==='PATCH');assert.equal(ref.b.force,false);
 const commit=h.calls.find(c=>c.method==='POST'&&c.p.endsWith('/commits'));assert.deepEqual(commit.b.parents,[base]);
 const writes=h.calls.filter(c=>c.method!=='GET').length;
 await h.client.verify(review);assert.equal(h.calls.filter(c=>c.method!=='GET').length,writes);
});
test('remote changes block publication before any write',async()=>{
 const h=harness(),review=await h.client.compare(base,{[path]:edit});h.setHead(next);
 await assert.rejects(h.client.commit(review),/changed/);
 assert.ok(h.calls.every(c=>c.method==='GET'));
});

test('static package contains no server endpoint or embedded private projects',async()=>{
 const {readFile}=await import('node:fs/promises');
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.ok(!app.includes("fetch('/api/"));
 assert.ok(!index.includes('PETHWAY'));
 assert.ok(index.includes('connect-src https://api.github.com'));
 assert.match(index,/src="\.\/app(?:-v1)?\.js(?:\?v=[a-z0-9]+)?"/);
 assert.ok(!app.includes('localStorage.setItem(key,JSON.stringify({token'));
});

test('default transport invokes browser fetch with its global receiver',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=function(){assert.equal(this,globalThis);return Promise.resolve({ok:true,json:async()=>({object:{sha:base}})});};
 try{assert.equal(await new GitHub('fake').head(),base);}finally{globalThis.fetch=old;}
});

test('initial directory uses two requests and unchanged refresh only checks head',async()=>{
 let calls=0;
 const registry='| TST-001 | [Test Project](projects/work/TST-001.md) | Active | Confirmed | - |';
 const g=new GitHub('fake',async url=>{calls++;return {ok:true,json:async()=>url.includes('/git/ref/')?{object:{sha:base}}:{content:Buffer.from(registry).toString('base64')}};});
 const data=await g.load();assert.equal(calls,2);assert.equal(data.projects[0].name,'Test Project');assert.equal(data.projects[0].loaded,false);
 await g.load();assert.equal(calls,3);
});

test('remember is explicit, survives a new store, and forget removes only credentials',async()=>{
 const {credentialStore}=await import('../credentials.mjs');
 const values=new Map([['drafts','keep']]);const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const c=credentialStore(storage);assert.equal(c.read(),'');assert.equal(values.size,1);
 assert.equal(c.remember('synthetic'),true);assert.equal(credentialStore(storage).read(),'synthetic');
 assert.equal(c.forget(),true);assert.equal(c.read(),'');assert.equal(values.get('drafts'),'keep');
 const blocked=credentialStore(undefined);assert.equal(blocked.read(),'');assert.equal(blocked.remember('x'),false);assert.equal(blocked.forget(),false);
});

test('session authentication failures reconnect without deleting drafts; network failures keep credentials',async()=>{
 const {runInNewContext}=await import('node:vm');
 const {readFile}=await import('node:fs/promises');
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('async function run(fn)'),app.indexOf("content.addEventListener('input'"));
 for(const status of [401,403,500,undefined]){
  const state={token:'synthetic',drafts:'keep',screens:0,closed:0};
  const context={busy:false,rememberPreference:false,github:{},credentials:{read:()=>state.token,forget:()=>{state.token='';return true;}},$:()=>({setAttribute(){},close(){state.closed++;}}),document:{querySelectorAll:()=>[]},connectScreen:()=>state.screens++,message:t=>state.message=t,updateCount(){}};
  await runInNewContext(source+';run(async()=>{const e=Error("Temporary failure");e.status='+JSON.stringify(status)+';throw e;})',context);
  assert.equal(state.drafts,'keep');assert.equal(context.busy,false);
  if(status===401){assert.equal(state.token,'');assert.equal(state.screens,1);assert.equal(context.github,null);assert.equal(context.rememberPreference,true);assert.match(state.message,/Enter a new token/);}
  else{assert.equal(state.token,'synthetic');assert.equal(state.screens,0);assert.ok(context.github);}
 }
});


test('project subtitles use explicit next actions before incomplete tasks and preserve custom state text',async()=>{
 const {runInNewContext}=await import('node:vm');
 const {readFile}=await import('node:fs/promises');
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const code=app.slice(app.indexOf('function statusMarkup'),app.indexOf('let listGeneration'));
 const context={esc:s=>String(s??'').replace(/</g,'&lt;')};
 runInNewContext(code,context);
 assert.equal(context.nextStep({next:'- Confirm client selection',tasks:[{done:false,label:'Edit photos'}]}),'Confirm client selection');
 assert.equal(context.nextStep({tasks:[{done:true,label:'Finished'},{done:false,label:'Edit photos'}]}),'Next task: Edit photos');
 assert.equal(context.nextStep({tasks:[]}),'No next step recorded');
 assert.equal(context.nextStep({next:'Proposed unless explicitly stated in the source; no external action has been taken.\n\n- Obtain client feedback.'}),'Suggested: Obtain client feedback.');
 assert.match(context.statusMarkup('UX Confirmed / Preparing UI'),/state-neutral/);
 assert.match(context.statusMarkup('UX Confirmed / Preparing UI'),/UX Confirmed \/ Preparing UI/);
 assert.match(context.statusMarkup('In Progress'),/circle-dot/);
 assert.match(context.statusMarkup('Active / Follow-up Needed'),/state-attention/);
});
