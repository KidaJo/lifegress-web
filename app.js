import {GitHub} from './github.mjs';
let github=null;
const $=s=>document.querySelector(s), content=$('#content'), nav=$('nav');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groups=[['all','All Projects'],['commercial-photography','Commercial Photography'],['work','Marriott'],['apps','App Development'],['digital','Digital Assets'],['finance','Finance'],['business','Side Income'],['personal','Personal'],['career','Career'],['system','System']];
let base='',projects=[],drafts={},csrf='',selected=null,category='all',review=null,busy=false;
const key='lifegress:KidaJo/personal-hq:drafts:v1';
function message(text){$('#hq-message').textContent=text;}
function save(){review=null;try{localStorage.setItem(key,JSON.stringify({base,drafts}));}catch{message('Browser storage unavailable. Export drafts before closing.');}updateCount();}
function count(){return Object.entries(drafts).filter(([path,d])=>{const p=projects.find(p=>p.path===path);return d.note?.trim() || Object.entries(d.tasks||{}).some(([id,v])=>p?.tasks.find(t=>t.id===id)?.done!==v);}).length;}
function updateCount(){const n=count();$('#pending').textContent=n?`${n} projects with pending changes`:'No pending changes';const b=$('[data-action="review"]');if(b)b.disabled=!n;const discard=$('[data-action="discard"]');if(discard)discard.disabled=!n;}
async function api(path,data){
 if(!github)throw Error('Connect with your repository access token first.');
 if(path==='projects')return github.load();
 if(path==='compare')return github.compare(data.base,data.drafts);
 if(path==='publish')return review.commit?github.verify(review):github.commit(review);
 throw Error('Unsupported operation');
}
function connectScreen(){
 content.innerHTML=`<h2>Your projects, together.</h2><p>Use a fine-grained GitHub token limited to personal-hq, with Contents read and write permission.</p><label class="hq-field"><span>Repository access token</span><input id="token" type="password" autocomplete="off" spellcheck="false"></label><p class="hq-small">Kept in this page’s memory only. Reloading or disconnecting clears it. Never send it in chat.</p>${action('connect','Connect GitHub')}`;
 nav.innerHTML='';$('#version').textContent='Not connected';
}

function action(name,label,disabled=false){return `<button class="hq-action" data-action="${name}" ${disabled?'disabled':''}>${label}</button>`;}
function render(){
 nav.innerHTML=groups.map(([id,label])=>`<button data-category="${id}" aria-pressed="${category===id}">${label}</button>`).join('');
 const p=projects.find(p=>p.path===selected);
 const toolbar=`<div class="hq-bar">${action('review','Review Changes',!count())}${action('export','Export Drafts')}${action('discard','Discard Drafts',!count())}</div>`;
 if(!p){content.innerHTML=`<h2>${esc(groups.find(g=>g[0]===category)?.[1])}</h2>${toolbar}<div class="hq-list">${projects.filter(p=>category==='all'||p.category===category).map(p=>`<button class="hq-project" data-project="${esc(p.path)}"><span class="hq-project-info"><span class="hq-project-name">${esc(p.name)}</span><span class="hq-small"> · ${esc(p.id)}</span></span><span class="hq-status">${esc(p.status)}</span></button>`).join('')}</div>`;}
 else{const d=drafts[p.path]||{tasks:{},note:'',date:''};content.innerHTML=`${action('back','← All Projects')}<h2>${esc(p.name)}</h2><span class="hq-tag">${esc(p.status)}</span><p class="hq-small">${esc(p.id)} · ${esc(p.confidence)}</p>${toolbar}<p>${esc(p.summary)}</p><h3>Tasks</h3>${p.tasks.map(t=>`<label class="hq-task"><input type="checkbox" data-task="${esc(t.id)}" ${(d.tasks[t.id]??t.done)?'checked':''}><span>${esc(t.label)}<small class="hq-small"> · ${esc(t.detail.split(' | ')[1]||'')}</small></span></label>`).join('')||'<p>No tasks recorded.</p>'}<h3>Add Progress</h3><label class="hq-field"><span>Note</span><textarea id="note" maxlength="2000">${esc(d.note)}</textarea></label><label class="hq-field"><span>Effective date (leave blank if unknown)</span><input id="date" type="date" value="${esc(d.date)}"></label><h3>Next Steps</h3><pre>${esc(p.next)}</pre><details><summary>Milestones & History</summary><pre>${esc(p.milestones+'\n\n'+p.history)}</pre></details>`;}
 updateCount();
}
function draft(){return drafts[selected]??=( {tasks:{},note:'',date:''} );}
function renderReview(){content.innerHTML=`<h2>Review Changes</h2><p>${count()} projects in this batch. Compare does not publish.</p>${Object.entries(drafts).filter(([,d])=>d.note?.trim()||Object.keys(d.tasks).length).map(([path,d])=>`<div class="hq-change"><strong>${esc(projects.find(p=>p.path===path)?.name||path)}</strong><pre>${esc(JSON.stringify(d,null,2))}</pre></div>`).join('')}<div class="hq-bar">${action('compare','Compare with GitHub')}${action('back','Back')}${action('export','Export Drafts')}</div>`;}
async function load(){
 const data=await api('projects');projects=data.projects;
 let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 drafts=saved?.drafts||{};base=Object.keys(drafts).length?saved.base:data.base;
 $('#version').textContent=`GitHub · ${data.base.slice(0,7)}`;
 if(base!==data.base)message('Remote version changed. Drafts retained. Export drafts before discarding and refreshing; publishing is blocked until reconciled.');
 render();
}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){message(e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);updateCount();}}
content.addEventListener('input',e=>{if(e.target.id==='note'){draft().note=e.target.value;save();}if(e.target.id==='date'){draft().date=e.target.value;save();}});
content.addEventListener('change',e=>{if(e.target.dataset.task){const id=e.target.dataset.task,p=projects.find(p=>p.path===selected);if(e.target.checked===p.tasks.find(t=>t.id===id).done)delete draft().tasks[id];else draft().tasks[id]=e.target.checked;save();}});
nav.addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(b&&!busy){category=b.dataset.category;selected=null;render();}});
content.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||busy)return;
 if(b.dataset.project){selected=b.dataset.project;category=projects.find(p=>p.path===selected).category;render();return;}
 const a=b.dataset.action;
 if(a==='connect')run(async()=>{const token=$('#token').value.trim();if(!token)throw Error('Enter your token.');github=new GitHub(token);$('#token').value='';try{await load();message('Connected to your private repository.');}catch(e){github=null;throw e;}});
 if(a==='back'){selected=null;render();}
 if(a==='review')renderReview();
 if(a==='discard'&&confirm('Discard all local drafts? GitHub will not change.')){drafts={};save();render();}
 if(a==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify({base,drafts},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='lifegress-drafts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(a==='compare')run(async()=>{message('Comparing with GitHub…');review=await api('compare',{base,drafts});content.innerHTML=`<h2>Review before publishing</h2><p>Only the files below will change.</p>${review.changes.map(c=>`<h3>${esc(c.path)}</h3><details><summary>Before</summary><pre>${esc(c.before)}</pre></details><details open><summary>After</summary><pre>${esc(c.after)}</pre></details>`).join('')}<div class="hq-bar">${action('publish','Approve & Publish')}${action('back','Keep Editing')}</div>`;message('Comparison complete. Nothing published.');});
 if(a==='publish')run(async()=>{if(!review)return;message('Publishing and verifying…');const r=await api('publish',{review:review.id,confirm:true});if(r.verified){drafts={};base=r.base;save();await load();message('Published and verified on GitHub.');}});
});
$('#refresh').onclick=()=>run(async()=>{await load();});
$('#logout').onclick=()=>run(async()=>{if(count()&&!confirm('Sign out? Drafts remain in this browser. Export them first on a shared device.'))return;github=null;review=null;projects=[];drafts={};selected=null;connectScreen();message('Disconnected. Saved drafts remain in this browser.');});
connectScreen();
