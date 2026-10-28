// Markdown is canonical. The normalized map below is an ephemeral working view.
export const statuses = ['Not Started', 'In Progress', 'Completed'];
export const allowed = {index:['section','task'],section:['project','task'],project:['stage','task'],stage:['task'],task:[]};
const clone = x => structuredClone(x);
const fail = text => { throw Error(text); };
export const dirname = path => path.slice(0,path.lastIndexOf('/'));
// Crew: the Owner and AI collaborators (crew.md). Avatars are small JPEGs (uploads) or SVGs (default AI marks) in assets/avatars/.
export const crewId = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const avatarPath = p => typeof p==='string' && /^assets\/avatars\/[a-z0-9][a-z0-9-]{0,63}\.(?:jpg|png|svg)$/.test(p);
export const crewSlug = name => String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
// Who made a History event: the stored contributor id, else a crew alias match for events recorded before contributors existed.
export function eventContributor(m,event){if(event.contributor)return event.contributor;const actor=String(event.actor||'').toLowerCase();return (m.crew?.members||[]).find(c=>[c.name,...(c.aliases||[])].some(a=>a&&actor===a.toLowerCase()))?.id??null;}
export const safePath = p => typeof p==='string' && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/.test(p) && !p.split('/').some(s=>s==='.'||s==='..');
export function dateValue(value){
 if(value==null||value==='')return null;
 if(typeof value!=='string')fail('Invalid date');
 if(/^\d{4}$/.test(value))return value;
 if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return value;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value)return value;
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))){dateValue(value.slice(0,10));return value;}
 fail('Use YYYY, YYYY-MM, YYYY-MM-DD, or an ISO timestamp with timezone.');
}
export function encode(doc,title='Lifegress records'){
 return `# ${title.replace(/[\r\n]/g,' ')}\n\nCanonical V1 records. Container status and progress are derived.\n\n\`\`\`json\n${JSON.stringify(doc,null,2)}\n\`\`\`\n`;
}
export function decode(text){
 const blocks=[...text.matchAll(/^```json\r?\n([\s\S]*?)\r?\n```/gm)];
 if(blocks.length!==1)fail('Expected exactly one canonical JSON record block in Markdown');
 const doc=JSON.parse(blocks[0][1]);if(doc.schema!==1)fail('Unsupported data schema');return doc;
}
export function normalize(files){
 const index=files['index.md']?decode(files['index.md']):{schema:1,children:[]};
 const catalog=files['archive/index.md']?decode(files['archive/index.md']):{schema:1,entries:[]};
 const crew=files['crew.md']?decode(files['crew.md']):{schema:1,members:[]};
 const model={index,catalog,crew,entities:{},paths:{},files:{...files}};
 for(const [path,text] of Object.entries(files)){
  if(path==='index.md'||path==='archive/index.md'||path.includes('/history/')||!/(?:section|project|stages|tasks)\.md$/.test(path))continue;
  for(const e of decode(text).records||[]){if(model.entities[e.id])fail('Duplicate ID: '+e.id);model.entities[e.id]=clone(e);model.paths[e.id]=path;}
 }
 return model;
}
export function refs(m,id){return id==null?m.index.children:m.entities[id]?.children||[];}
export function reference(m,id){const e=m.entities[id];return {id,type:e.type,path:m.paths[id]};}
export function subtree(m,id){
 const result=[],seen=new Set();function visit(key){if(seen.has(key))fail('Duplicate or cyclic child: '+key);seen.add(key);const e=m.entities[key];if(!e)fail('Load required records before this operation: '+key);result.push(key);for(const r of e.children||[])visit(r.id);}visit(id);return result;
}
export function archived(m,id){const path=m.paths[id];return !!path?.startsWith('archive/');}
export function counts(m,id){
 const seen=new Set();let total=0,started=0,completed=0,loaded=true;
 function visit(key){if(seen.has(key))fail('Duplicate descendant '+key);seen.add(key);const e=m.entities[key];if(!e){loaded=false;return;}if(e.type==='task'){total++;started+=e.status!=='Not Started';completed+=e.status==='Completed';}else for(const r of e.children||[])visit(r.id);}
 if(id==null)for(const r of m.index.children)visit(r.id);else visit(id);
 const type=m.entities[id]?.type;
 return {total,started,completed,loaded,progress:loaded&&total?completed/total*100:null,status:!loaded?null:completed===total&&total>0?'Completed':type==='project'?'In Progress':started?'In Progress':'Not Started'};
}
export function validate(m,{partial=false}={}){
 const owner=new Map();
 const crewIds=new Set();
 for(const c of m.crew?.members||[]){if(!crewId.test(c?.id||'')||crewIds.has(c.id)||!c.name?.trim()||!['owner','ai'].includes(c.kind)||c.avatar!=null&&!avatarPath(c.avatar))fail('Invalid crew member '+(c?.id||''));crewIds.add(c.id);}const rootArchives=new Set(m.catalog.entries.map(x=>x.id));if(rootArchives.size!==m.catalog.entries.length)fail('Duplicate archive ID');
 const checkRefs=(parent,list)=>{
  if(!Array.isArray(list))fail('Missing ordered children');
  for(const r of list){if(!r||!safePath(r.path)||!allowed[parent==null?'index':m.entities[parent].type].includes(r.type))fail('Invalid child reference');if(owner.has(r.id))fail('Duplicate parent reference '+r.id);owner.set(r.id,parent);const e=m.entities[r.id];if(!e){if(partial)continue;fail('Missing child '+r.id);}if(e.type!==r.type||m.paths[e.id]!==r.path||(e.parent_id??null)!==parent)fail('Parent/path mismatch '+r.id);}
 };
 checkRefs(null,m.index.children);
 for(const e of Object.values(m.entities)){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(e.id)||!e.title?.trim()||!Object.hasOwn(allowed,e.type)||e.type==='index')fail('Invalid entity');
  if(e.note!=null&&typeof e.note!=='string')fail('Note must be text');
  if(e.type==='task'){if(!statuses.includes(e.status)||e.children)fail('Invalid Task status/children');}
  else{if(Object.hasOwn(e,'status')||Object.hasOwn(e,'progress'))fail('Container state must be derived');checkRefs(e.id,e.children);}
  if(e.type==='section'&&(e.planned_completion!=null||e.actual_completion!=null))fail('Section cannot have completion dates');
  if(e.contributors!=null&&(!Array.isArray(e.contributors)||new Set(e.contributors).size!==e.contributors.length||e.contributors.some(id=>!crewIds.has(id))))fail('Invalid contributors on '+e.id);
  dateValue(e.planned_completion);dateValue(e.actual_completion);
 }
 for(const e of Object.values(m.entities)){if(!owner.has(e.id)&&!rootArchives.has(e.id))fail('Unreferenced entity '+e.id);let id=e.id;const seen=new Set();while(id!=null&&m.entities[id]){if(seen.has(id))fail('Cycle');seen.add(id);id=m.entities[id].parent_id;}if(seen.size>4)fail('Maximum depth is four');}
 for(const a of m.catalog.entries){if(!['section','project'].includes(a.type)||!safePath(a.archived_path)||!safePath(a.original_path)||!Number.isInteger(a.position)||a.position<0)fail('Invalid archive locator');if(m.entities[a.id]&&m.paths[a.id]!==a.archived_path)fail('Archive path mismatch');}
 const eventIds=new Set();
 for(const [path,text]of Object.entries(m.files))if(path.includes('/history/')){
  const doc=decode(text);for(const event of doc.events||[]){
   if(!event.event_id||eventIds.has(event.event_id))fail('Missing or duplicate history event ID');eventIds.add(event.event_id);
   for(const field of ['entity_id','event_type','recorded_at','actor','source','change'])if(event[field]==null)fail('Incomplete history event '+event.event_id);
   if(!/^\d{4}-\d{2}-\d{2}T/.test(event.recorded_at)||!Number.isFinite(Date.parse(event.recorded_at)))fail('Invalid history recording timestamp');dateValue(event.occurred_at);
  }
 }
 return true;
}
export function serialize(m){
 const files={...m.files};for(const p of Object.keys(files))if(p==='index.md'||p==='archive/index.md'||/(?:section|project|stages|tasks)\.md$/.test(p)&&!p.includes('/history/'))delete files[p];
 files['index.md']=encode(m.index,'Lifegress index');
 if(m.catalog.entries.length||m.files['archive/index.md'])files['archive/index.md']=encode(m.catalog,'Archive locator');
 const groups={};for(const e of Object.values(m.entities))(groups[m.paths[e.id]]??=[]).push(e);
 for(const [path,records] of Object.entries(groups))files[path]=encode({schema:1,records},records.length===1?records[0].title:'Tasks and stages');
 return files;
}
function scope(m,id){let e=m.entities[id];while(e&&e.type!=='project'&&e.type!=='section')e=m.entities[e.parent_id];return e?dirname(m.paths[e.id]):'standalone';}
function addEvent(m,id,type,change,ctx,scopeOverride){
 const path=`${scopeOverride??scope(m,id)}/history/${ctx.recorded_at.slice(0,4)}.md`;
 const doc=m.files[path]?decode(m.files[path]):{schema:1,events:[]};
 doc.events.push({event_id:ctx.uuid(),entity_id:id,event_type:type,occurred_at:dateValue(ctx.occurred_at),recorded_at:ctx.recorded_at,actor:ctx.actor,source:ctx.source,...(ctx.contributor?{contributor:ctx.contributor}:{}),...(ctx.recordedBy?{recorded_by:ctx.recordedBy}:{}),change});
 // Derived completion is automatic, so it does not make the actor a contributor of the ancestor.
 if(ctx.contributor&&type!=='derived-completion'){
  if(!m.crew.members.some(c=>c.id===ctx.contributor)){m.crew.members.push({id:ctx.contributor,name:ctx.contributorName??(ctx.contributor==='owner'?'Owner':ctx.actor),kind:ctx.contributor==='owner'?'owner':'ai',avatar:null});m.files['crew.md']=encode(m.crew,'Crew');}
  const e=m.entities[id];if(e&&!(e.contributors||[]).includes(ctx.contributor))e.contributors=[...(e.contributors||[]),ctx.contributor];
 }m.files[path]=encode(doc,'History');
}
function rebuildRefs(m){for(const list of [m.index.children,...Object.values(m.entities).map(e=>e.children).filter(Boolean)])for(const r of list)if(m.entities[r.id])Object.assign(r,reference(m,r.id));}
function moveDirectory(m,oldDir,newDir){
 const prefix=oldDir+'/';if(Object.keys(m.files).some(p=>p.startsWith(newDir+'/')))fail('Destination exists; choose another placement');
 for(const p of Object.keys(m.files))if(p.startsWith(prefix)){m.files[newDir+p.slice(oldDir.length)]=m.files[p];delete m.files[p];}
 for(const [id,p]of Object.entries(m.paths))if(p.startsWith(prefix))m.paths[id]=newDir+p.slice(oldDir.length);
 for(const a of m.catalog.entries)if(a.archived_path.startsWith(prefix))a.archived_path=newDir+a.archived_path.slice(oldDir.length);
 rebuildRefs(m);
}
function insert(m,e,parent,position){const type=parent==null?'index':m.entities[parent]?.type;if(!allowed[type]?.includes(e.type))fail('Invalid parent type');e.parent_id=parent??null;const list=refs(m,parent);list.splice(position==null?list.length:Math.max(0,Math.min(position,list.length)),0,reference(m,e.id));}
function detach(m,e){const list=refs(m,e.parent_id),i=list.findIndex(x=>x.id===e.id);if(i<0)fail('Parent reference missing');list.splice(i,1);return i;}
function recordPath(m,type,id,parent){const p=parent==null?null:m.entities[parent];if(type==='section')return `sections/${id}/section.md`;if(type==='project')return `${dirname(m.paths[parent])}/projects/${id}/project.md`;if(type==='stage')return `${dirname(m.paths[parent])}/stages.md`;let dir='standalone';if(p)dir=p.type==='stage'?dirname(m.paths[p.parent_id]):dirname(m.paths[parent]);return dir+'/tasks.md';}
// Apply to a clone: a failed validation never mutates the caller's state.
export function transact(input,operations,options={}){
 validate(input);const m=clone(input);const ctx={recorded_at:new Date().toISOString(),occurred_at:null,actor:'Owner via Lifegress',contributor:'owner',source:'Owner-reviewed edit',uuid:()=>crypto.randomUUID(),...options};
 if(!/^\d{4}-\d{2}-\d{2}T/.test(ctx.recorded_at)||!Number.isFinite(Date.parse(ctx.recorded_at)))fail('Invalid recording timestamp');
 for(const op of operations){
  const before={};for(const e of Object.values(m.entities))if(e.type!=='task')before[e.id]=counts(m,e.id).status;
  let e=m.entities[op.id];const eventCtx={...ctx,occurred_at:dateValue(op.occurred_at??ctx.occurred_at)};
  // Profile and crew edits: name and avatar only; they do not touch records or History.
  if(op.kind==='crew'){
   const c=m.crew.members.find(x=>x.id===op.id);if(!c)fail('Unknown crew member '+op.id);
   if(op.name!=null){if(!String(op.name).trim())fail('Name cannot be empty');c.name=String(op.name).trim();}
   if(op.avatar!==undefined){if(op.avatar!==null&&!avatarPath(op.avatar))fail('Invalid avatar path');c.avatar=op.avatar;}
   m.files['crew.md']=encode(m.crew,'Crew');continue;
  }
  if(op.kind==='create'){
   if(e)fail('ID already exists');e={id:op.id,type:op.type,title:op.title,parent_id:op.parent_id??null,note:op.note||''};
   if(op.type==='task')e.status='Not Started';else e.children=[];
   m.entities[e.id]=e;m.paths[e.id]=recordPath(m,e.type,e.id,e.parent_id);insert(m,e,e.parent_id,op.position);addEvent(m,e.id,'created',{after:clone(e)},eventCtx);
  }else if(op.kind==='reorder'&&op.id==null){
   const old=m.index.children;if(!Array.isArray(op.ids)||new Set(op.ids).size!==old.length||op.ids.some(id=>!old.some(r=>r.id===id)))fail('Order must contain every top-level item once');
   m.index.children=op.ids.map(id=>old.find(r=>r.id===id));addEvent(m,'index','reordered',{before:old.map(r=>r.id),after:op.ids},eventCtx,'standalone');
  }else{
   if(!e)fail('Unknown entity');
   if(op.kind==='edit'){
    if(archived(m,e.id))fail('Restore before editing');const prior=clone(e);const fields=op.fields||{};
    for(const [key,value]of Object.entries(fields)){
     if(!['title','note','planned_completion','actual_completion','status'].includes(key))fail('Unsupported field');
     if(key==='status'&&e.type!=='task')fail('Only Task status is editable');
     e[key]=key.endsWith('_completion')?dateValue(value):value;
    }
    if(e.type==='task'&&e.status==='Completed'&&prior.status!=='Completed')e.actual_completion=dateValue(fields.actual_completion??eventCtx.occurred_at);
    if(JSON.stringify(prior)!==JSON.stringify(e))addEvent(m,e.id,'edited',{before:prior,after:clone(e)},eventCtx);
   }else if(op.kind==='reorder'){
    if(archived(m,e.id))fail('Restore before editing');const old=refs(m,e.id);if(!Array.isArray(op.ids)||new Set(op.ids).size!==old.length||op.ids.some(id=>!old.some(r=>r.id===id)))fail('Order must contain every direct child once');e.children=op.ids.map(id=>reference(m,id));addEvent(m,e.id,'reordered',{before:old.map(r=>r.id),after:op.ids},eventCtx);
   }else if(op.kind==='move'){
    if(archived(m,e.id)||op.parent_id!=null&&archived(m,op.parent_id))fail('Restore before moving');const previous={parent_id:e.parent_id,path:m.paths[e.id],position:detach(m,e)};
    if(op.parent_id===e.id||subtree(m,e.id).includes(op.parent_id))fail('Cannot move into own subtree');
    const nextPath=recordPath(m,e.type,e.id,op.parent_id);
    if(['section','project'].includes(e.type))moveDirectory(m,dirname(m.paths[e.id]),dirname(nextPath));
    else{m.paths[e.id]=nextPath;if(e.type==='stage')for(const id of subtree(m,e.id).slice(1))m.paths[id]=dirname(nextPath)+'/tasks.md';}
    insert(m,e,op.parent_id,op.position);rebuildRefs(m);addEvent(m,e.id,'moved',{before:previous,after:{parent_id:e.parent_id,path:m.paths[e.id]}},eventCtx);
   }else if(op.kind==='archive'){
    if(!['section','project'].includes(e.type)||archived(m,e.id))fail('Only active Sections and Projects can be archived');
    const oldPath=m.paths[e.id],position=detach(m,e),newDir=`archive/${e.type}s/${e.id}`;
    moveDirectory(m,dirname(oldPath),newDir);const entry={id:e.id,type:e.type,title:e.title,original_parent_id:e.parent_id??null,original_path:oldPath,archived_path:m.paths[e.id],position};m.catalog.entries.push(entry);addEvent(m,e.id,'archived',entry,eventCtx);
   }else if(op.kind==='restore'){
    const a=m.catalog.entries.find(x=>x.id===e.id);if(!a)fail('Restore the archived ancestor instead');
    const parent=Object.hasOwn(op,'parent_id')?op.parent_id:a.original_parent_id;
    if(parent!=null&&!m.entities[parent])fail('Original parent is missing; choose a destination');
    if(parent!=null&&archived(m,parent))fail('Restore the parent first or choose an active destination');
    const originalDir=dirname(a.original_path),leaf=originalDir.split('/').at(-1);
    const nextPath=e.type==='section'?a.original_path:`${dirname(m.paths[parent])}/projects/${leaf}/project.md`;moveDirectory(m,dirname(m.paths[e.id]),dirname(nextPath));m.catalog.entries=m.catalog.entries.filter(x=>x.id!==e.id);insert(m,e,parent,op.position??a.position);addEvent(m,e.id,'restored',{parent_id:parent,path:nextPath},eventCtx);
   }else if(op.kind==='delete'){
    if(op.confirm!==true)fail('Explicit cascade confirmation required; Git commits may retain earlier data');
    const ids=new Set(subtree(m,e.id));let grew=true;while(grew){grew=false;for(const a of m.catalog.entries)if(ids.has(a.original_parent_id)&&!ids.has(a.id)){for(const id of subtree(m,a.id))ids.add(id);grew=true;}}
    if(!m.catalog.entries.some(a=>a.id===e.id))detach(m,e);
    m.catalog.entries=m.catalog.entries.filter(a=>!ids.has(a.id));
    for(const id of ids){const x=m.entities[id];if(['section','project'].includes(x.type)){const dir=dirname(m.paths[id]);for(const path of Object.keys(m.files))if(path.startsWith(dir+'/'))delete m.files[path];}delete m.entities[id];delete m.paths[id];}
    for(const [path,text]of Object.entries(m.files))if(path.includes('/history/')){const doc=decode(text);doc.events=(doc.events||[]).filter(x=>!ids.has(x.entity_id));if(doc.source_context)doc.source_context=doc.source_context.filter(x=>!ids.has(x.entity_id));
     for(const event of doc.events){const raw=event.change?.original_markdown;if(raw)event.change.original_markdown=raw.split(/\n(?=- \*\*Event ID:)/).map(block=>block.startsWith('- **Event ID:')&&[...ids].some(id=>block.includes(id))?'':block.split('\n').filter(line=>!line.startsWith('|')||![...ids].some(id=>line.includes(id))).join('\n')).join('\n');}if(doc.events.length||doc.source_context?.length)m.files[path]=encode(doc,'History');else delete m.files[path];}
   }else fail('Unknown operation');
  }
  for(const x of Object.values(m.entities))if(x.type!=='task'&&before[x.id]!=='Completed'&&counts(m,x.id).status==='Completed'){
   if(x.type!=='section')x.actual_completion=null;
   addEvent(m,x.id,'derived-completion',{before:before[x.id]??null,after:'Completed',actual_completion:null},eventCtx);
  }
 }
 validate(m);m.files=serialize(m);return m;
}
export function diff(before,after){return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(path=>before[path]!==after[path]).map(path=>({path,before:before[path]??null,after:after[path]??null}));}
