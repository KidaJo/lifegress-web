import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,transact,validate,decode} from '../data-v1.mjs';
import {harness} from './store-v1.test.mjs';
const base='a'.repeat(40);
const seed=()=>transact(normalize({}),[{kind:'create',id:'S',type:'section',title:'W'},{kind:'create',id:'T',type:'task',title:'T',parent_id:'S'}],{recorded_at:'2026-01-01T00:00:00Z'});

test('app edits register the Owner in the crew and as contributor; derived completion does not credit ancestors',()=>{
 const m=seed();assert.deepEqual(m.crew.members.map(c=>c.id),['owner']);assert.deepEqual(m.entities.T.contributors,['owner']);
 const after=transact(m,[{kind:'edit',id:'T',fields:{status:'Completed'}}],{actor:'Claude',contributor:'claude',recorded_at:'2026-01-02T00:00:00Z'});
 assert.deepEqual(after.entities.T.contributors,['owner','claude']);assert.deepEqual(after.entities.S.contributors,['owner']);
 assert.deepEqual(after.crew.members.map(c=>c.id),['owner','claude']);validate(after);
});

test('crew edits change name and avatar only, and reject bad input',()=>{
 const m=seed();const after=transact(m,[{kind:'crew',id:'owner',name:'Kida',avatar:'assets/avatars/owner-x1.jpg'}]);
 const owner=decode(after.files['crew.md']).members[0];assert.equal(owner.name,'Kida');assert.equal(owner.avatar,'assets/avatars/owner-x1.jpg');
 assert.equal(JSON.stringify(after.entities),JSON.stringify(m.entities));
 assert.throws(()=>transact(m,[{kind:'crew',id:'owner',name:' '}]),/empty/);
 assert.throws(()=>transact(m,[{kind:'crew',id:'owner',avatar:'../x.jpg'}]),/avatar/);
 assert.throws(()=>transact(m,[{kind:'crew',id:'ghost',name:'X'}]),/Unknown crew/);
});

test('avatar upload is committed as a binary blob next to the crew change; the old photo is removed',async()=>{
 const h=harness({...seed().files,'assets/avatars/owner-old.jpg':'old'});const {model}=await h.store.load();
 const r=await h.store.prepare(base,model,[{kind:'crew',id:'owner',avatar:'assets/avatars/owner-new.jpg'}]);
 r.assets=[{path:'assets/avatars/owner-new.jpg',base64:'AAAA'},{path:'assets/avatars/owner-old.jpg',base64:null}];
 await h.store.commit(r);const files=h.files();
 assert.match(files['assets/avatars/owner-new.jpg'],/binary blob-4/);assert.ok(!files['assets/avatars/owner-old.jpg']);
 r.assets=[{path:'../evil.jpg',base64:'AAAA'}];await assert.rejects(h.store.commit({...r,base:files&&r.base}),/Invalid|changed/);
});

test('a start from files saved on the device needs only the head check when GitHub has not changed',async()=>{
 const first=harness();const {base:b,model}=await first.store.load();const m=await first.store.active(b,model);
 const saved=Object.fromEntries(Object.entries(m.files).filter(([p])=>!p.includes('/history/')));
 const h=harness();h.store.seed(b,saved);const data=await h.store.load();await h.store.active(data.base,data.model);
 assert.equal(h.calls.length,1);assert.ok(h.calls[0].p.endsWith('/git/ref/heads/main'));
});

test('top-level order (workspaces) can be changed and is recorded in History',()=>{
 const m=transact(normalize({}),[{kind:'create',id:'A',type:'section',title:'A'},{kind:'create',id:'B',type:'section',title:'B'}],{recorded_at:'2026-01-01T00:00:00Z'});
 const after=transact(m,[{kind:'reorder',id:null,ids:['B','A']}]);validate(after);
 assert.deepEqual(after.index.children.map(r=>r.id),['B','A']);assert.match(after.files['index.md'],/"B"[\s\S]*"A"/);
 const ev=decode(after.files['standalone/history/'+new Date().toISOString().slice(0,4)+'.md']).events.at(-1);assert.equal(ev.entity_id,'index');assert.equal(ev.event_type,'reordered');
 assert.throws(()=>transact(m,[{kind:'reorder',id:null,ids:['A']}]),/every top-level/);
});
