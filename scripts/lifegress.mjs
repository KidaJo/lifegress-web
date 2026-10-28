// Command-line writer for AI agents. Changes go through the same transaction and validation as the app,
// so history, derived completion and references stay consistent. Never hand-edit V1 record files.
// Usage: node scripts/lifegress.mjs <path-to-personal-hq> <command> [args] [--actor NAME --source TEXT] [--occurred DATE] [--dry-run]
import {writeFile,mkdir,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
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
  sync-contributors                          Rebuild every record's contributors from History (no History change)
Write options: --actor "Claude" (crew name; new names join My Crew) --source "evidence" [--occurred YYYY-MM-DD] [--dry-run]`;

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
 if(command==='create'){need(2,'type and title');const type=args[0];if(!['section','project','stage','task'].includes(type))throw Error('Unknown type: '+type);if(opts.parent)entity(opts.parent);return {kind:'create',type,id:type.toUpperCase()+'-'+crypto.randomUUID(),title:args[1].trim(),parent_id:opts.parent||null};}
 throw Error(`Unknown command: ${command}\n${usage}`);
}

export async function main(argv,log=console.log){
 const {args,opts}=parse(argv);const [dir,command,...rest]=args;
 if(!dir||!command)throw Error(usage);
 const data=await loadData(dir);if(data.errors.length)throw Error('Data check failed before writing:\n- '+data.errors.join('\n- '));
 const model=normalize(data.files);validate(model);
 if(command==='show'){const id=rest[0];if(id&&!model.entities[id])throw Error('Unknown id: '+id);const lines=id?tree(model,[{id}]):tree(model,model.index.children);for(const l of lines)log(l);return {changes:[]};}
 if(command==='sync-contributors'){const expected=expectedContributors(model),next=structuredClone(model);for(const e of Object.values(next.entities)){const want=expected[e.id]||[];if(want.length)e.contributors=want;else delete e.contributors;}validate(next);const files=serialize(next);const changes=diff(model.files,files);if(!opts.dryRun)for(const c of changes)await writeFile(join(data.dir,c.path),c.after);log(`${opts.dryRun?'Dry run — would update':'Updated'} contributors in ${changes.length} file(s).`);return {changes};}
 if(!opts.actor||!opts.source)throw Error('Writes require --actor and --source so History records who changed what and why.');
 const op=operation(model,command,rest,opts);
 // --actor names a crew member (id, name or alias); a new name joins My Crew automatically.
 const wanted=opts.actor.trim().toLowerCase(),member=model.crew.members.find(c=>[c.id,c.name,...(c.aliases||[])].some(a=>a&&a.toLowerCase()===wanted));
 const contributor=member?.id??crewSlug(opts.actor);if(!contributor)throw Error('--actor must contain letters or digits.');if(contributor==='owner'&&!member)throw Error('Use the Owner\'s crew name for owner edits.');
 const after=transact(model,[op],{actor:member?.name??opts.actor.trim(),contributor,contributorName:opts.actor.trim(),source:opts.source,occurred_at:opts.occurred??null});validate(after);
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
