const randomUUID = () => globalThis.crypto.randomUUID();
export const projectPath = p => /^projects\/[a-z-]+\/[A-Z]+-\d{3}\.md$/.test(p);
export function section(text, title) {
  return text.split(`## ${title}\n`)[1]?.split(/\n## /)[0]?.trim() || '';
}
export function parseProject(path, text) {
  const field = name => text.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'm'))?.[1] || '';
  return {path, id:field('Stable Project ID'), name:field('Project Name'), category:field('Category'),
    status:field('Status'), confidence:field('Status Confidence'), parent:field('Parent Project'),
    summary:section(text,'Current Summary'), next:section(text,'Next Actions'),
    milestones:section(text,'Milestones'), history:section(text,'Progress History'),
    tasks:[...section(text,'Task Checklist').matchAll(/^- \[([ xX])\] \*\*([^*]+)\*\* (.+)$/gm)].map(m=>({id:m[2],done:m[1].toLowerCase()==='x',label:m[3].split(' | ')[0],detail:m[3]}))};
}
const cell = value => String(value).replace(/\|/g,'&#124;').replace(/[\r\n]+/g,' ').trim();
export function applyEdit(path, original, edit, now = new Date().toISOString()) {
  if(!projectPath(path) || !edit || typeof edit !== 'object') throw Error('Invalid project edit');
  const p=parseProject(path,original);
  if(!p.id || !original.includes('## Progress History\n')) throw Error('Unsupported project format');
  const date=edit.date || 'Unconfirmed';
  if(date!=='Unconfirmed' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) throw Error('Invalid effective date');
  if(typeof edit.note!=='string' || edit.note.length>2000 || !edit.tasks || typeof edit.tasks!=='object' || Array.isArray(edit.tasks)) throw Error('Invalid draft');
  let updated=original; const events=[];
  for(const [id,done] of Object.entries(edit.tasks)) {
    const task=p.tasks.find(t=>t.id===id);
    if(!task || typeof done!=='boolean') throw Error('Unknown task');
    if(task.done===done) continue;
    const before=original.split('\n').find(l=>l.startsWith(`- [${task.done?'x':' '}] **${id}**`));
    if(!before || !before.includes(' | Completed At: ')) throw Error('Unsupported task format');
    const after=before.replace(/^- \[[ x]\]/,done?'- [x]':'- [ ]').replace(/ \| Completed At: [^|]+/,` | Completed At: ${done?date:'Not completed'} `);
    updated=updated.replace(before,after);
    events.push(`${id}: ${task.done?'Completed':'Pending'} → ${done?'Completed':'Pending'}`);
  }
  if(edit.note.trim()) events.push(`Progress note: ${edit.note.trim()}`);
  if(!events.length) return original;
  const suffix=events.map(change=>`\n- **Event ID:** ${p.id}-WEB-${randomUUID()}\n  - **Recorded At:** ${now}\n  - **Effective At:** ${date}\n  - **Change:** ${cell(change)}\n  - **Updated By:** Owner via Lifegress\n  - **Evidence:** Owner-reviewed web edit\n  - **Confidence:** Confirmed\n`).join('');
  const start=updated.indexOf('## Progress History\n')+'## Progress History\n'.length;
  const end=updated.indexOf('\n## ',start);
  const at=end<0?updated.length:end;
  return updated.slice(0,at)+'\n'+suffix+updated.slice(at);
}
