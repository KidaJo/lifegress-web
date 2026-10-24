import {credentialStore} from './credentials.mjs';
let storage;try{storage=localStorage;}catch{}
const credentials=credentialStore(storage);
import {GitHub} from './github.mjs';
let github=null;
const $=s=>document.querySelector(s), content=$('#content'), nav=$('#desktop-workspaces nav');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groups=[['all','All Projects'],['commercial-photography','Commercial Photography'],['work','Marriott'],['apps','App Development'],['digital','Digital Assets'],['finance','Finance'],['business','Side Income'],['personal','Personal'],['career','Career'],['system','System']];
let base='',projects=[],drafts={},csrf='',selected=null,category='all',review=null,busy=false;
let workspaceHome=false; const small=matchMedia('(max-width: 720px)');
const key='lifegress:KidaJo/personal-hq:drafts:v1';
function message(text){$('#hq-message').textContent=text;}
function save(){review=null;try{localStorage.setItem(key,JSON.stringify({base,drafts}));}catch{message('Browser storage unavailable. Export drafts before closing.');}updateCount();}
function count(){return Object.entries(drafts).filter(([path,d])=>{const p=projects.find(p=>p.path===path);return d.note?.trim() || Object.entries(d.tasks||{}).some(([id,v])=>!p?.loaded || p.tasks.find(t=>t.id===id)?.done!==v);}).length;}
function updateCount(){const n=count();$('#pending').textContent=n?`${n} projects with pending changes`:'No pending changes';const b=$('[data-action="review"]');if(b)b.disabled=!n;const discard=$('[data-action="discard"]');if(discard)discard.disabled=!n;}
async function api(path,data){
 if(!github)throw Error('Connect with your repository access token first.');
 if(path==='projects')return github.load();
 if(path==='compare')return github.compare(data.base,data.drafts);
 if(path==='publish')return review.commit?github.verify(review):github.commit(review);
 throw Error('Unsupported operation');
}
function connectScreen(){
 $('#workspace-toggle').hidden=true;$('#connection-menu').hidden=true;$('#refresh').hidden=true;
 content.innerHTML=`<div class="lf-connect"><p class="lf-eyebrow">YOUR PERSONAL WORKSPACE</p><h2>A little clarity.<br>A lot of possibility.</h2><p class="lf-lead">Your projects. Your progress. Together in Lifegress.</p><p class="hq-small">Connect with a GitHub token limited to personal-hq, with Contents read and write permission.</p><label class="hq-field"><span>Repository access token</span><input id="token" type="password" autocomplete="off" spellcheck="false"></label><label class="lf-remember"><input id="remember" type="checkbox">Remember on this device</label><p class="hq-small">Optional. Saves your token in this browser, not in Apple Keychain. Use only on your own device.</p>${action('connect','Connect GitHub')}${credentials.read()?action('forget-credential','Forget saved connection'):''}</div>`;
 nav.innerHTML='';$('#version').textContent='Not connected';
}

function action(name,label,disabled=false){return `<button class="hq-action" data-action="${name}" ${disabled?'disabled':''}>${label}</button>`;}
function render(){
 nav.innerHTML=groups.map(([id,label])=>`<button data-category="${id}" aria-pressed="${category===id}">${label}</button>`).join('');
 $('#mobile-workspaces').innerHTML=nav.innerHTML;
 $('#workspace-toggle').hidden=false;$('#connection-menu').hidden=false;$('#refresh').hidden=false;
 const p=projects.find(p=>p.path===selected);
 const toolbar=`<div class="hq-bar hq-main-actions">${action('review','Review Changes',!count())}<span class="hq-small">${count()?count()+' projects with unsaved changes':'All changes saved'}</span></div>`;
 if(workspaceHome && small.matches){content.innerHTML=`<h2>Workspaces</h2><p class="hq-small">Choose a workspace to see your projects.</p><div class="hq-workspace-grid">${groups.map(([id,label])=>`<button class="hq-project" data-category="${id}"><span>${label}</span><span class="hq-small">${projects.filter(p=>!p.parent&&(id==='all'||p.category===id)).length} ›</span></button>`).join('')}</div>`;updateCount();return;}
 if(!p){content.innerHTML=`<h2>${esc(groups.find(g=>g[0]===category)?.[1])}</h2>${toolbar}<div class="hq-list">${projects.filter(p=>category==='all'||p.category===category).map(p=>`<button class="hq-project" data-project="${esc(p.path)}"><span class="hq-project-info"><span class="hq-project-name">${esc(p.name)}</span><span class="hq-small"> · ${esc(p.id)}</span></span><span class="hq-status">${esc(p.status)}</span></button>`).join('')}</div>`;}
 else{const d=drafts[p.path]||{tasks:{},note:'',date:''};content.innerHTML=`${action('back','← '+esc(groups.find(g=>g[0]===category)?.[1]||'Projects'))}<h2>${esc(p.name)}</h2><span class="hq-tag">${esc(p.status)}</span><p class="hq-small">${esc(p.id)} · ${esc(p.confidence)}</p>${toolbar}<p>${esc(p.summary)}</p><h3>Tasks</h3>${p.tasks.map(t=>`<label class="hq-task"><input type="checkbox" data-task="${esc(t.id)}" ${(d.tasks[t.id]??t.done)?'checked':''}><span>${esc(t.label)}<small class="hq-small"> · ${esc(t.detail.split(' | ')[1]||'')}</small></span></label>`).join('')||'<p>No tasks recorded.</p>'}<h3>Add Progress</h3><label class="hq-field"><span>Note</span><textarea id="note" maxlength="2000">${esc(d.note)}</textarea></label><label class="hq-field"><span>Effective date (leave blank if unknown)</span><input id="date" type="date" value="${esc(d.date)}"></label><h3>Next Steps</h3><pre>${esc(p.next)}</pre><details><summary>Milestones & History</summary><pre>${esc(p.milestones+'\n\n'+p.history)}</pre></details>`;}
 updateCount();
}
function draft(){return drafts[selected]??=( {tasks:{},note:'',date:''} );}
function renderReview(){content.innerHTML=`<h2>Review Changes</h2><p>${count()} projects in this batch. Compare does not publish.</p>${Object.entries(drafts).filter(([,d])=>d.note?.trim()||Object.keys(d.tasks).length).map(([path,d])=>`<div class="hq-change"><strong>${esc(projects.find(p=>p.path===path)?.name||path)}</strong><pre>${esc(Object.entries(d.tasks).map(([id,done])=>{const t=projects.find(p=>p.path===path)?.tasks.find(t=>t.id===id);return (t?.label||id)+' → '+(done?'Completed':'Pending');}).join('\n')+(d.note?.trim()?'\nNote: '+d.note.trim():'')+'\nEffective date: '+(d.date||'Unknown'))}</pre></div>`).join('')}<div class="hq-bar">${action('compare','Compare with GitHub')}${action('back','Back')}</div><details class="hq-draft-tools"><summary>Draft options</summary><p class="hq-small">Download a JSON backup of unsaved changes, or discard them. Neither action changes GitHub.</p><div class="hq-bar">${action('export','Download Draft Backup')}${action('discard','Discard Unsaved Changes',!count())}</div></details>`;}
async function load(){
 const data=await api('projects');projects=data.projects;
 const openProject=projects.find(p=>p.path===selected);if(openProject&&!openProject.loaded)Object.assign(openProject,await github.project(data.base,selected));
 let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 drafts=saved?.drafts||{};base=Object.keys(drafts).length?saved.base:data.base;
 $('#version').textContent=`GitHub · ${data.base.slice(0,7)}`;
 if(base!==data.base)message('Remote version changed. Drafts retained. Export drafts before discarding and refreshing; publishing is blocked until reconciled.');
 render();
}
async function run(fn){if(busy)return;busy=true;$('#hq-manual').setAttribute('aria-busy','true');document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){message(e.message);}finally{busy=false;$('#hq-manual').setAttribute('aria-busy','false');document.querySelectorAll('button').forEach(b=>b.disabled=false);updateCount();}}
content.addEventListener('input',e=>{if(e.target.id==='note'){draft().note=e.target.value;save();}if(e.target.id==='date'){draft().date=e.target.value;save();}});
content.addEventListener('change',e=>{if(e.target.dataset.task){const id=e.target.dataset.task,p=projects.find(p=>p.path===selected);if(e.target.checked===p.tasks.find(t=>t.id===id).done)delete draft().tasks[id];else draft().tasks[id]=e.target.checked;save();}});
function chooseCategory(id){category=id;selected=null;workspaceHome=false;$('#workspace-dialog').close();$('#workspace-toggle').setAttribute('aria-expanded','false');render();}
for(const node of [nav,$('#mobile-workspaces')])node.addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(b&&!busy)chooseCategory(b.dataset.category);});
$('#workspace-toggle').onclick=()=>{$('#workspace-dialog').showModal();$('#workspace-toggle').setAttribute('aria-expanded','true');};
$('#close-workspaces').onclick=()=>$('#workspace-dialog').close();
$('#workspace-dialog').addEventListener('close',()=>{$('#workspace-toggle').setAttribute('aria-expanded','false');$('#workspace-toggle').focus();});
small.addEventListener('change',()=>{if(github&&!busy&&!review)render();});
content.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||busy)return;
 if(b.dataset.category){chooseCategory(b.dataset.category);return;}
 if(b.dataset.project){run(async()=>{const path=b.dataset.project,p=projects.find(p=>p.path===path);message('Loading project…');if(!p.loaded)Object.assign(p,await github.project(base,path));selected=path;category=p.category;render();message('');});return;}
 const a=b.dataset.action;
 if(a==='forget-credential'){if(credentials.forget()){github=null;connectScreen();message('Saved token removed.');}else message('Unable to remove saved token. Clear site data in browser settings.');}
 if(a==='connect')run(async()=>{const token=$('#token').value.trim();if(!token)throw Error('Enter your token.');github=new GitHub(token);const remember=$('#remember').checked;$('#token').value='';try{workspaceHome=small.matches;message('Loading your workspaces…');b.textContent='Connecting…';await load();const stored=remember?credentials.remember(token):credentials.forget();message(stored?'Connected to your private repository.':'Connected for this visit. Browser storage could not be updated.');}catch(e){github=null;b.textContent='Connect GitHub';throw e;}});
 if(a==='back'){selected=null;render();}
 if(a==='review')renderReview();
 if(a==='discard'&&confirm('Discard all local drafts? GitHub will not change.')){drafts={};save();render();}
 if(a==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify({base,drafts},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='lifegress-drafts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(a==='compare')run(async()=>{message('Comparing with GitHub…');review=await api('compare',{base,drafts});content.innerHTML=`<h2>Review before publishing</h2><p>Only the files below will change.</p>${review.changes.map(c=>`<h3>${esc(c.path)}</h3><details><summary>Before</summary><pre>${esc(c.before)}</pre></details><details open><summary>After</summary><pre>${esc(c.after)}</pre></details>`).join('')}<div class="hq-bar">${action('publish','Approve & Publish')}${action('back','Keep Editing')}</div>`;message('Comparison complete. Nothing published.');});
 if(a==='publish')run(async()=>{if(!review)return;message('Publishing and verifying…');const r=await api('publish',{review:review.id,confirm:true});if(r.verified){drafts={};base=r.base;save();await load();message('Published and verified on GitHub.');}});
});
$('#refresh').onclick=()=>run(async()=>{message('Checking for updates…');await load();if(base===github.snapshot.base)message('Up to date.');});
$('#forget').onclick=()=>run(async()=>{if(!credentials.forget())throw Error('Could not clear browser storage. Clear site data in browser settings.');github=null;review=null;projects=[];drafts={};selected=null;connectScreen();message('Device forgotten. Your drafts were kept.');});
$('#logout').onclick=()=>run(async()=>{if(count()&&!confirm('Sign out? Drafts remain in this browser. Export them first on a shared device.'))return;if(!credentials.forget())throw Error('Could not clear the saved token. Clear site data in browser settings.');github=null;review=null;projects=[];drafts={};selected=null;connectScreen();message('Disconnected and saved token removed. Drafts remain in this browser.');});
connectScreen();
run(async()=>{const token=credentials.read();if(!token)return;github=new GitHub(token);workspaceHome=small.matches;message('Connecting to your workspace…');try{await load();message('Connected.');}catch(e){github=null;if(e.status===401)credentials.forget();connectScreen();message(e.status===401?'Saved token expired or was revoked. Enter a new token.':'Could not reconnect. Your saved token is unchanged; reload to retry or enter a token.');}});
