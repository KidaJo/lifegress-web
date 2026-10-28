import {GitHub} from './github.mjs?v=021';
import {decode,normalize,validate,transact,diff,dirname,safePath,avatarPath} from './data-v1.mjs';
const repo='/repos/KidaJo/personal-hq';
const read64=doc=>{if(doc.encoding!=='base64'||doc.size>2000000)throw Error('Unsupported Markdown file');return new TextDecoder().decode(Uint8Array.from(atob(doc.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));};
export class StoreV1 extends GitHub {
 constructor(token,transport){super(token,transport);this.requests=0;this.cache=new Map();this.pending=new Map();this.treeCache=new Map();}
 async call(...args){this.requests++;return super.call(...args);}
 async read(base,path,optional=false){
  if(!/^[a-f0-9]{40}$/.test(base)||!safePath(path))throw Error('Invalid path/version');const key=base+':'+path;
  if(this.cache.has(key))return this.cache.get(key);
  if(!this.pending.has(key))this.pending.set(key,(async()=>{try{const text=read64(await this.call(repo+'/contents/'+path+'?ref='+base));this.cache.set(key,text);return text;}catch(e){if(e.status===404&&optional){this.cache.set(key,null);return null;}throw e;}finally{this.pending.delete(key);}})());
  return this.pending.get(key);
 }
 // Prefill the read cache from files saved on this device, so a start with an unchanged head needs one request.
 seed(base,files){if(!/^[a-f0-9]{40}$/.test(base))return;for(const [path,text] of Object.entries(files))if(safePath(path))this.cache.set(base+':'+path,text);}
 // Avatars are JPEG uploads or SVG default marks; the contents API returns them base64 encoded.
 async avatar(base,path){if(!avatarPath(path))throw Error('Invalid avatar path');const doc=await this.call(repo+'/contents/'+path+'?ref='+base);return `data:image/${path.endsWith('.svg')?'svg+xml':'jpeg'};base64,`+String(doc.content||'').replace(/\s/g,'');}
 async tree(base){if(!this.treeCache.has(base)){const c=await this.call(repo+'/git/commits/'+base);const t=await this.call(repo+'/git/trees/'+c.tree.sha+'?recursive=1');if(t.truncated)throw Error('Truncated repository tree; no changes written');this.treeCache.set(base,{sha:c.tree.sha,entries:t.tree});}return this.treeCache.get(base);}
 async load(){const base=await this.head();const [text,crew]=await Promise.all([this.read(base,'index.md',true),this.read(base,'crew.md',true)]);if(text===null)throw Error('This repository has not migrated to V1. Use the existing app until migration is verified.');const model=normalize({'index.md':text,...(crew!=null?{'crew.md':crew}:{})});return {base,model};}
 async bulk(base,paths){
  // One GraphQL request per 50 files instead of one REST request per file. Any failure other than 401 falls back to per-file reads.
  const todo=paths.filter(p=>!this.cache.has(base+':'+p));
  for(let i=0;i<todo.length;i+=50){const chunk=todo.slice(i,i+50);const vars={},decl=[],fields=[];chunk.forEach((p,n)=>{if(!safePath(p))throw Error('Invalid path/version');vars['e'+n]=base+':'+p;decl.push('$e'+n+':String!');fields.push('f'+n+':object(expression:$e'+n+'){...on Blob{text isTruncated}}');});
   let r;try{r=await this.call('/graphql','POST',{query:'query('+decl.join(',')+'){repository(owner:"KidaJo",name:"personal-hq"){'+fields.join(' ')+'}}',variables:vars});}catch(e){if(e.status===401)throw e;return false;}
   const repository=r?.data?.repository;if(!repository||r.errors)return false;
   for(let n=0;n<chunk.length;n++){const blob=repository['f'+n];if(blob&&(blob.isTruncated||typeof blob.text!=='string'))return false;}
   chunk.forEach((p,n)=>this.cache.set(base+':'+p,repository['f'+n]?.text??null));}
  return true;
 }
 async paths(base,model,paths){const queue=[...new Set(paths)].filter(p=>!(p in model.files));if(queue.length>1&&/^[a-f0-9]{40}$/.test(base))await this.bulk(base,queue);await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(queue.length){const p=queue.shift(),text=await this.read(base,p,true);if(text!=null)model.files[p]=text;}}));return normalize(model.files);}
 async children(base,model,id=null){return this.paths(base,model,(id==null?model.index.children:model.entities[id]?.children||[]).map(r=>r.path));}
 async branch(base,model,id){let m=model;for(let d=0;d<4;d++){const paths=[];const seen=new Set();function walk(key){if(seen.has(key))return;seen.add(key);for(const r of m.entities[key]?.children||[]){if(!m.entities[r.id])paths.push(r.path);else walk(r.id);}}walk(id);if(!paths.length)return m;m=await this.paths(base,m,paths);}throw Error('Incomplete subtree');}
 async active(base,model){let current=await this.children(base,model);for(let depth=0;depth<4;depth++){const missing=Object.values(current.entities).filter(e=>!current.paths[e.id].startsWith('archive/')).flatMap(e=>e.children||[]).filter(r=>!current.entities[r.id]);if(!missing.length){validate(current);return current;}current=await this.paths(base,current,missing.map(r=>r.path));}throw Error('Invalid or too-deep hierarchy');}
 async archives(base,model,full=false){let m=await this.paths(base,model,['archive/index.md']);if(!full)return m;m=await this.paths(base,m,m.catalog.entries.map(a=>a.archived_path));for(let i=0;i<4;i++){const missing=Object.values(m.entities).flatMap(e=>e.children||[]).filter(r=>!m.entities[r.id]);if(!missing.length)return m;m=await this.paths(base,m,missing.map(r=>r.path));}throw Error('Archive hierarchy incomplete');}
 async history(base,model,id){const entity=model.entities[id];let e=entity;while(e&&e.type!=='project'&&e.type!=='section')e=model.entities[e.parent_id];const scope=e?dirname(model.paths[e.id]):'standalone';const tree=await this.tree(base);return this.paths(base,model,tree.entries.filter(e=>e.type==='blob'&&e.path.includes('/history/')&&(['task','stage'].includes(entity.type)||e.path.startsWith(scope+'/'))).map(e=>e.path));}
 async prepare(base,model,operations,context={}){
  if(await this.head()!==base)throw Error('GitHub changed. Your draft is retained; refresh and reconcile before publishing.');
  let m=await this.active(base,model);
  const management=operations.some(o=>['archive','restore','move','delete'].includes(o.kind));
  if(management)m=await this.archives(base,m,true);
  const tree=await this.tree(base),year=(context.recorded_at||new Date().toISOString()).slice(0,4);
  const scopes=new Set();
  const addScopes=id=>{let e=m.entities[id];if(!e)scopes.add('standalone');while(e){if(e.type==='section'||e.type==='project')scopes.add(dirname(m.paths[e.id]));if(e.parent_id==null&&e.type==='task')scopes.add('standalone');e=m.entities[e.parent_id];}};
  for(const op of operations){addScopes(op.id);if(op.parent_id!=null)addScopes(op.parent_id);}
  const paths=tree.entries.filter(e=>e.type==='blob'&&(e.path.includes('/history/')&&(management||[...scopes].some(scope=>e.path===scope+'/history/'+year+'.md'))||management&&Object.values(m.paths).some(p=>e.path.startsWith(dirname(p)+'/')))).map(e=>e.path);
  m=await this.paths(base,m,paths);validate(m);
  const after=transact(m,operations,context),changes=diff(m.files,after.files);
  if(!changes.length)throw Error('No changes to review');
  return {base,tree:tree.sha,changes,model:after,operations};
 }
 async commit(review){
  if(await this.head()!==review.base)throw Error('GitHub changed after comparison. Compare again.');
  const assets=review.assets||[];
  if(!review.changes.length||review.changes.some(c=>!safePath(c.path))||assets.some(a=>!avatarPath(a.path)))throw Error('Invalid changes');
  const binary=await Promise.all(assets.map(async a=>({path:a.path,mode:'100644',type:'blob',sha:a.base64==null?null:(await this.call(repo+'/git/blobs','POST',{content:a.base64,encoding:'base64'})).sha})));
  const tree=await this.call(repo+'/git/trees','POST',{base_tree:review.tree,tree:[...review.changes.map(c=>({path:c.path,mode:'100644',type:'blob',...(c.after==null?{sha:null}:{content:c.after})})),...binary]});
  const commit=await this.call(repo+'/git/commits','POST',{message:'Update Lifegress V1 records',tree:tree.sha,parents:[review.base]});review.commit=commit.sha;
  await this.call(repo+'/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});review.refUpdated=true;return this.verify(review);
 }
 async verify(review){if(await this.head()!==review.commit)throw Error('Remote verification failed; draft retained.');for(const c of review.changes){const text=await this.read(review.commit,c.path,true);if(text!==c.after)throw Error('Read-back mismatch; draft retained.');}return {base:review.commit,verified:true};}
}
