import {credentialStore} from './credentials.mjs';
import {StoreV1} from './store-v1.mjs?v=019';
import {allowed,statuses,counts,transact,subtree,archived,decode} from './data-v1.mjs';
let storage;try{storage=localStorage;}catch{}
// App version: V<major>.<release>. Increment the release part by one on every publication (see AGENTS.md).
const APP_VERSION='V000.019';
const credentials=credentialStore(storage),draftKey='lifegress:KidaJo/personal-hq:operations:v1';
const $=s=>document.querySelector(s),content=$('#content'),nav=$('#desktop-workspaces nav');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,data='')=>`<button class="hq-action" data-action="${action}" ${data}>${label}</button>`;
let store=null,base='',remoteBase='',model=null,view=null,selected=null,ops=[],busy=false,archiveView=false,remember=false,toastTimer=0,undoAction=null;
// Phones and tablets are treated as personal devices and always remember the connection.
const personalDevice=matchMedia('(pointer:coarse)').matches;
const scroll=()=>$('#page-scroll');
function say(text){$('#hq-message').textContent=text;}
function save(){try{storage.setItem(draftKey,JSON.stringify({base,ops}));}catch{}}
// Save status toast: saving (info), saved (success, auto-hides, optional Undo), error (persistent, Retry/Discard).
function toast(state,undo){clearTimeout(toastTimer);const t=$('#toast');if(!state){t.hidden=true;return;}
 const icon={saved:'circle-check',error:'triangle-alert'}[state];
 t.className='lf-toast state-'+state;t.hidden=false;
 t.innerHTML=`${state==='saving'?'<span class="lf-spinner" aria-hidden="true"></span>':`<img src="./icons/${icon}.svg" width="16" height="16" alt="">`}<span>${state==='saving'?'Saving…':state==='saved'?'Saved':'Couldn’t save.'}</span>${state==='saved'&&undo?button('undo','Undo'):''}${state==='error'?button('retry','Retry')+button('discard','Discard'):''}`;
 if(state==='saved')toastTimer=setTimeout(()=>toast(null),undo?6000:2500);
 undoAction=undo||null;}
function closeMenu(){const d=$('#workspace-dialog');d.classList.remove('menu-expanded');$('#workspace-toggle').setAttribute('aria-expanded','false');setTimeout(()=>d.close(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:240);}
function loading(){content.innerHTML='<div class="lf-connect lf-loading"><span class="lf-spinner" aria-hidden="true"></span><p>Loading your workspace…</p></div>';nav.innerHTML='';$('#workspace-toggle').hidden=true;$('#version').textContent=APP_VERSION;}
function loggedOut(message=''){content.innerHTML=`<div class="lf-connect"><p class="lf-eyebrow">YOUR PERSONAL WORKSPACE</p><h2>Your projects.<br>Your progress.</h2>${message?`<p class="lf-notice">${esc(message)}</p>`:''}<label class="hq-field">Access token<input id="token" type="password" autocomplete="off"></label>${personalDevice?'':`<label class="lf-remember"><input id="remember" type="checkbox" ${remember?'checked':''}>Remember on this device</label>`}<p class="hq-small" id="connect-help">Enter your access token to continue.</p><button class="hq-action" data-action="connect" aria-describedby="connect-help" disabled>Connect to Lifegress</button></div>`;nav.innerHTML='';$('#workspace-toggle').hidden=true;$('#version').textContent=APP_VERSION;toast(null);}
async function run(fn){if(busy)return;busy=true;$('#hq-manual').setAttribute('aria-busy','true');try{await fn();}catch(e){if(e.status===401){credentials.forget();store=null;$('#workspace-dialog').close();loggedOut('Your access has expired. Enter a new token to continue.');}else say(e.message);}finally{busy=false;$('#hq-manual').setAttribute('aria-busy','false');}}
function badge(status){const family=status==='Completed'?'complete':status==='In Progress'?'active':'neutral';const icon=status==='Completed'?'circle-check':status==='In Progress'?'circle-dot':'circle';return `<span class="hq-status state-${family}"><img src="./icons/${icon}.svg" width="16" height="16" alt="">${esc(status)}</span>`;}
function stats(id){const e=view.entities[id];if(e.type==='task')return badge(e.status);const c=counts(view,id);return `<span class="hq-status">${!c.loaded?'Loading…':c.total?`${esc(c.status)} · ${Math.round(c.progress)}%`:'No tasks yet'}</span>`;}
function summary(id){const c=counts(view,id);return c.loaded&&c.total?`${c.completed} of ${c.total} ${c.total===1?'task':'tasks'} done`:'';}
function row(r){const e=view.entities[r.id];if(!e)return '<p>Loading…</p>';if(e.type==='task')return taskRow(e,e.note);const next=(e.children||[]).map(r=>view.entities[r.id]).find(t=>t?.type==='task'&&t.status!=='Completed')?.title;const sub=next||summary(e.id);return `<button class="hq-project" data-open="${esc(e.id)}"><span class="hq-project-info"><span class="hq-project-name">${esc(e.title)}</span>${sub?`<span class="hq-small">${esc(sub)}</span>`:''}</span>${stats(e.id)}</button>`;}
function where(e){const names=[];let x=view.entities[e.parent_id];while(x){names.unshift(x.title);x=view.entities[x.parent_id];}return names.slice(-2).join(' · ');}
// Task rows: the checkbox saves Completed/Not Started immediately; the title opens the Task for other edits.
function taskRow(e,sub=where(e)){const done=e.status==='Completed',locked=archived(view,e.id);return `<div class="hq-project lf-task-row${done?' is-done':''}"><button class="lf-check" data-action="toggle" data-id="${esc(e.id)}" role="checkbox" aria-checked="${done}" aria-label="${esc(e.title)}" ${locked?'disabled':''}><img src="./icons/${done?'circle-check':'circle'}.svg" width="22" height="22" alt=""></button><button class="lf-task-open" data-open="${esc(e.id)}"><span class="hq-project-info"><span class="hq-project-name">${esc(e.title)}</span>${sub?`<span class="hq-small">${esc(sub)}</span>`:''}</span>${e.status==='In Progress'?badge(e.status):''}</button></div>`;}
// Home focus: every active In Progress Task, plus the first Not Started Task of each active Project, in hierarchy order.
function focus(){const now=[],next=[];const walk=(refs,project)=>{for(const r of refs){const e=view.entities[r.id];if(!e||archived(view,e.id))continue;if(e.type!=='task'){walk(e.children||[],e.type==='project'?{picked:false}:project);continue;}if(e.status==='In Progress')now.push(e);else if(e.status==='Not Started'&&project&&!project.picked){project.picked=true;next.push(e);}}};walk(view.index.children,null);return {now,next};}
function field(name,label,value,type='text'){return `<label class="hq-field"><span>${label}</span>${type==='textarea'?`<textarea data-field="${name}">${esc(value||'')}</textarea>`:`<input data-field="${name}" type="text" value="${esc(value||'')}" ${name.endsWith('completion')?'placeholder="Unknown · YYYY-MM-DD or partial date"':''}>`}</label>`;}
function render(){
 if(!store||!view)return;$('#workspace-toggle').hidden=false;
 let activeSection=view.entities[selected];while(activeSection&&activeSection.type!=='section')activeSection=view.entities[activeSection.parent_id];
 const sections=view.index.children.filter(r=>r.type==='section');nav.innerHTML=sections.map(r=>`<button data-open="${esc(r.id)}" aria-pressed="${activeSection?.id===r.id}">${esc(view.entities[r.id]?.title||r.id)}</button>`).join('')+button('archive-list','Archive');$('#mobile-workspaces').innerHTML=nav.innerHTML;
 const e=view.entities[selected];
 if(archiveView){content.innerHTML=`<h2>Archive</h2><p class="hq-small">Excluded from active Section progress. Restore to resume editing.</p>${view.catalog.entries.map(a=>`<div class="hq-project"><span>${esc(a.title||a.id)}</span>${button('restore','Restore',`data-id="${esc(a.id)}"`)}${button('delete','Delete',`data-id="${esc(a.id)}"`)}</div>`).join('')||'<p>No archived items.</p>'}<div id="manage-content"></div>`;return;}
 const crumbs=[];let x=e;while(x){crumbs.unshift(`<button data-open="${esc(x.id)}">${esc(x.title)}</button>`);x=view.entities[x.parent_id];}
 const breadcrumb=`<nav class="hq-breadcrumbs" aria-label="Breadcrumb">${button('home','Home')}${crumbs.map(t=>'<span>/</span>'+t).join('')}</nav>`;
 if(!e){const {now,next}=focus(),group=(title,list)=>list.length?`<section class="lf-focus"><h3>${title}</h3><div class="hq-list">${list.map(e=>taskRow(e)).join('')}</div></section>`:'';content.innerHTML=`<h2>Overview</h2>${group('Now',now)}${group('Up next',next)}<h3>Workspaces</h3><div class="hq-list">${view.index.children.map(row).join('')}</div><div class="hq-bar">${button('new','New Section','data-type="section"')}${button('new','New Task','data-type="task"')}</div>`;return;}
 const isArchived=archived(view,e.id);const editable=!isArchived;
 content.innerHTML=`${breadcrumb}<h2>${esc(e.title)}</h2>${stats(e.id)}${isArchived?'<p>Archived · restore before editing</p>':''}<fieldset ${editable?'':'disabled'}>${field('title','Title',e.title)}${e.type==='task'?`<label class="hq-field"><span>Status</span><select data-field="status" aria-label="Status">${statuses.map(s=>`<option ${s===e.status?'selected':''}>${s}</option>`).join('')}</select></label>`:''}${field('note','Note',e.note,'textarea')}${e.type!=='section'?field('planned_completion','Planned completion (optional)',e.planned_completion)+field('actual_completion',e.type==='task'&&e.status==='Completed'||e.type!=='task'&&counts(view,e.id).status==='Completed'?'Actual completion (optional)':'Last completed (optional)',e.actual_completion):''}</fieldset>${editable?`<div class="hq-bar lf-edit-actions"><button class="hq-action lf-primary" data-action="save-fields" disabled>Save</button><button class="hq-action" data-action="cancel-fields" disabled>Cancel</button></div>`:''}${e.legacy?`<details><summary>Existing project context</summary><p>${esc(e.legacy.summary||e.legacy.detail||'')}</p><pre>${esc(e.legacy.objective||'')}</pre><h3>Next actions</h3><pre>${esc(e.legacy.next_actions||'')}</pre><h3>Milestones</h3><pre>${esc(e.legacy.milestones||'')}</pre><pre>${esc(e.legacy.blockers||'')}</pre><p class="hq-small">${esc(e.confidence||e.legacy.confidence||'')} · Original descriptions retained as source context.</p></details>`:''}<div class="hq-list">${(e.children||[]).map(row).join('')}</div>${editable?`<div class="hq-bar">${allowed[e.type].map(type=>button('new','New '+type[0].toUpperCase()+type.slice(1),`data-type="${type}"`)).join('')}</div>`:''}<details class="project-meta"><summary>More</summary><p class="hq-small">${esc(e.id)}</p><div class="hq-bar">${button('history','History')}${editable?button('move','Move')+(e.children?.length?button('reorder','Reorder'):'')+(['section','project'].includes(e.type)?button('archive','Archive'):'')+button('delete','Delete'):''}</div></details><div id="manage-content"></div><div id="history-content"></div>`;
}
function preview(){view=ops.length?transact(model,ops):structuredClone(model);render();}
async function load(){const data=await store.load();base=remoteBase=data.base;ops=JSON.parse(storage?.getItem(draftKey)||'null')?.ops||[];model=await store.active(base,data.model);if(ops.length&&ops.some(o=>['archive','restore','move','delete'].includes(o.kind)))model=await store.archives(base,model,true);try{preview();}catch{ops=[];save();preview();}if(ops.length)await sync();}
async function open(id){selected=id;archiveView=false;closeMenu();if(model.entities[id])model=await store.branch(remoteBase,model,id);preview();scroll().scrollTo({top:0});}
async function queue(op){model=await store.active(base,model);if(['archive','restore','move','delete'].includes(op.kind))model=await store.archives(base,model,true);let next=[...ops,op];
 if(op.kind==='edit'){
  const lastStructure=next.findLastIndex(o=>o.kind!=='edit');
  const prefix=next.slice(0,lastStructure+1),edits=next.slice(lastStructure+1),merged=[];
  for(const item of edits){const previous=merged.find(o=>o.id===item.id);if(previous)Object.assign(previous.fields,item.fields);else merged.push(structuredClone(item));}
  const origin=prefix.length?transact(model,prefix):model;
  for(const item of merged)for(const key of Object.keys(item.fields)){const value=item.fields[key];if((value===''&&key.endsWith('_completion')?null:value)===(origin.entities[item.id]?.[key]??(key==='note'?'':null)))delete item.fields[key];}
  next=[...prefix,...merged.filter(o=>Object.keys(o.fields).length)];
 }
 const trial=transact(model,next);ops=next;view=trial;save();if(!view.entities[selected])selected=null;render();}
// Save pending changes to GitHub. If GitHub moved on (another device or an AI), re-apply the changes on the latest version first.
async function sync(undo){if(!ops.length)return;toast('saving');try{
  const data=await store.load();if(data.base!==base){let m=await store.active(data.base,data.model);if(ops.some(o=>['archive','restore','move','delete'].includes(o.kind)))m=await store.archives(data.base,m,true);transact(m,ops);model=m;base=remoteBase=data.base;}
  let review;try{review=await store.prepare(base,model,ops);}catch(e){if(e.message!=='No changes to review')throw e;}
  if(review){const result=await store.commit(review);base=remoteBase=result.base;model=review.model;}
  ops=[];save();preview();toast('saved',undo);
 }catch(e){if(e.status===401)throw e;toast('error');}}
async function apply(op,undo){await queue(op);await sync(undo);}
async function deleteEntity(id){model=await store.active(base,model);model=await store.archives(base,model,true);preview();const ids=new Set(subtree(view,id));let more=true;while(more){more=false;for(const a of view.catalog.entries)if(ids.has(a.original_parent_id)&&!ids.has(a.id)){subtree(view,a.id).forEach(x=>ids.add(x));more=true;}}if(confirm(`Delete ${view.entities[id].title} and ${ids.size-1} descendants, including their history? Earlier Git commits may still retain this data.`))await apply({kind:'delete',id,confirm:true});}
// Task status saves immediately; text and date fields wait for Save.
content.addEventListener('change',e=>{if(e.target.dataset.field!=='status'||busy)return;const previous=view.entities[selected].status,value=e.target.value;run(()=>apply({kind:'edit',id:selected,fields:{status:value}},{kind:'edit',id:selected,fields:{status:previous}}));});
content.addEventListener('input',e=>{if(e.target.dataset.field&&e.target.dataset.field!=='status')for(const b of content.querySelectorAll('.lf-edit-actions button'))b.disabled=false;if(e.target.id==='token')content.querySelector('[data-action=connect]').disabled=!e.target.value.trim();});
content.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='token'&&e.target.value.trim())content.querySelector('[data-action=connect]').click();});
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||busy)return;if(b.dataset.open){run(()=>open(b.dataset.open));return;}const a=b.dataset.action,id=b.dataset.id||selected;
 if(a==='home') {selected=null;archiveView=false;closeMenu();render();scroll().scrollTo({top:0});}
 if(a==='connect')run(async()=>{const token=$('#token').value.trim();if(!token)return;remember=personalDevice||$('#remember').checked;loading();store=new StoreV1(token);try{await load();}catch(e){store=null;loggedOut(e.status===401?'That token didn’t work. Check it and try again.':'Unable to connect. Try again.');return;}if(remember)credentials.remember(token);else credentials.forget();say('');});
 if(a==='new')run(async()=>{const title=prompt('Name');if(!title?.trim())return;await apply({kind:'create',type:b.dataset.type,id:b.dataset.type.toUpperCase()+'-'+crypto.randomUUID(),title:title.trim(),parent_id:selected});});
 if(a==='archive')run(async()=>{if(confirm('Archive this entire subtree? Progress remains recorded and you can restore it later.')){await apply({kind:'archive',id});selected=null;render();}});
 if(a==='archive-list')run(async()=>{model=await store.archives(remoteBase,model);archiveView=true;closeMenu();preview();});
 if(a==='restore')run(async()=>{model=await store.active(base,model);model=await store.archives(base,model,true);preview();const entry=view.catalog.entries.find(a=>a.id===id),parent=entry.original_parent_id;try{await apply({kind:'restore',id,parent_id:parent});}catch(error){if(view.entities[id].type!=='project')throw error;const choices=Object.values(view.entities).filter(e=>e.type==='section'&&!archived(view,e.id));$('#manage-content').innerHTML=`<h3>Choose a restore destination</h3><p>${esc(error.message)}</p><label class="hq-field">Section<select id="destination">${choices.map(e=>`<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}</select></label>${button('apply-restore','Restore here',`data-id="${esc(id)}"`)}`;}});
 if(a==='apply-restore')run(()=>apply({kind:'restore',id,parent_id:$('#destination').value}));
 if(a==='delete')run(()=>deleteEntity(id));
 if(a==='move')run(async()=>{model=await store.active(base,model);preview();const entity=view.entities[id],choices=Object.values(view.entities).filter(e=>allowed[e.type].includes(entity.type)&&!archived(view,e.id)&&!subtree(view,id).includes(e.id));$('#manage-content').innerHTML=`<h3>Move ${esc(entity.title)}</h3><label class="hq-field">Destination<select id="destination">${entity.type==='task'?'<option value="">Standalone tasks</option>':''}${choices.map(e=>`<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}</select></label>${button('apply-move','Move to destination',`data-id="${esc(id)}"`)}`;});
 if(a==='apply-move')run(()=>apply({kind:'move',id,parent_id:$('#destination').value||null}));
 if(a==='reorder'){$('#manage-content').innerHTML=`<h3>Display order</h3>${view.entities[id].children.map((r,i)=>`<div class="hq-bar"><span>${esc(view.entities[r.id]?.title||r.id)}</span>${i?button('move-up','Move up',`data-child="${esc(r.id)}"`):''}</div>`).join('')}`;}
 if(a==='move-up')run(async()=>{const ids=view.entities[selected].children.map(r=>r.id),i=ids.indexOf(b.dataset.child);if(i>0){[ids[i-1],ids[i]]=[ids[i],ids[i-1]];await apply({kind:'reorder',id:selected,ids});}});
 if(a==='history')run(async()=>{model=await store.history(remoteBase,model,id);preview();const events=Object.entries(model.files).filter(([p])=>p.includes('/history/')).flatMap(([,t])=>decode(t).events||[]);const ids=new Set(subtree(view,id));$('#history-content').innerHTML='<h3>History</h3>'+events.filter(e=>ids.has(e.entity_id)||e.change?.original_markdown&&[...ids].some(id=>e.change.original_markdown.includes(id))).map(e=>`<article><strong>${esc(e.event_type)}</strong><p class="hq-small">Occurred: ${esc(e.occurred_at||'Unknown')} · Recorded: ${esc(e.recorded_at||'Unknown')}</p><pre>${esc(e.change.original_markdown||JSON.stringify(e.change,null,2))}</pre></article>`).join('');});
 if(a==='toggle'){const task=view.entities[id],previous=task.status,status=previous==='Completed'?'Not Started':'Completed';run(()=>apply({kind:'edit',id,fields:{status}},{kind:'edit',id,fields:{status:previous}}));}
 if(a==='undo'&&undoAction){const op=undoAction;toast(null);run(()=>apply(op));}
 if(a==='retry')run(()=>sync());
 if(a==='discard')run(async()=>{ops=[];save();toast(null);await load();});
 if(a==='save-fields')run(()=>{const fields={};for(const el of content.querySelectorAll('fieldset [data-field]'))if(el.dataset.field!=='status')fields[el.dataset.field]=el.value;return apply({kind:'edit',id:selected,fields});});
 if(a==='cancel-fields')render();
});
$('#home').onclick=()=>{if(busy)return;selected=null;archiveView=false;if(store)render();else loggedOut();};
$('#workspace-toggle').onclick=()=>{if(busy)return;const d=$('#workspace-dialog');d.showModal();$('#workspace-toggle').setAttribute('aria-expanded','true');requestAnimationFrame(()=>requestAnimationFrame(()=>d.classList.add('menu-expanded')));};
$('#close-workspaces').onclick=closeMenu;$('#workspace-dialog').addEventListener('cancel',e=>{e.preventDefault();closeMenu();});
$('#refresh').onclick=()=>run(async()=>{closeMenu();await load();});
for(const id of ['forget','logout'])$('#'+id).onclick=()=>{if(busy)return;credentials.forget();store=null;remember=false;closeMenu();loggedOut('This device no longer remembers your access.');};
// Remembered devices go straight to the workspace; the token screen appears only when there is no usable token.
const savedToken=credentials.read();if(!savedToken)loggedOut();else{loading();run(async()=>{store=new StoreV1(savedToken);remember=true;try{await load();}catch(e){if(e.status===401)throw e;store=null;loggedOut('Unable to connect. Try again.');}});}
