import {credentialStore} from './credentials.mjs';
import {StoreV1} from './store-v1.mjs?v=023';
import {allowed,statuses,counts,transact,subtree,archived,decode,normalize,validate} from './data-v1.mjs';
let storage;try{storage=localStorage;}catch{}
// App version: V<major>.<release>. Increment the release part by one on every publication (see AGENTS.md).
const APP_VERSION='V000.023';
const credentials=credentialStore(storage),draftKey='lifegress:KidaJo/personal-hq:operations:v1',cacheKey='lifegress:KidaJo/personal-hq:cache:v1',avatarKey='lifegress:KidaJo/personal-hq:avatars:v1';
const $=s=>document.querySelector(s),content=$('#content'),nav=$('#desktop-workspaces nav');
$('#version').textContent=APP_VERSION;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,data='')=>`<button class="hq-action" data-action="${action}" ${data}>${label}</button>`;
const structural=o=>['archive','restore','move','delete'].includes(o.kind);
let store=null,base='',remoteBase='',model=null,view=null,selected=null,ops=[],busy=false,archiveView=false,profileView=false,remember=false,toastTimer=0,undoAction=null,editing=null,homeList=null;
// Save engine state: ops[0..locked) are being sent; later ops wait for the next round. assets are avatar uploads waiting for their crew op.
let locked=0,syncing=null,again=false,pendingUndo=null,assets=[],avatars={};
try{avatars=JSON.parse(storage?.getItem(avatarKey)||'{}')||{};}catch{}
// Phones and tablets are treated as personal devices and always remember the connection.
const personalDevice=matchMedia('(pointer:coarse)').matches;
const scroll=()=>$('#page-scroll');
// Messages also appear as a toast so they are never missed at the bottom of a long page.
function say(text){$('#hq-message').textContent=text;if(text)toast('notice',null,text);}
function save(){try{storage.setItem(draftKey,JSON.stringify({base,ops}));}catch{}}
function draftOps(){try{return JSON.parse(storage?.getItem(draftKey)||'null')?.ops||[];}catch{return [];}}
// Remembered devices keep the last loaded records (not History) so the next start can render before GitHub answers.
function saveCache(){if(!remember||!model)return;const files={};for(const [p,t] of Object.entries(model.files))if(!p.includes('/history/'))files[p]=t;try{storage.setItem(cacheKey,JSON.stringify({base:remoteBase,files}));}catch{}}
function clearCache(){try{storage.removeItem(cacheKey);storage.removeItem(avatarKey);}catch{}avatars={};}
// Save status toast: saving (info), saved (success, auto-hides, optional Undo), error (persistent, Retry/Discard).
// States: saving, saved (auto-hides, optional Undo), error (persistent, Retry/Discard), notice (an error message that auto-hides).
function toast(state,undo,text){clearTimeout(toastTimer);const t=$('#toast');if(!state){t.hidden=true;return;}
 const icon={saved:'circle-check',error:'triangle-alert',notice:'triangle-alert'}[state];
 t.className='lf-toast state-'+(state==='notice'?'error':state);t.hidden=false;
 t.innerHTML=`${state==='saving'?'<span class="lf-spinner" aria-hidden="true"></span>':`<span class="lf-icon lf-icon-${icon}" aria-hidden="true"></span>`}<span>${esc(text??{saving:'Saving…',saved:'Saved',error:'Couldn’t save.'}[state])}</span>${state==='saved'&&undo?button('undo','Undo'):''}${state==='error'?button('retry','Retry')+button('discard','Discard'):''}`;
 if(state==='saved')toastTimer=setTimeout(()=>toast(null),undo?6000:2500);
 if(state==='notice')toastTimer=setTimeout(()=>toast(null),6000);
 undoAction=undo||null;}
function closeMenu(){const d=$('#workspace-dialog');d.classList.remove('menu-expanded');$('#workspace-toggle').setAttribute('aria-expanded','false');setTimeout(()=>d.close(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:240);}
function loading(){content.innerHTML='<div class="lf-connect lf-loading"><span class="lf-spinner" aria-hidden="true"></span><p>Loading your workspace…</p></div>';nav.innerHTML='';$('#workspace-toggle').hidden=$('#header-profile').hidden=true;$('#version').textContent=APP_VERSION;}
function loggedOut(message=''){content.innerHTML=`<div class="lf-connect"><p class="lf-eyebrow">YOUR PERSONAL WORKSPACE</p><h2>Your projects.<br>Your progress.</h2>${message?`<p class="lf-notice">${esc(message)}</p>`:''}<label class="hq-field">Access token<input id="token" type="password" autocomplete="off"></label><p class="hq-small">A GitHub access token that can read and update your private Lifegress data. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create a token</a></p>${personalDevice?'':`<label class="lf-remember"><input id="remember" type="checkbox" ${remember?'checked':''}>Remember on this device</label>`}<p class="hq-small" id="connect-help">Enter your access token to continue.</p><button class="hq-action" data-action="connect" aria-describedby="connect-help" disabled>Connect to Lifegress</button></div>`;nav.innerHTML='';$('#workspace-toggle').hidden=$('#header-profile').hidden=true;$('#version').textContent=APP_VERSION;toast(null);}
function expired(message='Your access has expired. Enter a new token to continue.'){credentials.forget();clearCache();store=null;model=view=null;$('#workspace-dialog').close();loggedOut(message);}
async function run(fn){if(busy)return;busy=true;$('#hq-manual').setAttribute('aria-busy','true');try{await fn();}catch(e){if(e.status===401)expired();else say(e.message);}finally{busy=false;$('#hq-manual').setAttribute('aria-busy','false');}}
const icon=name=>`<span class="lf-icon lf-icon-${name}" aria-hidden="true"></span>`;
const iconButton=(action,name,label,data='')=>`<button class="lf-icon-button" data-action="${action}" aria-label="${label}" ${data}>${icon(name)}</button>`;
const statusIcon={'Not Started':'circle','In Progress':'circle-dot','Completed':'circle-check'};
function badge(status){const family=status==='Completed'?'complete':status==='In Progress'?'active':'neutral';return `<span class="hq-status state-${family}">${icon(statusIcon[status])}${esc(status)}</span>`;}
function stats(id){const e=view.entities[id];if(e.type==='task')return badge(e.status);const c=counts(view,id);return `<span class="hq-status">${!c.loaded?'Loading…':c.total?`${esc(c.status)} · ${Math.round(c.progress)}%`:'No tasks yet'}</span>`;}
function summary(id){const c=counts(view,id);return c.loaded&&c.total?`${c.completed} of ${c.total} ${c.total===1?'task':'tasks'} done`:'';}
// Crew: avatars (uploaded photo, else an initial on a brand tone) and the people who worked on a record and everything under it.
const member=id=>view?.crew?.members.find(c=>c.id===id);
// Initials are the fallback: shown until a photo has loaded, and kept if the photo fails (for example on a poor connection).
function avatar(id,size='sm'){const c=member(id),name=c?.name||id,src=c?.avatar&&avatars[c.avatar];const i=view?.crew?.members.findIndex(c=>c.id===id)??-1,tone=(i<0?[...id].reduce((a,ch)=>a+ch.charCodeAt(0),0):i)%5;return `<span class="lf-avatar lf-avatar-${size} lf-tone-${tone}${src?' has-photo':''}" role="img" aria-label="${esc(name)}">${esc(name.trim().charAt(0).toUpperCase()||'?')}${src?`<img src="${src}" alt="">`:''}</span>`;}
document.addEventListener('error',e=>{if(e.target.matches?.('.lf-avatar img')){e.target.parentElement.classList.remove('has-photo');e.target.remove();}},true);
function people(id){const out=[];const visit=key=>{const e=view.entities[key];if(!e)return;for(const c of e.contributors||[])if(!out.includes(c))out.push(c);for(const r of e.children||[])visit(r.id);};visit(id);return out;}
function crewRow(id){const list=people(id);return list.length?`<span class="lf-crew">${list.slice(0,5).map(c=>avatar(c)).join('')}${list.length>5?`<span class="lf-crew-more">+${list.length-5}</span>`:''}</span>`:'';}
function crewNames(id){const list=people(id);return list.length?`<div class="lf-crew-names">${list.map(c=>`<span class="lf-crew-name">${avatar(c)}<span>${esc(member(c)?.name||c)}</span></span>`).join('')}</div>`:'';}
// Display order only: unfinished items first, completed Tasks last. Stored order is unchanged.
const ordered=refs=>[...refs.filter(r=>view.entities[r.id]?.status!=='Completed'),...refs.filter(r=>view.entities[r.id]?.status==='Completed')];
function row(r){const e=view.entities[r.id];if(!e)return '<p>Loading…</p>';if(e.type==='task')return taskRow(e,e.note||'');const next=(e.children||[]).map(r=>view.entities[r.id]).find(t=>t?.type==='task'&&t.status!=='Completed')?.title;const sub=next||summary(e.id);return `<button class="hq-project" data-open="${esc(e.id)}"><span class="hq-project-info"><span class="hq-project-name">${esc(e.title)}</span>${sub?`<span class="hq-small">${esc(sub)}</span>`:''}${crewRow(e.id)}</span>${stats(e.id)}</button>`;}
function where(e){const names=[];let x=view.entities[e.parent_id];while(x){names.unshift(x.title);x=view.entities[x.parent_id];}return names.slice(-2).join(' · ');}
// Task rows: the checkbox saves Completed/Not Started immediately; the rest of the card opens the Task.
function taskRow(e,sub=where(e)){const done=e.status==='Completed',locked=archived(view,e.id);return `<div class="hq-project lf-task-row${done?' is-done':''}"><button class="lf-check" data-action="toggle" data-id="${esc(e.id)}" role="checkbox" aria-checked="${done}" aria-label="${esc(e.title)}" ${locked?'disabled':''}><span class="lf-box">${icon(done?'circle-check':'circle')}</span></button><button class="lf-task-open" data-open="${esc(e.id)}"><span class="hq-project-info"><span class="hq-project-name">${esc(e.title)}</span>${sub?`<span class="hq-small">${esc(sub)}</span>`:''}${crewRow(e.id)}</span>${e.status==='In Progress'?badge(e.status):''}</button></div>`;}
// Home focus: every active In Progress Task, plus the first Not Started Task of each active Project, in hierarchy order.
function focus(){const now=[],next=[];const walk=(refs,project)=>{for(const r of refs){const e=view.entities[r.id];if(!e||archived(view,e.id))continue;if(e.type!=='task'){walk(e.children||[],e.type==='project'?{picked:false}:project);continue;}if(e.status==='In Progress')now.push(e.id);else if(e.status==='Not Started'&&project&&!project.picked){project.picked=true;next.push(e.id);}}};walk(view.index.children,null);return {now,next};}
// Full dates show in the viewer's locale; partial dates (2026, 2026-10), including ones written by AI, show as recorded.
function showDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')?new Date(v+'T00:00:00Z').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}):v||'';}
// Date value with a transparent native date input on top: tapping opens the system picker and saves on change.
function datePicker(name,label,value,empty){const full=/^\d{4}-\d{2}-\d{2}$/.test(value||'');return `<label class="lf-date-value${value?'':' is-empty'}">${value?esc(showDate(value)):empty}<input type="date" data-date="${name}" value="${full?esc(value):''}" aria-label="${label}"></label>`;}
const prop=(label,body,extra='',cls='')=>`<div class="lf-prop${cls}"><span class="lf-prop-label">${label}</span><div class="lf-prop-value">${body}</div>${extra}</div>`;
function dateProp(name,label,value,editable){return editable?prop(label,datePicker(name,label,value,'Add date'),value?iconButton('clear-date','x','Clear '+label.toLowerCase()+' date',`data-date="${name}"`):''):prop(label,`<span class="lf-date-value">${value?esc(showDate(value)):'—'}</span>`);}
function editActions(){return `<div class="hq-bar lf-edit-actions"><button class="hq-action lf-primary" data-action="save-edit" disabled>Save</button><button class="hq-action" data-action="cancel-edit">Cancel</button></div>`;}
const addButton=(type,data='')=>`<button class="lf-add-chip" data-action="new" data-type="${type}" ${data}>${icon('plus')}<span>${type[0].toUpperCase()+type.slice(1)}</span></button>`;
function detail(e){
 const editable=!archived(view,e.id),parent=view.entities[e.parent_id],derived=e.type!=='task'?counts(view,e.id):null;
 const back=`<button class="lf-back" ${parent?`data-open="${esc(parent.id)}"`:'data-action="home"'}>${icon('arrow-left')}<span>${esc(parent?.title||'All projects')}</span></button>`;
 const title=editing==='title'?`<div class="lf-inline-edit"><input class="lf-title-input" data-edit="title" value="${esc(e.title)}" aria-label="Title">${editActions()}</div>`:`<div class="lf-title-row"><h2>${esc(e.title)}</h2>${editable?iconButton('edit','pencil','Edit title','data-edit="title"')+actionsMenu(e):''}</div>`;
 const status=e.type==='task'?`<div class="lf-segmented" role="group" aria-label="Status">${statuses.map(s=>`<button data-action="set-status" data-status="${esc(s)}" aria-pressed="${s===e.status}" ${editable?'':'disabled'}>${icon(statusIcon[s])}<span>${esc(s)}</span></button>`).join('')}</div>`:stats(e.id);
 let props='';
 if(e.type==='task')props=dateProp('planned_completion','Planned',e.planned_completion,editable)+dateProp('actual_completion','Completed',e.actual_completion,editable);
 else if(e.type!=='section'){
  props=e.planned_completion?dateProp('planned_completion','Planned',e.planned_completion,editable):editable?`<div class="lf-prop lf-prop-add">${datePicker('planned_completion','Planned date','',`${icon('plus')}<span>Planned date</span>`)}</div>`:'';
  if(e.actual_completion)props+=prop(derived.status==='Completed'?'Completed':'Last completed',`<span class="lf-date-value">${esc(showDate(e.actual_completion))}</span>`);}
 if(editing==='note')props+=prop('Note',`<textarea data-edit="note" aria-label="Note">${esc(e.note||'')}</textarea>${editActions()}`,'',' lf-prop-note');
 else if(e.note)props+=prop('Note',`<p>${esc(e.note)}</p>`,editable?iconButton('edit','pencil','Edit note','data-edit="note"'):'',' lf-prop-note');
 else if(editable)props+=`<div class="lf-prop lf-prop-add"><button class="lf-add" data-action="edit" data-edit="note">${icon('plus')}<span>Add note</span></button></div>`;
 const context=e.legacy?`<section class="lf-context"><h3>Context</h3><p>${esc(e.legacy.summary||e.legacy.detail||'')}</p><details><summary>More context</summary><pre>${esc(e.legacy.objective||'')}</pre><h3>Next actions</h3><pre>${esc(e.legacy.next_actions||'')}</pre><h3>Milestones</h3><pre>${esc(e.legacy.milestones||'')}</pre><pre>${esc(e.legacy.blockers||'')}</pre><p class="hq-small">${esc(e.confidence||e.legacy.confidence||'')} · Original descriptions retained as source context.</p></details></section>`:'';
 const list=e.type==='task'?'':childGroups(e.children||[],allowed[e.type],editable);
 return `${back}${title}${crewNames(e.id)}${status}<div id="manage-content"></div>${editable?'':'<p>Archived · restore before editing</p>'}${props?`<div class="lf-props">${props}</div>`:''}${context}${list}<details class="lf-history" data-id="${esc(e.id)}"><summary>History</summary><div id="history-content"><p class="hq-small">Loading…</p></div><p class="hq-small lf-record-id">Record ID ${esc(e.id)}</p></details>`;}
// Actions on the record itself live in the ⋯ menu beside the title; Delete is last, red, and asks again.
function actionsMenu(e){const arrange=[...(e.type!=='section'?[['move','Move to…']]:[]),...(e.children?.length>1?[['reorder','Reorder']]:[])],item=([a,l])=>`<button role="menuitem" data-action="${a}">${l}</button>`;
 return `<div class="lf-actions">${iconButton('actions-menu','ellipsis','More actions','aria-haspopup="menu" aria-expanded="false"')}<div class="lf-menu" role="menu" hidden>${arrange.map(item).join('')}${arrange.length?'<hr>':''}${['section','project'].includes(e.type)?item(['archive','Archive']):''}<button role="menuitem" class="lf-danger" data-action="delete">Delete</button></div></div>`;}
// Move picker: the workspace tree. Only valid parents can be chosen; the current place and the item's own branch are shown but disabled.
function movePicker(id){const entity=view.entities[id],inside=new Set(subtree(view,id)),current=entity.parent_id??null;
 const option=(dest,label,depth,ok,note='')=>`<button class="lf-tree-row lf-depth-${depth}" data-action="pick-dest" data-dest="${esc(dest??'')}" aria-pressed="false" ${ok?'':'disabled'}><span>${esc(label)}</span>${note?`<span class="hq-small">${note}</span>`:''}</button>`;
 const rows=[];const walk=(refs,depth)=>{for(const r of refs){const e=view.entities[r.id];if(!e||e.type==='task'||archived(view,e.id)||e.id===id)continue;const ok=allowed[e.type].includes(entity.type)&&!inside.has(e.id)&&e.id!==current;rows.push(option(e.id,e.title,depth,ok,e.id===current?'Current':''));walk(e.children||[],depth+1);}};
 if(allowed.index.includes(entity.type))rows.push(option(null,'Top level (no workspace)',0,current!==null,current===null?'Current':''));
 walk(view.index.children,0);
 return `<h3>Move “${esc(entity.title)}” to…</h3><div class="lf-tree" role="group" aria-label="Destination">${rows.join('')}</div><div class="hq-bar lf-edit-actions"><button class="hq-action lf-primary" data-action="apply-move" data-id="${esc(id)}" disabled>Move here</button><button class="hq-action" data-action="cancel-move">Cancel</button></div>`;}
function closeActions(){const m=content.querySelector('.lf-menu');if(m&&!m.hidden){m.hidden=true;content.querySelector('[data-action=actions-menu]')?.setAttribute('aria-expanded','false');}}
// History loads only when its block is opened.
async function loadHistory(id){model=await store.history(remoteBase,model,id);const events=Object.entries(model.files).filter(([p])=>p.includes('/history/')).flatMap(([,t])=>decode(t).events||[]);const ids=new Set(subtree(view,id));const box=content.querySelector('#history-content');if(box)box.innerHTML=events.filter(e=>ids.has(e.entity_id)||e.change?.original_markdown&&[...ids].some(id=>e.change.original_markdown.includes(id))).map(e=>`<article><strong>${esc(e.event_type)}</strong><p class="hq-small">${esc(e.actor||'')} · Occurred: ${esc(e.occurred_at||'Unknown')} · Recorded: ${esc(e.recorded_at||'Unknown')}</p><pre>${esc(e.change.original_markdown||JSON.stringify(e.change,null,2))}</pre></article>`).join('')||'<p class="hq-small">No history yet.</p>';}
// Containers and Tasks are listed in separate groups (Projects / Stages, then Tasks), each with its own add button,
// so a Stage card never sits between Task checkboxes. Completed items go to the end of each group.
const groupTitle={section:'Workspaces',project:'Projects',stage:'Stages',task:'Tasks'};
function childGroups(refs,types,editable){return types.map(type=>{const items=refs.filter(r=>view.entities[r.id]?.type===type),done=r=>view.entities[r.id]?.type==='task'?view.entities[r.id].status==='Completed':counts(view,r.id).status==='Completed';if(!items.length&&!editable)return '';
 return `<div class="lf-list-head"><h3>${groupTitle[type]}</h3>${editable?`<div class="lf-head-actions">${addButton(type)}</div>`:''}</div><div class="hq-list">${[...items.filter(r=>!done(r)),...items.filter(done)].map(row).join('')||`<p class="hq-small">No ${groupTitle[type].toLowerCase()} yet.</p>`}</div>`;}).join('');}
function photoButton(id,label){return `<label class="lf-add lf-file">${icon('plus')}<span>${label}</span><input type="file" accept="image/*" data-avatar-for="${esc(id)}"></label>`;}
function profile(){const me=member('owner')||{id:'owner',name:'Owner'},count=id=>Object.values(view.entities).filter(e=>(e.contributors||[]).includes(id)).length;
 const name=editing==='owner-name'?`<input class="lf-title-input" data-edit="name" value="${esc(me.name)}" aria-label="Your name">${editActions()}`:`<div class="lf-name-row"><h3>${esc(me.name)}</h3>${iconButton('edit','pencil','Edit name','data-edit="owner-name"')}</div>`;
 const crew=view.crew.members.filter(c=>c.id!=='owner').map(c=>`<div class="hq-project lf-crew-row">${avatar(c.id,'md')}<span class="hq-project-info"><span class="hq-project-name">${esc(c.name)}</span><span class="hq-small">${count(c.id)?`Worked on ${count(c.id)} ${count(c.id)===1?'item':'items'}`:'No updates yet'}</span></span></div>`).join('');
 return `<h2>Profile</h2><section class="lf-profile">${avatar('owner','lg')}<div class="lf-profile-info">${name}${photoButton('owner',me.avatar?'Change photo':'Add photo')}</div></section><div class="lf-list-head"><h3>My Crew</h3></div><p class="hq-small">AI collaborators join automatically when they first update your data. Their names and photos are fixed.</p><div class="hq-list">${crew||'<p class="hq-small">No collaborators yet.</p>'}</div>`;}
function render(){
 if(!store||!view)return;$('#workspace-toggle').hidden=false;
 const me=member('owner');$('#menu-profile').innerHTML=`${avatar('owner','md')}<span>${esc(me?.name||'Profile')}</span>`;
 // iPad / desktop: the Owner's photo alone sits at the right of the header and opens Profile.
 const hp=$('#header-profile');hp.hidden=false;hp.innerHTML=avatar('owner','md');hp.setAttribute('aria-label',`Profile · ${me?.name||'Owner'}`);hp.setAttribute('aria-pressed',String(profileView));
 let activeSection=view.entities[selected];while(activeSection&&activeSection.type!=='section')activeSection=view.entities[activeSection.parent_id];
 const sections=view.index.children.filter(r=>r.type==='section'),home=!selected&&!profileView&&!archiveView;
 // Navigation tree: "All projects" is the root and opens the home page; workspaces are indented under it; Archive stays apart.
 nav.innerHTML=`<button class="lf-nav-root" data-action="home" aria-pressed="${home}">All projects</button>`+sections.map(r=>`<button class="lf-nav-child" data-open="${esc(r.id)}" aria-pressed="${activeSection?.id===r.id}">${esc(view.entities[r.id]?.title||r.id)}</button>`).join('')+`<button class="lf-nav-archive" data-action="archive-list" aria-pressed="${archiveView}">Archive</button>`;$('#mobile-workspaces').innerHTML=nav.innerHTML;
 const e=view.entities[selected];
 if(profileView)content.innerHTML=profile();
 else if(archiveView){content.innerHTML=`<h2>Archive</h2><p class="hq-small">Excluded from active Section progress. Restore to resume editing.</p>${view.catalog.entries.map(a=>`<div class="hq-project"><span>${esc(a.title||a.id)}</span>${button('restore','Restore',`data-id="${esc(a.id)}"`)}${button('delete','Delete',`data-id="${esc(a.id)}"`)}</div>`).join('')||'<p>No archived items.</p>'}<div id="manage-content"></div>`;return;}
 // Home keeps the Now / Up next list it opened with, so a Task checked here stays visible until the next visit.
 else if(!e){homeList??=focus();const pick=ids=>ids.map(id=>view.entities[id]).filter(x=>x&&!archived(view,x.id));const group=(title,list)=>list.length?`<section class="lf-focus"><h3>${title}</h3><div class="hq-list">${list.map(x=>taskRow(x)).join('')}</div></section>`:'';content.innerHTML=`<div class="lf-page-head"><h2>All projects</h2><div class="lf-head-actions">${addButton('section')}${addButton('task')}</div></div>${group('Now',pick(homeList.now))}${group('Up next',pick(homeList.next))}${childGroups(view.index.children,['section','task'],false)}`;}
 else content.innerHTML=detail(e);
 const input=content.querySelector('[data-edit]:not(button)');if(input){input.focus();if(input.tagName==='INPUT')input.select();}
}
function preview(){view=ops.length?transact(model,ops):structuredClone(model);render();}
async function load(){const data=await store.load();base=remoteBase=data.base;if(!syncing){ops=draftOps().filter(o=>!(o.kind==='crew'&&o.avatar&&!assets.some(a=>a.path===o.avatar)));locked=0;}model=await store.active(base,data.model);if(ops.some(structural))model=await store.archives(base,model,true);homeList=null;try{preview();}catch{ops=[];save();preview();}saveCache();loadAvatars();if(ops.length)await scheduleSync();}
async function loadAvatars(){const need=[...new Set(view.crew.members.map(c=>c.avatar).filter(p=>p&&!avatars[p]))];if(!need.length)return;await Promise.all(need.map(async p=>{try{avatars[p]=await store.avatar(remoteBase,p);}catch{}}));const keep={};for(const c of view.crew.members)if(c.avatar&&avatars[c.avatar])keep[c.avatar]=avatars[c.avatar];avatars=keep;if(remember)try{storage.setItem(avatarKey,JSON.stringify(avatars));}catch{}render();}
async function open(id){selected=id;editing=null;archiveView=profileView=false;homeList=null;closeMenu();if(model.entities[id])model=await store.branch(remoteBase,model,id);preview();scroll().scrollTo({top:0});}
// Stage a change locally and redraw at once. Only ops that are not already being sent can be merged.
function stage(op){const sent=ops.slice(0,locked);let rest=[...ops.slice(locked),op];
 if(op.kind==='edit'){
  const lastStructure=rest.findLastIndex(o=>o.kind!=='edit');
  const prefix=rest.slice(0,lastStructure+1),edits=rest.slice(lastStructure+1),merged=[];
  for(const item of edits){const previous=merged.find(o=>o.id===item.id);if(previous)Object.assign(previous.fields,item.fields);else merged.push(structuredClone(item));}
  const origin=transact(model,[...sent,...prefix]);
  for(const item of merged)for(const key of Object.keys(item.fields)){const value=item.fields[key];if((value===''&&key.endsWith('_completion')?null:value)===(origin.entities[item.id]?.[key]??(key==='note'?'':null)))delete item.fields[key];}
  rest=[...prefix,...merged.filter(o=>Object.keys(o.fields).length)];
 }
 const next=[...sent,...rest];view=transact(model,next);ops=next;save();if(selected&&!view.entities[selected])selected=null;render();}
async function queue(op){model=await store.active(base,model);if(structural(op))model=await store.archives(base,model,true);stage(op);}
// Save pending changes to GitHub. If GitHub moved on (another device or an AI), re-apply the changes on the latest version first.
async function sync(undo){if(!ops.length)return true;locked=ops.length;const sending=ops.slice(0,locked),photo=sending.some(o=>o.kind==='crew'&&o.avatar);toast('saving',null,photo?'Uploading photo…':null);try{
  const data=await store.load();if(data.base!==base){let m=await store.active(data.base,data.model);if(sending.some(structural))m=await store.archives(data.base,m,true);transact(m,sending);model=m;base=remoteBase=data.base;}
  let review;try{review=await store.prepare(base,model,sending);}catch(e){if(e.message!=='No changes to review')throw e;}
  const crewOps=sending.filter(o=>o.kind==='crew'&&o.avatar),uploads=assets.filter(a=>crewOps.some(o=>o.avatar===a.path));
  if(review){review.assets=[...uploads.map(a=>({path:a.path,base64:a.dataUrl.split(',')[1]})),...crewOps.filter(o=>o.previousAvatar&&o.previousAvatar!==o.avatar).map(o=>({path:o.previousAvatar,base64:null}))];const result=await store.commit(review);base=remoteBase=result.base;model=review.model;}
  for(const a of uploads)avatars[a.path]=a.dataUrl;assets=assets.filter(a=>!uploads.includes(a));
  ops=ops.slice(locked);locked=0;save();saveCache();preview();if(ops.length)toast('saving');else toast('saved',undo,photo?'Photo updated':null);return true;
 }catch(e){locked=0;if(e.status===401){expired();return false;}toast('error',null,photo?'Couldn’t upload the photo.':null);return false;}}
// One save at a time; changes made while saving are sent right after, so quick taps are never dropped.
function scheduleSync(undo){pendingUndo=undo;if(syncing){again=true;return syncing;}syncing=(async()=>{try{let ok;do{again=false;ok=await sync(pendingUndo);}while(ok&&again&&ops.length);}finally{syncing=null;}})();return syncing;}
async function apply(op,undo){await queue(op);await scheduleSync(undo);}
function change(op,undo){try{stage(op);}catch(e){say(e.message);return;}scheduleSync(undo);}
async function deleteEntity(id){model=await store.active(base,model);model=await store.archives(base,model,true);preview();const ids=new Set(subtree(view,id));let more=true;while(more){more=false;for(const a of view.catalog.entries)if(ids.has(a.original_parent_id)&&!ids.has(a.id)){subtree(view,a.id).forEach(x=>ids.add(x));more=true;}}if(confirm(`Delete ${view.entities[id].title} and ${ids.size-1} descendants, including their history? Earlier Git commits may still retain this data.`))await apply({kind:'delete',id,confirm:true});}
// Photo crop: a square frame with a round guide. Drag to move, pinch / scroll / slider to zoom, then the chosen square
// is drawn at 256×256 JPEG on this device, so any size of original works.
const crop={img:null,url:'',who:'',zoom:1,x:0,y:0,pointers:new Map(),pinch:0};
function cropFrame(){return $('#crop-frame').getBoundingClientRect().width;}
function cropLayout(){const v=cropFrame(),{img}=crop,s=v/Math.min(img.naturalWidth,img.naturalHeight)*crop.zoom,w=img.naturalWidth*s,h=img.naturalHeight*s;crop.x=Math.min(0,Math.max(v-w,crop.x));crop.y=Math.min(0,Math.max(v-h,crop.y));const el=$('#crop-image');el.style.width=w+'px';el.style.height=h+'px';el.style.transform=`translate(${crop.x}px,${crop.y}px)`;}
function cropZoom(zoom,cx=cropFrame()/2,cy=cropFrame()/2){const next=Math.min(4,Math.max(1,zoom)),k=next/crop.zoom;crop.x=cx-(cx-crop.x)*k;crop.y=cy-(cy-crop.y)*k;crop.zoom=next;$('#crop-zoom').value=String(next);cropLayout();}
async function openCrop(file,who){const url=URL.createObjectURL(file),img=new Image();img.src=url;try{await img.decode();}catch{URL.revokeObjectURL(url);say(/heic|heif/i.test(file.type+file.name)?'This browser can’t open HEIC photos. Choose a JPEG or PNG, or use Safari.':'That image couldn’t be opened. Choose a JPEG or PNG.');return;}
 Object.assign(crop,{img,url,who,zoom:1,x:0,y:0});crop.pointers.clear();$('#crop-image').src=url;$('#crop-zoom').value='1';$('#crop-dialog').showModal();const v=cropFrame(),s=v/Math.min(img.naturalWidth,img.naturalHeight);crop.x=(v-img.naturalWidth*s)/2;crop.y=(v-img.naturalHeight*s)/2;cropLayout();}
function closeCrop(){$('#crop-dialog').close();if(crop.url)URL.revokeObjectURL(crop.url);crop.img=null;crop.url='';}
function useCrop(){const v=cropFrame(),s=v/Math.min(crop.img.naturalWidth,crop.img.naturalHeight)*crop.zoom,c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d').drawImage(crop.img,-crop.x/s,-crop.y/s,v/s,v/s,0,0,256,256);const dataUrl=c.toDataURL('image/jpeg',0.85),who=crop.who;closeCrop();
 const path=`assets/avatars/${who}-${Date.now().toString(36)}.jpg`;avatars[path]=dataUrl;assets.push({path,dataUrl});change({kind:'crew',id:who,avatar:path,previousAvatar:member(who)?.avatar||null});}
document.body.insertAdjacentHTML('beforeend',`<dialog id="crop-dialog" class="lf-crop" aria-labelledby="crop-title"><h2 id="crop-title">Choose photo</h2><p class="lf-crop-hint">Drag to move. Pinch or use the slider to zoom.</p><div id="crop-frame" class="lf-crop-frame"><img id="crop-image" alt="" draggable="false"><span class="lf-crop-guide" aria-hidden="true"></span></div><label class="lf-crop-zoom"><span class="lf-icon lf-icon-zoom-out" aria-hidden="true"></span><input id="crop-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><span class="lf-icon lf-icon-zoom-in" aria-hidden="true"></span></label><div class="lf-crop-actions"><button class="hq-action" id="crop-cancel">Cancel</button><button class="hq-action lf-primary" id="crop-use">Use photo</button></div></dialog>`);
$('#crop-cancel').onclick=closeCrop;$('#crop-use').onclick=useCrop;$('#crop-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCrop();});
$('#crop-zoom').oninput=e=>cropZoom(Number(e.target.value));
$('#crop-frame').addEventListener('wheel',e=>{e.preventDefault();const r=$('#crop-frame').getBoundingClientRect();cropZoom(crop.zoom*(e.deltaY<0?1.08:1/1.08),e.clientX-r.left,e.clientY-r.top);},{passive:false});
$('#crop-frame').addEventListener('pointerdown',e=>{$('#crop-frame').setPointerCapture(e.pointerId);crop.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(crop.pointers.size===2){const [a,b]=[...crop.pointers.values()];crop.pinch=Math.hypot(a.x-b.x,a.y-b.y);}});
$('#crop-frame').addEventListener('pointermove',e=>{const prev=crop.pointers.get(e.pointerId);if(!prev)return;crop.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(crop.pointers.size===2){const [a,b]=[...crop.pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y),r=$('#crop-frame').getBoundingClientRect();if(crop.pinch)cropZoom(crop.zoom*d/crop.pinch,(a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top);crop.pinch=d;}
 else{crop.x+=e.clientX-prev.x;crop.y+=e.clientY-prev.y;cropLayout();}});
for(const type of ['pointerup','pointercancel'])$('#crop-frame').addEventListener(type,e=>{crop.pointers.delete(e.pointerId);crop.pinch=0;});
// A picked date or photo saves immediately; title, note and name edits wait for Save.
content.addEventListener('change',e=>{
 const name=e.target.dataset.date;if(name){const id=selected,previous=view.entities[id][name]??'';change({kind:'edit',id,fields:{[name]:e.target.value}},{kind:'edit',id,fields:{[name]:previous}});return;}
 const who=e.target.dataset.avatarFor,file=e.target.files?.[0];if(who&&file){e.target.value='';openCrop(file,who);}});
content.addEventListener('click',e=>{if(e.target.matches?.('input[type=date]'))try{e.target.showPicker();}catch{}});
const editingValue=()=>editing==='owner-name'?member('owner')?.name||'':view.entities[selected]?.[editing]||'';
content.addEventListener('input',e=>{if(e.target.dataset.edit&&!(e.target instanceof HTMLButtonElement)){const save=content.querySelector('[data-action=save-edit]');if(save)save.disabled=e.target.value===editingValue()||e.target.tagName==='INPUT'&&!e.target.value.trim();}if(e.target.id==='token')content.querySelector('[data-action=connect]').disabled=!e.target.value.trim();});
content.addEventListener('toggle',e=>{if(e.target.classList?.contains('lf-history')&&e.target.open)run(()=>loadHistory(e.target.dataset.id));},true);
content.addEventListener('keydown',e=>{if(e.key==='Escape')closeActions();if(e.key==='Enter'&&e.target.id==='token'&&e.target.value.trim())content.querySelector('[data-action=connect]').click();if(e.target.dataset?.edit&&!(e.target instanceof HTMLButtonElement)){if(e.key==='Escape'){editing=null;render();}else if(e.key==='Enter'&&(e.target.tagName==='INPUT'||e.metaKey||e.ctrlKey)){e.preventDefault();content.querySelector('[data-action=save-edit]:not(:disabled)')?.click();}}});
document.addEventListener('click',event=>{if(!event.target.closest('.lf-actions'))closeActions();const b=event.target.closest('button');if(!b)return;const a=b.dataset.action,id=b.dataset.id||selected;
 // Saving happens in the background, so checking Tasks, Undo and Retry stay available while busy.
 if(a==='toggle'){const task=view.entities[id],previous=task.status,status=previous==='Completed'?'Not Started':'Completed';change({kind:'edit',id,fields:{status}},{kind:'edit',id,fields:{status:previous}});return;}
 if(a==='undo'&&undoAction){const op=undoAction;toast(null);change(op);return;}
 if(a==='retry'){scheduleSync();return;}
 if(a==='actions-menu'){const m=b.parentElement.querySelector('.lf-menu');m.hidden=!m.hidden;b.setAttribute('aria-expanded',String(!m.hidden));return;}
 if(b.closest('.lf-menu'))closeActions();
 if(busy)return;if(b.dataset.open){run(()=>open(b.dataset.open));return;}
 if(a==='home'){selected=null;archiveView=profileView=false;homeList=null;editing=null;closeMenu();render();scroll().scrollTo({top:0});}
 if(a==='profile'){selected=null;archiveView=false;profileView=true;editing=null;closeMenu();render();scroll().scrollTo({top:0});}
 if(a==='connect')run(async()=>{const token=$('#token').value.trim();if(!token)return;remember=personalDevice||$('#remember').checked;loading();store=new StoreV1(token);try{await load();}catch(e){store=null;loggedOut(e.status===401?'That token didn’t work. Check it and try again.':'Unable to connect. Try again.');return;}if(remember)credentials.remember(token);else{credentials.forget();clearCache();}say('');});
 if(a==='new')run(async()=>{const type=b.dataset.type,title=prompt(`New ${type} name`);if(!title?.trim())return;await apply({kind:'create',type,id:type.toUpperCase()+'-'+crypto.randomUUID(),title:title.trim(),parent_id:selected});});
 if(a==='archive')run(async()=>{if(confirm('Archive this entire subtree? Progress remains recorded and you can restore it later.')){await apply({kind:'archive',id});selected=null;render();}});
 if(a==='archive-list')run(async()=>{model=await store.archives(remoteBase,model);archiveView=true;profileView=false;closeMenu();preview();});
 if(a==='restore')run(async()=>{model=await store.active(base,model);model=await store.archives(base,model,true);preview();const entry=view.catalog.entries.find(a=>a.id===id),parent=entry.original_parent_id;try{await apply({kind:'restore',id,parent_id:parent});}catch(error){if(view.entities[id].type!=='project')throw error;const choices=Object.values(view.entities).filter(e=>e.type==='section'&&!archived(view,e.id));$('#manage-content').innerHTML=`<h3>Choose a restore destination</h3><p>${esc(error.message)}</p><label class="hq-field">Section<select id="destination">${choices.map(e=>`<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}</select></label>${button('apply-restore','Restore here',`data-id="${esc(id)}"`)}`;}});
 if(a==='apply-restore')run(()=>apply({kind:'restore',id,parent_id:$('#destination').value}));
 if(a==='delete')run(()=>deleteEntity(id));
 if(a==='move')run(async()=>{model=await store.active(base,model);preview();content.querySelector('#manage-content').innerHTML=movePicker(id);content.querySelector('#manage-content').scrollIntoView({block:'nearest'});});
 if(a==='pick-dest'){for(const x of content.querySelectorAll('.lf-tree button'))x.setAttribute('aria-pressed',String(x===b));const go=content.querySelector('[data-action=apply-move]');go.disabled=false;go.dataset.dest=b.dataset.dest;}
 if(a==='cancel-move')content.querySelector('#manage-content').innerHTML='';
 if(a==='apply-move')run(()=>apply({kind:'move',id,parent_id:b.dataset.dest||null}));
 if(a==='reorder'){$('#manage-content').innerHTML=`<h3>Display order</h3>${view.entities[id].children.map((r,i)=>`<div class="hq-bar"><span>${esc(view.entities[r.id]?.title||r.id)}</span>${i?button('move-up','Move up',`data-child="${esc(r.id)}"`):''}</div>`).join('')}`;}
 if(a==='move-up')run(async()=>{const ids=view.entities[selected].children.map(r=>r.id),i=ids.indexOf(b.dataset.child);if(i>0){[ids[i-1],ids[i]]=[ids[i],ids[i-1]];await apply({kind:'reorder',id:selected,ids});}});
 if(a==='discard')run(async()=>{ops=[];locked=0;assets=[];save();toast(null);await load();});
 if(a==='edit'){editing=b.dataset.edit;render();}
 if(a==='cancel-edit'){editing=null;render();}
 if(a==='save-edit'){const field=editing,value=content.querySelector('[data-edit]:not(button)').value;if(content.querySelector('[data-edit]:not(button)').tagName==='INPUT'&&!value.trim())return;editing=null;if(field==='owner-name')change({kind:'crew',id:'owner',name:value.trim()});else change({kind:'edit',id:selected,fields:{[field]:field==='title'?value.trim():value}});}
 if(a==='set-status'&&b.getAttribute('aria-pressed')!=='true'){const previous=view.entities[selected].status;change({kind:'edit',id:selected,fields:{status:b.dataset.status}},{kind:'edit',id:selected,fields:{status:previous}});}
 if(a==='clear-date'){const name=b.dataset.date,previous=view.entities[selected][name]??'';change({kind:'edit',id:selected,fields:{[name]:''}},{kind:'edit',id:selected,fields:{[name]:previous}});}
});
$('#home').onclick=()=>{if(busy)return;selected=null;archiveView=profileView=false;homeList=null;editing=null;if(store&&view)render();else if(!store)loggedOut();};
// The menu opens without moving focus onto the logo, which looked like a selected state.
$('#workspace-toggle').onclick=()=>{if(busy)return;const d=$('#workspace-dialog');d.showModal();document.activeElement?.blur();$('#workspace-toggle').setAttribute('aria-expanded','true');requestAnimationFrame(()=>requestAnimationFrame(()=>d.classList.add('menu-expanded')));};
$('#close-workspaces').onclick=closeMenu;$('#workspace-dialog').addEventListener('cancel',e=>{e.preventDefault();closeMenu();});
// The phone menu and the iPad / desktop sidebar share these actions.
for(const id of ['refresh','side-refresh'])$('#'+id).onclick=()=>run(async()=>{closeMenu();await load();});
for(const id of ['forget','logout','side-forget','side-logout'])$('#'+id).onclick=()=>{if(busy)return;credentials.forget();clearCache();store=null;model=view=null;remember=false;closeMenu();loggedOut('This device no longer remembers your access.');};
// Remembered devices show the last saved workspace at once, then refresh from GitHub in the background.
const savedToken=credentials.read();
if(!savedToken)loggedOut();
else{store=new StoreV1(savedToken);remember=true;let cached=null;try{cached=JSON.parse(storage?.getItem(cacheKey)||'null');}catch{}
 if(cached?.base&&cached.files)try{store.seed(cached.base,cached.files);model=normalize(cached.files);validate(model);base=remoteBase=cached.base;ops=draftOps();preview();}catch{model=view=null;}
 if(!view)loading();
 load().catch(e=>{if(e.status===401)expired();else if(!view){store=null;loggedOut('Unable to connect. Try again.');}else say('Showing saved data. Refresh to try again.');});}
