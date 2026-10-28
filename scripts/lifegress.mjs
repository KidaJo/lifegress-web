// Command-line writer for AI agents. Changes go through the same transaction and validation as the app,
// so history, derived completion and references stay consistent. Never hand-edit V1 record files.
// Usage: node scripts/lifegress.mjs <path-to-personal-hq> <command> [args] [--actor NAME --source TEXT] [--occurred DATE] [--dry-run]
import {writeFile,mkdir,unlink,readFile} from 'node:fs/promises';
import {join,dirname,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalize,validate,transact,diff,counts,statuses,crewSlug,serialize} from '../data-v1.mjs';
import {loadData,expectedContributors} from './check-data.mjs';

const usage=`Commands:
  show [id]                                  Print the active tree, or one record and its children
  status <task-id> "<${statuses.join('|')}>"
  title <id> "<text>"
  note <id> "<text>"                         Use "" to clear
  date <id> planned|completed <YYYY|YYYY-MM|YYYY-MM-DD|none>
  create <section|project|stage|task> "<title>" [--parent <id>]
  move <id> --parent <id|none>              Move a record (and everything under it) to a new parent
  archive <section-or-project-id>           Archive a workspace or project with its history
  reorder <parent-id> <child-id>...         Put these children first, in this order (others keep their order after them)
  sync-contributors                          Rebuild every record's contributors from History (no History change)
  avatar <crew-id> <image.jpg|png|svg>       Set a crew member's photo (square, about 256×256, max 300 KB; no History change)
Write options: --actor "Claude" (who records it) [--provider "ChatGPT" (who provided the information; credited in the app)] --source "evidence" [--occurred YYYY-MM-DD] [--dry-run]`;

function parse(argv){const args=[],opts={};for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--dry-run')opts.dryRun=true;else if(a.startsWith('--')){if(i+1>=argv.length)throw Error(`${a} needs a value`);opts[a.slice(2)]=argv[++i];}else args.push(a);}return {args,opts};}

function label(m,e){if(e.type==='task')return e.status;const c=counts(m,e.id);return c.total?`${c.status} · ${Math.round(c.progress)}%`:'No tasks yet';}
function tree(m,refs,depth=0,out=[]){for(const r of refs){const e=m.entities[r.id];if(!e)continue;out.push(`${'  '.repeat(depth)}${e.id}  [${e.type}] ${e.title} — ${label(m,e)}`);tree(m,e.children||[],depth+1,out);}return out;}

export function operation(m,command,args,opts){
 const need=(n,what)=>{if(args.length<n)throw Error(`Missing ${what}.\n${usage}`);};
 const entity=id=>{const e=m.entities[id];if(!e)throw Error(`Unknown id: ${id}`);return e;};
 if(command==='status'){need(2,'task id and status');if(entity(args[0]).type!=='task')throw Error('Only Task status is editable; container status is derived.');if(!statuses.includes(args[1]))throw Error(`Status must be one of: ${statuses.join(', ')}`);return {kind:'edit',id:args[0],fields:{status:args[1]}};}
 if(command==='title'){need(2,'id and title');entity(args[0]);if(!args[1].trim())throw Error('Title cannot be empty.');return {kind:'edit',id:args[0],fields:{title:args[1].trim()}};}
 if(command==='note'){need(2,'id and note');entity(args[0]);return {kind:'edit',id:args[0],fields:{note:args[1]}};}
 if(command==='date'){need(3,'id, planned|completed and value');const e=entity(args[0]);const field={planned:'planned_completion',completed:'actual_completion'}[args[1]];if(!field)throw Error('Use planned or completed.');if(e.type==='section')throw Error('Sections have no dates.');return {kind:'edit',id:args[0],fields:{[field]:args[2]==='none'?'':args[2]}};}
 if(command==='move'){need(1,'id');entity(args[0]);if(!('parent' in opts))throw Error('Use --parent <id> or --parent none.');const parent=opts.parent==='none'?null:opts.parent;if(parent)entity(parent);return {kind:'move',id:args[0],parent_id:parent};}
 if(command==='archive'){need(1,'id');const e=entity(args[0]);if(!['section','project'].includes(e.type))throw Error('Only workspaces (sections) and projects can be archived.');return {kind:'archive',id:args[0]};}
 if(command==='reorder'){need(2,'parent id and child ids');const e=entity(args[0]);const ids=args.slice(1),old=(e.children||[]).map(r=>r.id);const rest=old.filter(x=>!ids.includes(x));return {kind:'reorder',id:args[0],ids:[...ids,...rest]};}
 if(command==='create'){need(2,'type and title');const type=args[0];if(!['section','project','stage','task'].includes(type))throw Error('Unknown type: '+type);if(opts.parent)entity(opts.parent);return {kind:'create',type,id:type.toUpperCase()+'-'+crypto.randomUUID(),title:args[1].trim(),parent_id:opts.parent||null};}
 throw Error(`Unknown command: ${command}\n${usage}`);
}

export async function main(argv,log=console.log){
 const {args,opts}=parse(argv);const [dir,command,...rest]=args;
 if(!dir||!command)throw Error(usage);
 const data=await loadData(dir);if(data.errors.length)throw Error('Data check failed before writing:\n- '+data.errors.join('\n- '));
 const model=normalize(data.files);
 // sync-contributors repairs contributor lists, so it must not reject the stale ones it is about to replace.
 if(command==='sync-contributors')for(const e of Object.values(model.entities))delete e.contributors;
 validate(model);
 if(command==='show'){const id=rest[0];if(id&&!model.entities[id])throw Error('Unknown id: '+id);const lines=id?tree(model,[{id}]):tree(model,model.index.children);for(const l of lines)log(l);return {changes:[]};}
 if(command==='sync-contributors'){const expected=expectedContributors(model),next=structuredClone(model);for(const e of Object.values(next.entities)){const want=expected[e.id]||[];if(want.length)e.contributors=want;else delete e.contributors;}validate(next);const files=serialize(next);const changes=diff(data.files,files);if(!opts.dryRun)for(const c of changes)await writeFile(join(data.dir,c.path),c.after);log(`${opts.dryRun?'Dry run — would update':'Updated'} contributors in ${changes.length} file(s).`);return {changes};}
 if(command==='avatar'){const [id,file]=rest;if(!id||!file)throw Error('Usage: avatar <crew-id> <image.jpg|png|svg>');
  const c=model.crew.members.find(x=>x.id===id);if(!c)throw Error('Unknown crew member: '+id);
  const ext=extname(file).toLowerCase().replace('.jpeg','.jpg');if(!['.jpg','.png','.svg'].includes(ext))throw Error('Use a .jpg, .png or .svg file.');
  const bytes=await readFile(file);if(bytes.length>300000)throw Error('Image is larger than 300 KB. Crop it to a square of about 256×256 first.');
  if(ext==='.svg'&&/<script|\bon\w+\s*=|(?:href|src)\s*=\s*["']?\s*(?:https?:|javascript:|data:)/i.test(bytes.toString('utf8')))throw Error('SVG must not contain scripts or external links.');
  const path=`assets/avatars/${id}-${Date.now().toString(36)}${ext}`,after=transact(model,[{kind:'crew',id,avatar:path}]);validate(after);const changes=diff(model.files,after.files);
  if(!opts.dryRun){await mkdir(join(data.dir,'assets/avatars'),{recursive:true});await writeFile(join(data.dir,path),bytes);for(const ch of changes)await writeFile(join(data.dir,ch.path),ch.after);if(c.avatar&&c.avatar!==path)await unlink(join(data.dir,c.avatar)).catch(()=>{});}
  log(`${opts.dryRun?'Dry run — would set':'Set'} ${c.name}'s photo to ${path}${c.avatar?` (replacing ${c.avatar})`:''}.`);return {changes,path};}
 if(!opts.actor||!opts.source)throw Error('Writes require --actor and --source so History records who changed what and why.');
 const op=operation(model,command,rest,opts);
 // The contributor shown in the app is whoever provided the information: --provider when an agent records it for someone
 // else (for example ChatGPT's report), otherwise --actor. Names match crew id, name or alias; a new name joins My Crew.
 const find=name=>{const wanted=name.trim().toLowerCase();return model.crew.members.find(c=>[c.id,c.name,...(c.aliases||[])].some(a=>a&&a.toLowerCase()===wanted));};
 const credited=(opts.provider??opts.actor).trim(),member=find(credited);
 const contributor=member?.id??crewSlug(credited);if(!contributor)throw Error('--actor / --provider must contain letters or digits.');if(contributor==='owner'&&!member)throw Error('Use the Owner\'s crew name for owner edits.');
 const recorder=find(opts.actor)?.name??opts.actor.trim(),name=member?.name??credited;
 const recordedBy=opts.provider&&recorder.toLowerCase()!==name.toLowerCase()?recorder:null;
 const after=transact(model,[op],{actor:recordedBy?`${name} (recorded by ${recorder})`:name,contributor,contributorName:credited,recordedBy,source:opts.source,occurred_at:opts.occurred??null});validate(after);
 const changes=diff(model.files,after.files);
 if(!changes.length){log('No changes: the record already has this value.');return {changes};}
 if(!opts.dryRun)for(const c of changes){const p=join(data.dir,c.path);if(c.after==null)await unlink(p);else{await mkdir(dirname(p),{recursive:true});await writeFile(p,c.after);}}
 log(`${opts.dryRun?'Dry run — would change':'Changed'} ${changes.length} file(s):`);for(const c of changes)log(`  ${c.after==null?'delete':c.before==null?'create':'update'} ${c.path}`);
 if(op.kind==='create')log(`New id: ${op.id}`);
 return {changes,op};
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{await main(process.argv.slice(2));}catch(e){console.error(e.message);process.exit(1);}
}
