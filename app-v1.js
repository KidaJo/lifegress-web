import {credentialStore} from './credentials.mjs';
import {StoreV1} from './store-v1.mjs?v=027';
import {allowed,statuses,counts,transact,subtree,archived,decode,normalize,validate,eventContributor} from './data-v1.mjs';
let storage;try{storage=localStorage;}catch{}
// App version: V<major>.<release>. Increment the release part by one on every publication (see AGENTS.md).
const APP_VERSION='V000.027';
const credentials=credentialStore(storage),draftKey='lifegress:KidaJo/personal-hq:operations:v1',cacheKey='lifegress:KidaJo/personal-hq:cache:v1',avatarKey='lifegress:KidaJo/personal-hq:avatars:v1';
const $=s=>document.querySelector(s),content=$('#content'),nav=$('#desktop-workspaces nav');
$('#version').textContent=$('#menu-version').textContent=$('#side-version').textContent=APP_VERSION;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,data='')=>`<button class="hq-action" data-action="${action}" ${data}>${label}</button>`;
const structural=o=>['archive','restore','move','delete'].includes(o.kind);
let store=null,base='',remoteBase='',model=null,view=null,selected=null,ops=[],busy=false,archiveView=false,profileView=false,remember=false,toastTimer=0,undoAction=null,editing=null,homeList=null,searchView=false,searchText='';
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
 const icon={saved:'circle-check',error:'triangle-alert',notice:'triangle-alert',offline:'wifi-off'}[state];
 t.className='lf-toast state-'+(state==='notice'?'error':state);t.hidden=false;
 t.innerHTML=`${state==='saving'?'<span class="lf-spinner" aria-hidden="true"></span>':`<span class="lf-icon lf-icon-${icon}" aria-hidden="true"></span>`}<span>${esc(text??{saving:'Saving…',saved:'Saved',error:'Couldn’t save.'}[state])}</span>${state==='saved'&&undo?button('undo','Undo'):''}${state==='error'?button('retry','Retry')+button('discard','Discard'):''}`;
 if(state==='saved')toastTimer=setTimeout(()=>toast(null),undo?6000:2500);
 if(state==='notice')toastTimer=setTimeout(()=>toast(null),6000);
 undoAction=undo||null;}
function closeMenu(){const d=$('#workspace-dialog');d.classList.remove('menu-expanded');$('#workspace-toggle').setAttribute('aria-expanded','false');setTimeout(()=>d.close(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:240);}
// Loading shows the centered splash (logo, slogan, status) over the whole app until the workspace or login screen is ready.
const splash=show=>{$('#splash').hidden=!show;};
function loading(){splash(true);content.innerHTML='';nav.innerHTML='';$('#workspace-toggle').hidden=$('#header-profile').hidden=$('#header-search').hidden=true;$('#version').textContent=APP_VERSION;}
function loggedOut(message=''){splash(false);searchView=false;$('.hq-top').classList.remove('is-searching');$('#search-bar').hidden=true;$('#fab').hidden=true;content.innerHTML=`<div class="lf-connect"><p class="lf-eyebrow">YOUR PERSONAL WORKSPACE</p><h2>Your projects.<br>Your progress.</h2>${message?`<p class="lf-notice">${esc(message)}</p>`:''}<label class="hq-field">Access token<input id="token" type="password" autocomplete="off"></label><p class="hq-small">A GitHub access token that can read and update your private Lifegress data. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create a token</a></p>${personalDevice?'':`<label class="lf-remember"><input id="remember" type="checkbox" ${remember?'checked':''}>Remember on this device</label>`}<p class="hq-small" id="connect-help">Enter your access token to continue.</p><button class="hq-action" data-action="connect" aria-describedby="connect-help" disabled>Connect to Lifegress</button></div>`;nav.innerHTML='';$('#workspace-toggle').hidden=$('#header-profile').hidden=$('#header-search').hidden=true;$('#version').textContent=APP_VERSION;toast(null);}
function expired(message='Your access has expired. Enter a new token to continue.'){credentials.forget();clearCache();store=null;model=view=null;$('#workspace-dialog').close();loggedOut(message);}
async function run(fn){if(busy)return;busy=true;$('#hq-manual').setAttribute('aria-busy','true');try{await fn();}catch(e){if(e.status===401)expired();else say(e.message);}finally{busy=false;$('#hq-manual').setAttribute('aria-busy','false');}}
const icon=name=>`<span class="lf-icon lf-icon-${name}" aria-hidden="true"></span>`;
const iconButton=(action,name,label,data='')=>`<button class="lf-icon-button" data-action="${action}" aria-label="${label}" title="${label}" ${data}>${icon(name)}</button>`;
const statusIcon={'Not Started':'circle','In Progress':'circle-dot','Completed':'circle-check'};
function badge(status){const family=status==='Completed'?'complete':status==='In Progress'?'active':'neutral';return `<span class="hq-status state-${family}">${icon(statusIcon[status])}${esc(status)}</span>`;}
function stats(id){const e=view.entities[id];if(e.type==='task')return badge(e.status);const c=counts(view,id);const family=!c.loaded||!c.total?'neutral':c.status==='Completed'?'complete':c.status==='In Progress'?'active':'neutral';return `<span class="hq-status state-${family}">${!c.loaded?'Loading…':c.total?`${esc(c.status)} · ${Math.round(c.progress)}%`:'No tasks yet'}</span>`;}
function summary(id){const c=counts(view,id);return c.loaded&&c.total?`${c.completed} of ${c.total} ${c.total===1?'task':'tasks'} done`:'';}
// Crew: avatars (uploaded photo, else an initial on a brand tone) and the people who worked on a record and everything under it.
const member=id=>view?.crew?.members.find(c=>c.id===id);
// Initials are the fallback: shown until a photo has loaded, and kept if the photo fails (for example on a poor connection).
function avatar(id,size='sm'){const c=member(id),name=c?.name||id,src=c?.avatar&&avatars[c.avatar];const i=view?.crew?.members.findIndex(c=>c.id===id)??-1,tone=(i<0?[...id].reduce((a,ch)=>a+ch.charCodeAt(0),0):i)%5;return `<span class="lf-avatar lf-avatar-${size} lf-tone-${tone}${src?' has-photo':''}" role="img" aria-label="${esc(name)}">${esc(name.trim().charAt(0).toUpperCase()||'?')}${src?`<img src="${src}" alt="">`:''}</span>`;}
// Owner decision: no pinch zoom in the app (Safari ignores the viewport setting, so block its gesture events too).
for(const type of ['gesturestart','gesturechange'])document.addEventListener(type,e=>e.preventDefault(),{passive:false});
document.addEventListener('error',e=>{if(e.target.matches?.('.lf-avatar img')){e.target.parentElement.classList.remove('has-photo');e.target.remove();}},true);
function people(id){const out=[];const visit=key=>{const e=view.entities[key];if(!e)return;for(const c of e.contributors||[])if(!out.includes(c))out.push(c);for(const r of e.children||[])visit(r.id);};visit(id);return out.includes('owner')?['owner',...out.filter(c=>c!=='owner')]:out;}
function crewRow(id){const list=people(id);return list.length?`<span class="lf-crew">${list.slice(0,5).map(c=>avatar(c)).join('')}${list.length>5?`<span class="lf-crew-more">+${list.length-5}</span>`:''}</span>`:'';}
function crewNames(id){const list=people(id);return list.length?`<div class="lf-crew-names">${list.map(c=>`<span class="lf-crew-name">${avatar(c)}<span>${esc(member(c)?.name||c)}</span></span>`).join('')}</div>`:'';}
// Display order only: unfinished items first, completed Tasks last. Stored order is unchanged.
const ordered=refs=>[...refs.filter(r=>view.entities[r.id]?.status!=='Completed'),...refs.filter(r=>view.entities[r.id]?.status==='Completed')];
// Planned dates on cards: "Due Nov 15", or "Overdue · Oct 30" once passed. Partial dates (2026-10) count until their last day.
const todayKey=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
const dateEnd=v=>/^\d{4}$/.test(v)?v+'-12-31':/^\d{4}-\d{2}$/.test(v)?new Date(Date.UTC(+v.slice(0,4),+v.slice(5,7),0)).toISOString().slice(0,10):String(v).slice(0,10);
function dueChip(e){const v=e.planned_completion;if(!v||isDone(e.id))return '';const late=dateEnd(v)<todayKey();return `<span class="lf-due${late?' is-late':''}">${icon('calendar')}${late?'Overdue · ':'Due '}${esc(showDate(v))}</span>`;}
function row(r){const e=view.entities[r.id];if(!e)return '<p>Loading…</p>';if(e.type==='task')return taskRow(e,e.note||'');const next=(e.children||[]).map(r=>view.entities[r.id]).find(t=>t?.type==='task'&&t.status!=='Completed')?.title;const sub=next||summary(e.id),due=dueChip(e);return `<button class="hq-project lf-card" data-open="${esc(e.id)}"><span class="hq-project-info"><span class="lf-card-top"><span class="hq-project-name">${esc(e.title)}</span>${stats(e.id)}</span>${sub||due?`<span class="lf-meta">${due}${sub?`<span class="hq-small">${esc(sub)}</span>`:''}</span>`:''}${crewRow(e.id)}</span></button>`;}
function where(e){const names=[];let x=view.entities[e.parent_id];while(x){names.unshift(x.title);x=view.entities[x.parent_id];}return names.slice(-2).join(' · ');}
// Task rows: the checkbox saves Completed/Not Started immediately; the rest of the card opens the Task.
function taskRow(e,sub=where(e)){const done=e.status==='Completed',locked=archived(view,e.id);return `<div class="hq-project lf-task-row${done?' is-done':''}"><button class="lf-check" data-action="toggle" data-id="${esc(e.id)}" role="checkbox" aria-checked="${done}" aria-label="${esc(e.title)}" ${locked?'disabled':''}><span class="lf-box">${icon(done?'circle-check':'circle')}</span></button><button class="lf-task-open" data-open="${esc(e.id)}"><span class="hq-project-info"><span class="hq-project-name">${esc(e.title)}</span>${sub||dueChip(e)?`<span class="lf-meta">${dueChip(e)}${sub?`<span class="hq-small">${esc(sub)}</span>`:''}</span>`:''}${crewRow(e.id)}</span>${e.status==='In Progress'?badge(e.status):''}</button></div>`;}
// Home focus: every active In Progress Task, plus the first Not Started Task of each active Project, in hierarchy order.
function focus(){const now=[],next=[];const walk=(refs,project)=>{for(const r of refs){const e=view.entities[r.id];if(!e||archived(view,e.id))continue;if(e.type!=='task'){walk(e.children||[],e.type==='project'?{picked:false}:project);continue;}if(e.status==='In Progress')now.push(e.id);else if(e.status==='Not Started'&&project&&!project.picked){project.picked=true;next.push(e.id);}}};walk(view.index.children,null);const byDate=ids=>ids.map((id,i)=>({id,i,d:view.entities[id].planned_completion?dateEnd(view.entities[id].planned_completion):'9999'})).sort((a,b)=>a.d.localeCompare(b.d)||a.i-b.i).map(x=>x.id);return {now:byDate(now),next:byDate(next)};}
// Full dates show in the viewer's locale; partial dates (2026, 2026-10), including ones written by AI, show as recorded.
function showDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')?new Date(v+'T00:00:00Z').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}):v||'';}
// Dates and the note open an editor that expands below the row; nothing is saved until Save (no automatic date).
const prop=(label,body,extra='',cls='',below='')=>`<div class="lf-prop${cls}"><div class="lf-prop-row"><span class="lf-prop-label">${label}</span><div class="lf-prop-value">${body}</div>${extra}</div>${below}</div>`;
function dateEditor(name,value){const full=/^\d{4}-\d{2}-\d{2}$/.test(value||'');return `<div class="lf-expand"><div class="lf-expand-inner">${value&&!full?`<p class="hq-small">Recorded as “${esc(value)}”. Pick a full date to replace it.</p>`:''}<div class="lf-date-field"><input type="date" class="lf-date-input" data-edit="date" value="${full?esc(value):''}" aria-label="Date"><button class="lf-date-clear" data-action="clear-picked" hidden>Clear</button></div>${editActions()}</div></div>`;}
function dateProp(name,label,value,editable){if(!editable)return prop(label,`<span class="lf-date-value">${value?esc(showDate(value)):'—'}</span>`);const open=editing==='date:'+name;
 return prop(label,`<button class="lf-date-value${value?'':' is-empty'}" data-action="edit" data-edit="date:${name}" aria-expanded="${open}">${value?esc(showDate(value)):'Add date'}</button>`,value&&!open?iconButton('clear-date','x','Clear '+label.toLowerCase()+' date',`data-date="${name}"`):'','',open?dateEditor(name,value):'');}
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
  props=e.planned_completion||editing==='date:planned_completion'?dateProp('planned_completion','Planned',e.planned_completion,editable):editable?`<div class="lf-prop lf-prop-add"><button class="lf-add" data-action="edit" data-edit="date:planned_completion">${icon('plus')}<span>Planned date</span></button></div>`:'';
  if(e.actual_completion)props+=prop(derived.status==='Completed'?'Completed':'Last completed',`<span class="lf-date-value">${esc(showDate(e.actual_completion))}</span>`);}
 if(editing==='note')props+=`<div class="lf-prop lf-prop-note"><span class="lf-prop-label">Note</span><div class="lf-expand"><div class="lf-expand-inner"><textarea data-edit="note" aria-label="Note" rows="4">${esc(e.note||'')}</textarea>${editActions()}</div></div></div>`;
 else if(e.note)props+=prop('Note',`<p>${esc(e.note)}</p>`,editable?iconButton('edit','pencil','Edit note','data-edit="note"'):'',' lf-prop-note');
 else if(editable)props+=`<div class="lf-prop lf-prop-add"><button class="lf-add" data-action="edit" data-edit="note">${icon('plus')}<span>Add note</span></button></div>`;
 const plain=s=>String(s||'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1');
 const context=e.legacy&&e.type!=='task'?`<section class="lf-context"><h3>Context</h3><p>${esc(plain(e.legacy.summary||e.legacy.detail))}</p><details><summary>More context</summary><pre>${esc(plain(e.legacy.objective))}</pre><h3>Next actions</h3><pre>${esc(plain(e.legacy.next_actions))}</pre><h3>Milestones</h3><pre>${esc(plain(e.legacy.milestones))}</pre><pre>${esc(plain(e.legacy.blockers))}</pre></details></section>`:'';
 const list=e.type==='task'?'':childGroups(e.children||[],allowed[e.type],editable);
 return `${back}${title}${crewNames(e.id)}${status}<div id="manage-content"></div>${editable?'':'<p>Archived · restore before editing</p>'}${props?`<div class="lf-props">${props}</div>`:''}${context}${list}${e.type==='task'&&editable?`<div class="lf-quiet-delete"><button data-action="delete">Delete task</button></div>`:''}<details class="lf-history" data-id="${esc(e.id)}"><summary>History</summary><div id="history-content"><p class="hq-small">Loading…</p></div></details>`;}
// Actions on the record itself live in the ⋯ menu beside the title; Delete is last, red, and asks again.
function actionsMenu(e){const arrange=[...(e.type!=='section'?[['move','Move to…']]:[]),],item=([a,l])=>`<button role="menuitem" data-action="${a}">${l}</button>`;
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
// Readable History: newest first; who (crew avatar and name), when, and what changed in plain words.
const fieldLabel={title:'Title',status:'Status',note:'Note',planned_completion:'Planned date',actual_completion:'Completed date'};
const shown=(k,v)=>v==null||v===''?'empty':k.endsWith('_completion')?showDate(v):k==='note'?`“${String(v).length>60?String(v).slice(0,60)+'…':v}”`:String(v);
function describe(e){const c=e.change||{},name=view.entities[e.entity_id]?.title||c.after?.title||'';
 if(e.event_type==='created')return `Created “${esc(c.after?.title||name)}”`;
 if(e.event_type==='edited'){const b=c.before||{},a=c.after||{},keys=Object.keys(fieldLabel).filter(k=>JSON.stringify(a[k]??null)!==JSON.stringify(b[k]??null));return keys.map(k=>`${fieldLabel[k]}: ${esc(shown(k,b[k]))} → ${esc(shown(k,a[k]))}`).join('<br>')||'Edited';}
 if(e.event_type==='derived-completion')return 'Marked complete automatically (all tasks done)';
 if(e.event_type==='moved')return `Moved to “${esc(view.entities[c.after?.parent_id]?.title||'top level')}”`;
 if(e.event_type==='reordered')return 'Changed the order of items';
 if(e.event_type==='archived')return 'Archived';if(e.event_type==='restored')return 'Restored from the archive';
 if(e.event_type==='imported')return esc(c.description||'Imported from earlier records');
 return esc(e.event_type);}
async function loadHistory(id){model=await store.history(remoteBase,model,id);const events=Object.entries(model.files).filter(([p])=>p.includes('/history/')).flatMap(([,t])=>decode(t).events||[]);const ids=new Set(subtree(view,id));const box=content.querySelector('#history-content');if(!box)return;
 const list=events.filter(e=>ids.has(e.entity_id)||e.change?.original_markdown&&[...ids].some(id=>e.change.original_markdown.includes(id))).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
 const when=iso=>new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 box.innerHTML=list.map(e=>{const who=eventContributor(view,e),item=e.entity_id!==id?view.entities[e.entity_id]?.title:'';return `<article class="lf-event">${who?avatar(who):''}<div><p class="lf-event-what">${describe(e)}</p><p class="hq-small">${esc(member(who)?.name||e.actor||'')} · ${when(e.recorded_at)}${e.occurred_at?` · happened ${esc(showDate(e.occurred_at))}`:''}${item?` · ${esc(item)}`:''}${e.recorded_by?` · recorded by ${esc(e.recorded_by)}`:''}</p></div></article>`;}).join('')||'<p class="hq-small">No history yet.</p>';}
// Containers and Tasks are listed in separate groups (Projects / Stages, then Tasks), each with its own add button,
// so a Stage card never sits between Task checkboxes. Completed items go to the end of each group.
// Collapsible groups (home): the header toggles the list; the choice is remembered on this device.
let collapsedGroups=new Set();try{collapsedGroups=new Set(JSON.parse(storage?.getItem('lifegress:collapsed-groups:v1')||'[]'));}catch{}
// Header: the title on the left; on the right any group action (e.g. Reorder, hidden while folded),
// then the item count (shown while folded) and the chevron. A tap anywhere on the row toggles the group,
// except on the group action, which keeps its own tap target.
function groupHead(key,title,count,extra=''){const closed=collapsedGroups.has(key);return `<div class="lf-list-head lf-collapsible${closed?' is-folded':''}" data-group-head="${key}"><button class="lf-group-toggle lf-group-title" data-action="toggle-group" data-group="${key}" aria-expanded="${!closed}"><h3>${title}</h3></button><span class="lf-group-extra">${extra}</span><button class="lf-group-toggle lf-group-end" data-action="toggle-group" data-group="${key}" aria-expanded="${!closed}" aria-label="${closed?'Show':'Hide'} ${title}" title="${closed?'Show':'Hide'}"><span class="lf-group-count">${count}</span>${icon('chevron-down')}</button></div>`;}
function groupBody(key,html,cls=''){return `<div class="lf-group-body${collapsedGroups.has(key)?' is-collapsed':''}" data-group-body="${key}"><div class="hq-list${cls}">${html}</div></div>`;}
const groupTitle={section:'Workspaces',project:'Projects',stage:'Stages',task:'Tasks'};
function childGroups(refs,types,editable,collapse=''){const empty=!refs.some(r=>view.entities[r.id]);return types.map((type,i)=>{const items=refs.filter(r=>view.entities[r.id]?.type===type),done=r=>view.entities[r.id]?.type==='task'?view.entities[r.id].status==='Completed':counts(view,r.id).status==='Completed';if(!items.length)return empty&&i===types.length-1?'<p class="hq-small lf-empty">Nothing here yet. Use + to add something.</p>':'';
 const open=items.filter(r=>!done(r)),closed=items.filter(done),sorting=reorderState?.type===type;
 // Reorder lives on the group header; in reorder mode the same cards stay in place, checkboxes give way to drag handles.
 const head=sorting?`<div class="lf-head-actions"><button class="lf-head-link" data-action="reorder-cancel">Cancel</button><button class="lf-add-chip lf-primary-chip" data-action="reorder-done">Done</button></div>`:editable&&open.length>1&&!reorderState?`<button class="lf-head-link" data-action="reorder" data-type="${type}">Reorder</button>`:'';
 const list=sorting?reorderState.order.map(id=>`<div class="lf-reorder-item" data-id="${esc(id)}">${row({id})}<button class="lf-grip" data-id="${esc(id)}" aria-label="Move ${esc(view.entities[id].title)} (drag, or use arrow keys)" title="Drag to reorder">${icon('grip-vertical')}</button></div>`).join('')+closed.map(r=>`<div class="lf-reorder-fixed">${row(r)}</div>`).join(''):[...open,...closed].map(row).join('');
 if(collapse){const key=`${collapse}-${type}`;if(sorting)collapsedGroups.delete(key);return groupHead(key,groupTitle[type],items.length,head)+groupBody(key,list,sorting?' lf-reordering':'');}
 return `<div class="lf-list-head"><h3>${groupTitle[type]}</h3>${head}</div><div class="hq-list${sorting?' lf-reordering':''}">${list}</div>`;}).join('');}
const isDone=id=>{const x=view.entities[id];return x?.type==='task'?x.status==='Completed':counts(view,id).status==='Completed';};
function showResults(){const box=$('#search-results');if(!box)return;box.innerHTML=searchResults(searchText);highlight(box,searchText.trim());$('#search-clear').hidden=!searchText;}
// Highlight every match of the query in result titles and details (case-insensitive), without touching the HTML structure.
function highlight(root,q){if(!q)return;const needle=q.toLowerCase(),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.hq-project-name,.hq-small')&&n.nodeValue.toLowerCase().includes(needle)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const node of nodes){const text=node.nodeValue,lower=text.toLowerCase(),frag=document.createDocumentFragment();let i=0,j;while((j=lower.indexOf(needle,i))>=0){frag.append(text.slice(i,j));const m=document.createElement('mark');m.className='lf-hit';m.textContent=text.slice(j,j+needle.length);frag.append(m);i=j+needle.length;}frag.append(text.slice(i));node.replaceWith(frag);}}
let beforeSearch=null;
const calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
// Opening: the field grows leftward out of the search icon while the icon glides to the far left; Cancel fades in.
function enterSearch(){const from=$('#header-search').getBoundingClientRect();if(!searchView)beforeSearch={selected,profileView,archiveView};selected=null;archiveView=profileView=false;searchView=true;editing=null;closeMenu();render();scroll().scrollTo({top:0});const input=$('#search-input');input.value=searchText;input.focus();
 if(calm()||!from.width)return;const field=$('.lf-search-field'),fr=field.getBoundingClientRect(),icon=field.querySelector('.lf-icon'),ir=icon.getBoundingClientRect(),start=Math.max(0,from.left-fr.left),ease='cubic-bezier(.2,.8,.2,1)';
 field.animate([{clipPath:`inset(0 ${Math.max(0,fr.right-from.right)}px 0 ${start}px round 22px)`},{clipPath:'inset(0 0 0 0 round 12px)'}],{duration:320,easing:ease});
 icon.animate([{transform:`translateX(${from.left+from.width/2-(ir.left+ir.width/2)}px)`},{transform:'none'}],{duration:320,easing:ease});
 $('#search-cancel').animate([{opacity:0,transform:'translateX(12px)'},{opacity:1,transform:'none'}],{duration:240,delay:120,easing:ease,fill:'backwards'});}
// Closing plays the reverse: the field shrinks back into the icon on the right, then the normal top bar returns.
let exiting=false;
function exitSearch(){if(!searchView||exiting)return;if(calm())return leaveSearch();exiting=true;const field=$('.lf-search-field'),fr=field.getBoundingClientRect(),icon=field.querySelector('.lf-icon'),ir=icon.getBoundingClientRect(),ease='cubic-bezier(.4,0,.6,1)';
 $('#search-cancel').animate([{opacity:1},{opacity:0}],{duration:140,fill:'forwards'});icon.animate([{transform:'none'},{transform:`translateX(${fr.right-22-(ir.left+ir.width/2)}px)`}],{duration:260,easing:ease,fill:'forwards'});
 field.animate([{clipPath:'inset(0 0 0 0 round 12px)'},{clipPath:`inset(0 0 0 ${fr.width-44}px round 22px)`}],{duration:260,easing:ease,fill:'forwards'}).finished.then(()=>{exiting=false;field.getAnimations().forEach(a=>a.cancel());icon.getAnimations().forEach(a=>a.cancel());$('#search-cancel').getAnimations().forEach(a=>a.cancel());leaveSearch();});}
function leaveSearch(){searchView=false;searchText='';$('#search-input').value='';const b=beforeSearch||{};beforeSearch=null;selected=b.selected??null;profileView=!!b.profileView;archiveView=!!b.archiveView;render();}
function searchResults(text){const q=text.trim().toLowerCase();if(!q)return '<p class="hq-small">Search by title or note.</p>';
 const hits=Object.values(view.entities).filter(e=>!archived(view,e.id)&&`${e.title}\n${e.note||''}`.toLowerCase().includes(q)).sort((a,b)=>Number(!a.title.toLowerCase().includes(q))-Number(!b.title.toLowerCase().includes(q))).slice(0,50);
 return hits.length?`<div class="hq-list">${hits.map(e=>e.type==='task'?taskRow(e):row({id:e.id})).join('')}</div>`:'<p class="hq-small">No matches.</p>';}
let pressTimer=0,pressedLong=false;
content.addEventListener('pointerdown',e=>{const c=e.target.closest('.lf-check');if(!c||c.disabled)return;pressedLong=false;clearTimeout(pressTimer);pressTimer=setTimeout(()=>{const id=c.dataset.id,task=view.entities[id];if(!task||task.status==='In Progress')return;pressedLong=true;navigator.vibrate?.(10);change({kind:'edit',id,fields:{status:'In Progress'}},{kind:'edit',id,fields:{status:task.status}});},550);});
for(const type of ['pointerup','pointerleave','pointercancel'])content.addEventListener(type,()=>clearTimeout(pressTimer));
content.addEventListener('contextmenu',e=>{if(e.target.closest('.lf-check'))e.preventDefault();});
// Offline: say so right away; pending changes stay on this device and are sent when the connection returns.
// Offline is information, not an error: a calm blue notice that stays until the connection returns.
addEventListener('offline',()=>toast('offline',null,'You’re offline. Changes are kept on this device and save when you reconnect.'));
addEventListener('online',()=>{toast(null);if(store&&ops.length)scheduleSync();});
// Floating +: one place to add things. Items follow the hierarchy of the page you are on and name the destination,
// e.g. "Task in PETHWAY", so it is always clear where a new item lands.
function fabItems(){if(profileView||archiveView||searchView||reorderState||!view)return [];const e=view.entities[selected];
 if(!e)return [['task','Task','Standalone, not in a project'],['project','Project','In a workspace you choose'],['section','Workspace','New top-level area']];
 const host=e.type==='task'?view.entities[e.parent_id]:e;if(archived(view,(host||e).id))return [];
 if(!host)return [['task','Task','Standalone, not in a project']];
 const name={section:'workspace',project:'project',stage:'stage'}[host.type];
 return [...allowed[host.type]].sort((a,b)=>(a==='task'?-1:0)-(b==='task'?-1:0)).map(type=>[type,type==='task'?'Task':type[0].toUpperCase()+type.slice(1),`In ${name} “${host.title}”`]);}
function renderFab(){const items=fabItems(),fab=$('#fab');fab.hidden=!store||!view||!items.length;if(fab.hidden){closeFab();return;}
 $('#fab-menu').innerHTML=items.map(([type,label,hint])=>`<button role="menuitem" data-action="new" data-type="${type}">${icon('plus')}<span><strong>${label}</strong><small>${esc(hint)}</small></span></button>`).join('');}
// Closing plays the reverse animation before the menu is hidden.
function closeFab(){const m=$('#fab-menu'),f=$('#fab');if(m.hidden||f.classList.contains('is-closing'))return;f.classList.remove('is-open');f.classList.add('is-closing');$('#fab-button').setAttribute('aria-expanded','false');setTimeout(()=>{m.hidden=true;f.classList.remove('is-closing');},matchMedia('(prefers-reduced-motion: reduce)').matches?0:170);}
document.body.insertAdjacentHTML('beforeend',`<div id="fab" class="lf-fab-wrap" hidden><div class="lf-fab-scrim" aria-hidden="true"></div><div id="fab-menu" class="lf-fab-menu" role="menu" hidden></div><button id="fab-button" class="lf-fab" aria-label="Add" title="Add" aria-haspopup="menu" aria-expanded="false"><span class="lf-icon lf-icon-plus lf-fab-plus" aria-hidden="true"></span><span class="lf-icon lf-icon-x lf-fab-x" aria-hidden="true"></span></button></div>`);
$('#fab-button').onclick=()=>{const m=$('#fab-menu');if(!m.hidden){closeFab();return;}m.hidden=false;$('#fab').classList.remove('is-closing');$('#fab').classList.add('is-open');$('#fab-button').setAttribute('aria-expanded','true');[...m.children].forEach((b,i)=>b.style.setProperty('--i',m.children.length-1-i));};
// A tap outside the open menu only closes it: the click that follows is swallowed so nothing underneath (e.g. Add note) runs.
let fabSwallowUntil=0;
document.addEventListener('pointerdown',e=>{if(e.target.closest('#fab-button,#fab-menu')||$('#fab-menu').hidden)return;fabSwallowUntil=Date.now()+700;closeFab();},true);
document.addEventListener('click',e=>{if(Date.now()<fabSwallowUntil&&!e.target.closest('#fab-button,#fab-menu')){fabSwallowUntil=0;e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('click',e=>{if(!e.target.closest('#fab-button'))closeFab();});
document.querySelector('.lf-fab-scrim').onclick=closeFab;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFab();});
$('#search-input').addEventListener('input',e=>{searchText=e.target.value;showResults();});
$('#search-input').addEventListener('keydown',e=>{if(e.key==='Escape')exitSearch();if(e.key==='Enter')e.target.blur();});
$('#search-clear').onclick=()=>{searchText='';$('#search-input').value='';showResults();$('#search-input').focus();};
$('#search-cancel').onclick=exitSearch;
// Reorder state: which group is being sorted and its unfinished items in their new order. Done saves once; Cancel discards.
let reorderState=null,drag=null;
// Touch screens: hover styles are for mice. iOS keeps :hover on the last tapped element, which looks like a stuck
// selection, so hover rules are dropped on devices that cannot hover.
if(matchMedia('(hover: none)').matches){const strip=list=>{for(let i=list.length-1;i>=0;i--){const r=list[i];if(r.cssRules&&!r.selectorText)strip(r.cssRules);else if(r.selectorText?.includes(':hover')){const keep=r.selectorText.split(',').filter(s=>!s.includes(':hover'));if(keep.length)r.selectorText=keep.join(',');else (r.parentRule||r.parentStyleSheet).deleteRule(i);}}};for(const s of document.styleSheets){try{strip(s.cssRules);}catch{}}}
// iOS may shift the whole page up when the keyboard opens for the search field, pushing it under Safari's
// blurred status-bar area. The app scrolls inside #page-scroll, so the window itself always stays at the top.
window.visualViewport?.addEventListener('scroll',()=>{if(searchView&&window.scrollY)window.scrollTo(0,0);});
const kidsOf=()=>(selected?view.entities[selected].children:view.index.children)||[];
function finishReorder(save){const st=reorderState;reorderState=null;if(!save||!st){render();return;}const old=kidsOf().map(r=>r.id);let k=0;const ids=old.map(x=>view.entities[x]?.type===st.type&&!isDone(x)?st.order[k++]:x);if(ids.join()===old.join()){render();return;}run(()=>apply({kind:'reorder',id:selected??null,ids}));}
// Drag: the held card follows the pointer; when its centre passes a neighbour's centre they swap places,
// and the neighbours slide to their new spots (FLIP) instead of jumping. On release the card settles into its slot.
function slide(list,move){const items=[...list.querySelectorAll('.lf-reorder-item')],before=new Map(items.map(x=>[x,x.offsetTop]));move();
 for(const x of items){if(x===drag?.item)continue;const d=before.get(x)-x.offsetTop;if(d)x.animate([{transform:`translateY(${d}px)`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});}}
content.addEventListener('pointerdown',e=>{const grip=e.target.closest('.lf-grip');if(!grip||!reorderState)return;e.preventDefault();const item=grip.closest('.lf-reorder-item');drag={item,list:item.parentElement,y:e.clientY,top:item.offsetTop};item.classList.add('is-dragging');grip.setPointerCapture(e.pointerId);});
content.addEventListener('pointermove',e=>{if(!drag)return;const {item,list}=drag,shift=()=>e.clientY-drag.y-(item.offsetTop-drag.top);
 const centre=item.offsetTop+shift()+item.offsetHeight/2,mid=x=>x.offsetTop+x.offsetHeight/2,prev=item.previousElementSibling,next=item.nextElementSibling;
 if(prev?.matches('.lf-reorder-item')&&centre<mid(prev))slide(list,()=>list.insertBefore(item,prev));
 else if(next?.matches('.lf-reorder-item')&&centre>mid(next))slide(list,()=>list.insertBefore(item,next.nextSibling));
 item.style.translate=`0 ${shift()}px`;});
for(const type of ['pointerup','pointercancel'])content.addEventListener(type,()=>{if(!drag)return;const {item,list}=drag;item.classList.remove('is-dragging');item.style.translate='';reorderState.order=[...list.querySelectorAll('.lf-reorder-item')].map(x=>x.dataset.id);drag=null;});
content.addEventListener('keydown',e=>{const grip=e.target.closest?.('.lf-grip');if(!grip||!reorderState||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const o=reorderState.order,i=o.indexOf(grip.dataset.id),j=i+(e.key==='ArrowUp'?-1:1);if(j<0||j>=o.length)return;[o[i],o[j]]=[o[j],o[i]];render();content.querySelector(`.lf-grip[data-id="${CSS.escape(grip.dataset.id)}"]`)?.focus();});
function photoButton(id,label){return `<label class="lf-add lf-file">${icon('plus')}<span>${label}</span><input type="file" accept="image/*" data-avatar-for="${esc(id)}"></label>`;}
function profile(){const me=member('owner')||{id:'owner',name:'Owner'},count=id=>Object.values(view.entities).filter(e=>(e.contributors||[]).includes(id)).length;
 const name=editing==='owner-name'?`<input class="lf-title-input" data-edit="name" value="${esc(me.name)}" aria-label="Your name">${editActions()}`:`<div class="lf-name-row"><h3>${esc(me.name)}</h3>${iconButton('edit','pencil','Edit name','data-edit="owner-name"')}</div>`;
 const crew=view.crew.members.filter(c=>c.id!=='owner').map(c=>`<div class="hq-project lf-crew-row">${avatar(c.id,'md')}<span class="hq-project-info"><span class="hq-project-name">${esc(c.name)}</span><span class="hq-small">${count(c.id)?`Worked on ${count(c.id)} ${count(c.id)===1?'item':'items'}`:'No updates yet'}</span></span></div>`).join('');
 return `<h2>Profile</h2><section class="lf-profile">${avatar('owner','lg')}<div class="lf-profile-info">${name}${photoButton('owner',me.avatar?'Change photo':'Add photo')}</div></section><div class="lf-list-head"><h3>My Crew</h3></div><p class="hq-small">AI collaborators appear here once they add to your projects.</p><div class="hq-list">${crew||'<p class="hq-small">No collaborators yet.</p>'}</div>`;}
function render(){
 if(!store||!view)return;splash(false);queueMicrotask(renderFab);$('#workspace-toggle').hidden=false;
 const me=member('owner');$('#menu-profile').innerHTML=`${avatar('owner','md')}<span>${esc(me?.name||'Profile')}</span>`;
 // iPad / desktop: the Owner's photo alone sits at the right of the header and opens Profile.
 const hp=$('#header-profile');hp.hidden=$('#header-search').hidden=false;$('#header-search').setAttribute('aria-pressed',String(searchView));hp.innerHTML=avatar('owner','md');hp.setAttribute('aria-label',`Profile · ${me?.name||'Owner'}`);hp.title='Profile';hp.setAttribute('aria-pressed',String(profileView));
 let activeSection=view.entities[selected];while(activeSection&&activeSection.type!=='section')activeSection=view.entities[activeSection.parent_id];
 const sections=view.index.children.filter(r=>r.type==='section'),home=!selected&&!profileView&&!archiveView&&!searchView;
 // Navigation tree: "All projects" is the root and opens the home page; workspaces are indented under it; Archive stays apart.
 nav.innerHTML=`<button class="lf-nav-root" data-action="home" aria-pressed="${home}">All projects</button>`+sections.map(r=>`<button class="lf-nav-child" data-open="${esc(r.id)}" aria-pressed="${activeSection?.id===r.id}">${esc(view.entities[r.id]?.title||r.id)}</button>`).join('')+`<button class="lf-nav-archive" data-action="archive-list" aria-pressed="${archiveView}">Archive</button>`;$('#mobile-workspaces').innerHTML=nav.innerHTML;
 const e=view.entities[selected];
 // Search mode: the top bar becomes the search field; results update as you type.
 $('.hq-top').classList.toggle('is-searching',searchView);$('#search-bar').hidden=!searchView;
 if(searchView){content.innerHTML='<div id="search-results"></div>';showResults();return;}
 if(profileView)content.innerHTML=profile();
 else if(archiveView){content.innerHTML=`<h2>Archive</h2><p class="hq-small">Archived items are kept with their history and don't count toward progress.</p><div class="hq-list">${view.catalog.entries.map(a=>`<div class="hq-project lf-card lf-archived"><span class="hq-project-info"><span class="hq-project-name">${esc(a.title||a.id)}</span><span class="hq-small">${esc(a.type[0].toUpperCase()+a.type.slice(1))}</span></span><span class="lf-head-actions"><button class="lf-add-chip" data-action="restore" data-id="${esc(a.id)}">Restore</button><button class="lf-add-chip lf-danger-chip" data-action="delete" data-id="${esc(a.id)}">Delete</button></span></div>`).join('')||'<p class="hq-small">Nothing archived.</p>'}</div><div id="manage-content"></div>`;return;}
 // Home keeps the Now / Up next list it opened with, so a Task checked here stays visible until the next visit.
 else if(!e){homeList??=focus();const pick=ids=>ids.map(id=>view.entities[id]).filter(x=>x&&!archived(view,x.id));const group=(key,title,list)=>list.length?`<section class="lf-focus">${groupHead(key,title,list.length)}${groupBody(key,list.map(x=>taskRow(x)).join(''))}</section>`:'';content.innerHTML=`<div class="lf-page-head"><h2>All projects</h2></div>${group('home-now','Now',pick(homeList.now))}${group('home-next','Up next',pick(homeList.next))}${childGroups(view.index.children,['section','task'],true,'home')}`;}
 else content.innerHTML=detail(e);
 const input=content.querySelector('[data-edit]:not(button):not([type=date])');if(input){input.focus({preventScroll:true});if(input.tagName==='INPUT'&&input.type==='text')input.select();}
}
function preview(){view=ops.length?transact(model,ops):structuredClone(model);render();}
async function load(){const data=await store.load();base=remoteBase=data.base;if(!syncing){ops=draftOps().filter(o=>!(o.kind==='crew'&&o.avatar&&!assets.some(a=>a.path===o.avatar)));locked=0;}model=await store.active(base,data.model);if(ops.some(structural))model=await store.archives(base,model,true);homeList=null;try{preview();}catch{ops=[];save();preview();}saveCache();loadAvatars();if(ops.length)await scheduleSync();}
async function loadAvatars(){const need=[...new Set(view.crew.members.map(c=>c.avatar).filter(p=>p&&!avatars[p]))];if(!need.length)return;await Promise.all(need.map(async p=>{try{avatars[p]=await store.avatar(remoteBase,p);}catch{}}));const keep={};for(const c of view.crew.members)if(c.avatar&&avatars[c.avatar])keep[c.avatar]=avatars[c.avatar];avatars=keep;if(remember)try{storage.setItem(avatarKey,JSON.stringify(avatars));}catch{}render();}
async function open(id){selected=id;editing=null;reorderState=null;archiveView=profileView=searchView=false;homeList=null;closeMenu();if(model.entities[id])model=await store.branch(remoteBase,model,id);preview();scroll().scrollTo({top:0});}
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
async function sync(undo){if(!ops.length)return true;if(navigator.onLine===false){toast('offline',null,'You’re offline. Changes are kept on this device and save when you reconnect.');return false;}locked=ops.length;const sending=ops.slice(0,locked),photo=sending.some(o=>o.kind==='crew'&&o.avatar);toast('saving',null,photo?'Uploading photo…':null);try{
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
async function deleteEntity(id){model=await store.active(base,model);model=await store.archives(base,model,true);preview();const ids=new Set(subtree(view,id));let more=true;while(more){more=false;for(const a of view.catalog.entries)if(ids.has(a.original_parent_id)&&!ids.has(a.id)){subtree(view,a.id).forEach(x=>ids.add(x));more=true;}}if(await ask({title:`Delete “${view.entities[id].title}”?`,message:`${ids.size>1?`This also deletes ${ids.size-1} item${ids.size>2?'s':''} inside it and `:'This deletes '}its history. Earlier versions on GitHub may still contain it.`,confirm:'Delete',danger:true}))await apply({kind:'delete',id,confirm:true});}
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
// Valid places for a new item of this type: the top level when allowed, then every active container that accepts it, indented by depth.
function placesFor(type){const out=allowed.index.includes(type)?[{value:'',label:type==='task'?'No project (standalone task)':'Top level'}]:[];const walk=(refs,depth)=>{for(const r of refs){const e=view.entities[r.id];if(!e||e.type==='task'||archived(view,e.id))continue;if(allowed[e.type].includes(type))out.push({value:e.id,label:'\u00a0\u00a0'.repeat(depth)+e.title});walk(e.children||[],depth+1);}};walk(view.index.children,0);return out;}
// In-app dialog for names and confirmations (replaces the browser's prompt and confirm). Resolves to the text, true, or null.
document.body.insertAdjacentHTML('beforeend',`<dialog id="ask-dialog" class="lf-ask" aria-labelledby="ask-title"><form method="dialog"><h2 id="ask-title"></h2><p id="ask-message"></p><input id="ask-input" type="text" autocomplete="off"><label id="ask-place-wrap" class="lf-ask-place"><span>In</span><select id="ask-place"></select></label><div class="lf-crop-actions"><button class="hq-action" value="cancel" formnovalidate>Cancel</button><button class="hq-action lf-primary" id="ask-ok" value="ok">OK</button></div></form></dialog>`);
// With places, the dialog also asks where the new item goes and resolves to {text, place}.
function ask({title,message='',input='',confirm='OK',danger=false,places=null,place=''}){const d=$('#ask-dialog'),field=$('#ask-input'),ok=$('#ask-ok'),select=$('#ask-place');$('#ask-place-wrap').hidden=!places||places.length<2;select.innerHTML=(places||[]).map(o=>`<option value="${esc(o.value)}" ${o.value===place?'selected':''}>${esc(o.label)}</option>`).join('');$('#ask-title').textContent=title;$('#ask-message').textContent=message;$('#ask-message').hidden=!message;field.hidden=!input;field.value='';field.placeholder=input;field.setAttribute('aria-label',input||title);ok.textContent=confirm;ok.classList.toggle('lf-danger-button',danger);ok.disabled=!!input;
 return new Promise(resolve=>{d.onclose=()=>resolve(d.returnValue==='ok'?(input?(places?{text:field.value.trim(),place:select.value}:field.value.trim()):true):null);d.returnValue='';d.showModal();(input?field:ok).focus();});}
$('#ask-input').oninput=e=>{$('#ask-ok').disabled=!e.target.value.trim();};
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
 const who=e.target.dataset.avatarFor,file=e.target.files?.[0];if(who&&file){e.target.value='';openCrop(file,who);}});
content.addEventListener('click',e=>{if(e.target.matches?.('input[type=date]'))try{e.target.showPicker();}catch{}});
const editingValue=()=>editing==='owner-name'?member('owner')?.name||'':editing?.startsWith('date:')?view.entities[selected]?.[editing.slice(5)]||'':view.entities[selected]?.[editing]||'';
const enableSave=e=>{const save=content.querySelector('[data-action=save-edit]');if(save)save.disabled=e.target.value===editingValue()||e.target.tagName==='INPUT'&&!e.target.value.trim();const clear=content.querySelector('[data-action=clear-picked]');if(clear&&e.target.type==='date')clear.hidden=!e.target.value;};
content.addEventListener('change',e=>{if(e.target.dataset.edit==='date')enableSave(e);});
content.addEventListener('input',e=>{if(e.target.dataset.edit==='date')enableSave(e);});
content.addEventListener('input',e=>{if(e.target.dataset.edit&&!(e.target instanceof HTMLButtonElement)){const save=content.querySelector('[data-action=save-edit]');if(save)save.disabled=e.target.value===editingValue()||e.target.tagName==='INPUT'&&!e.target.value.trim();}if(e.target.id==='token')content.querySelector('[data-action=connect]').disabled=!e.target.value.trim();});
content.addEventListener('toggle',e=>{if(e.target.classList?.contains('lf-history')&&e.target.open)run(()=>loadHistory(e.target.dataset.id));},true);
content.addEventListener('keydown',e=>{if(e.key==='Escape')closeActions();if(e.key==='Enter'&&e.target.id==='token'&&e.target.value.trim())content.querySelector('[data-action=connect]').click();if(e.target.dataset?.edit&&!(e.target instanceof HTMLButtonElement)){if(e.key==='Escape'){editing=null;render();}else if(e.key==='Enter'&&(e.target.tagName==='INPUT'||e.metaKey||e.ctrlKey)){e.preventDefault();content.querySelector('[data-action=save-edit]:not(:disabled)')?.click();}}});
document.addEventListener('click',event=>{if(!event.target.closest('.lf-actions'))closeActions();const b=event.target.closest('button')||event.target.closest('[data-group-head]')?.querySelector('.lf-group-end');if(!b)return;const a=b.dataset.action,id=b.dataset.id||selected;
 // Saving happens in the background, so checking Tasks, Undo and Retry stay available while busy.
 if(a==='toggle'&&pressedLong){pressedLong=false;return;}
 if(a==='toggle'){const task=view.entities[id],previous=task.status,status=previous==='Completed'?'Not Started':'Completed';change({kind:'edit',id,fields:{status}},{kind:'edit',id,fields:{status:previous}});return;}
 if(a==='undo'&&undoAction){const op=undoAction;toast(null);change(op);return;}
 if(a==='retry'){scheduleSync();return;}
 if(a==='actions-menu'){const m=b.parentElement.querySelector('.lf-menu');m.hidden=!m.hidden;b.setAttribute('aria-expanded',String(!m.hidden));return;}
 if(b.closest('.lf-menu'))closeActions();
 if(busy)return;if(b.dataset.open){run(()=>open(b.dataset.open));return;}
 if(a==='home'){reorderState=null;selected=null;archiveView=profileView=searchView=false;homeList=null;editing=null;closeMenu();render();scroll().scrollTo({top:0});}
 if(a==='search'){enterSearch();return;}
 if(a==='profile'){selected=null;archiveView=searchView=false;profileView=true;editing=null;closeMenu();render();scroll().scrollTo({top:0});}
 if(a==='connect')run(async()=>{const token=$('#token').value.trim();if(!token)return;remember=personalDevice||$('#remember').checked;loading();store=new StoreV1(token);try{await load();}catch(e){store=null;loggedOut(e.status===401?'That token didn’t work. Check it and try again.':'Unable to connect. Try again.');return;}if(remember)credentials.remember(token);else{credentials.forget();clearCache();}say('');});
 if(a==='new')run(async()=>{const type=b.dataset.type,places=placesFor(type);let here=selected;while(here&&!places.some(o=>o.value===here))here=view.entities[here]?.parent_id??null;const answer=await ask({title:`New ${type}`,input:`${type[0].toUpperCase()+type.slice(1)} name`,confirm:'Create',places,place:here??places[0]?.value??''});if(!answer?.text)return;const newId=type.toUpperCase()+'-'+crypto.randomUUID();await queue({kind:'create',type,id:newId,title:answer.text,parent_id:answer.place||null});if(view.entities[newId])await open(newId);scheduleSync();});
 if(a==='archive')run(async()=>{if(await ask({title:`Archive “${view.entities[id].title}”?`,message:'It moves out of your active lists with everything inside it. Its progress stays recorded and you can restore it from Archive.',confirm:'Archive'})){await apply({kind:'archive',id});selected=null;render();}});
 if(a==='archive-list')run(async()=>{model=await store.archives(remoteBase,model);archiveView=true;profileView=searchView=false;closeMenu();preview();});
 if(a==='restore')run(async()=>{model=await store.active(base,model);model=await store.archives(base,model,true);preview();const entry=view.catalog.entries.find(a=>a.id===id),parent=entry.original_parent_id;try{await apply({kind:'restore',id,parent_id:parent});}catch(error){if(view.entities[id].type!=='project')throw error;const choices=Object.values(view.entities).filter(e=>e.type==='section'&&!archived(view,e.id));$('#manage-content').innerHTML=`<h3>Choose a restore destination</h3><p>${esc(error.message)}</p><label class="hq-field">Section<select id="destination">${choices.map(e=>`<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}</select></label>${button('apply-restore','Restore here',`data-id="${esc(id)}"`)}`;}});
 if(a==='apply-restore')run(()=>apply({kind:'restore',id,parent_id:$('#destination').value}));
 if(a==='delete')run(()=>deleteEntity(id));
 if(a==='move')run(async()=>{model=await store.active(base,model);preview();content.querySelector('#manage-content').innerHTML=movePicker(id);content.querySelector('#manage-content').scrollIntoView({block:'nearest'});});
 if(a==='pick-dest'){for(const x of content.querySelectorAll('.lf-tree button'))x.setAttribute('aria-pressed',String(x===b));const go=content.querySelector('[data-action=apply-move]');go.disabled=false;go.dataset.dest=b.dataset.dest;}
 if(a==='cancel-move'){content.querySelector('#manage-content').innerHTML='';}
 if(a==='apply-move')run(()=>apply({kind:'move',id,parent_id:b.dataset.dest||null}));
 if(a==='reorder'){const type=b.dataset.type;reorderState={type,order:kidsOf().map(r=>r.id).filter(x=>view.entities[x]?.type===type&&!isDone(x))};render();}
 if(a==='toggle-group'){const key=b.dataset.group,closed=!collapsedGroups.has(key);closed?collapsedGroups.add(key):collapsedGroups.delete(key);try{storage.setItem('lifegress:collapsed-groups:v1',JSON.stringify([...collapsedGroups]));}catch{}const head=content.querySelector(`[data-group-head="${key}"]`);head?.classList.toggle('is-folded',closed);head?.querySelectorAll('.lf-group-toggle').forEach(x=>x.setAttribute('aria-expanded',String(!closed)));const body=content.querySelector(`[data-group-body="${key}"]`);if(body){body.classList.toggle('is-collapsed',closed);body.classList.toggle('is-animating',!closed);body.ontransitionend=e=>{if(e.target===body&&e.propertyName==='grid-template-rows')body.classList.remove('is-animating');};}}
 if(a==='reorder-cancel')finishReorder(false);
 if(a==='reorder-done')finishReorder(true);
 if(a==='discard')run(async()=>{ops=[];locked=0;assets=[];save();toast(null);await load();});
 if(a==='edit'){editing=b.dataset.edit;render();}
 if(a==='cancel-edit'){editing=null;render();}
 if(a==='clear-picked'){const d=content.querySelector('.lf-date-input');d.value='';enableSave({target:d});}
 if(a==='save-edit'){const field=editing,value=content.querySelector('[data-edit]:not(button)').value;if(content.querySelector('[data-edit]:not(button)').tagName==='INPUT'&&!value.trim())return;editing=null;if(field==='owner-name')change({kind:'crew',id:'owner',name:value.trim()});else if(field.startsWith('date:')){const name=field.slice(5),previous=view.entities[selected][name]??'';change({kind:'edit',id:selected,fields:{[name]:value}},{kind:'edit',id:selected,fields:{[name]:previous}});}else change({kind:'edit',id:selected,fields:{[field]:field==='title'?value.trim():value}});}
 if(a==='set-status'&&b.getAttribute('aria-pressed')!=='true'){const previous=view.entities[selected].status;change({kind:'edit',id:selected,fields:{status:b.dataset.status}},{kind:'edit',id:selected,fields:{status:previous}});}
 if(a==='clear-date'){const name=b.dataset.date,previous=view.entities[selected][name]??'';change({kind:'edit',id:selected,fields:{[name]:''}},{kind:'edit',id:selected,fields:{[name]:previous}});}
});
$('#home').onclick=()=>{if(busy)return;selected=null;archiveView=profileView=searchView=false;homeList=null;editing=null;if(store&&view)render();else if(!store)loggedOut();};
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
