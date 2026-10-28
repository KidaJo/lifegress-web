import {projectPath,parseProject,applyEdit} from './model.mjs';
const repo='/repos/KidaJo/personal-hq';
export class GitHub {
  constructor(token, transport=(...args)=>globalThis.fetch(...args)){this.token=token;this.transport=transport;}
  async call(path,method='GET',body){
    const r=await this.transport('https://api.github.com'+path,{method,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!r.ok){const error=Error(`GitHub request failed (${r.status}). Reconnect or retry; your drafts remain saved.`);error.status=r.status;throw error;}
    return r.json();
  }
  async head(){return (await this.call(repo+'/git/ref/heads/main')).object.sha;}
  async files(sha, paths=null){
    if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid base version');
    const commit=await this.call(repo+'/git/commits/'+sha);
    const tree=await this.call(repo+'/git/trees/'+commit.tree.sha+'?recursive=1');
    if(tree.truncated)throw Error('Repository tree exceeds supported size');
    const entries=tree.tree.filter(e=>e.type==='blob' && projectPath(e.path) && (!paths || paths.includes(e.path)));
    if(entries.length>100)throw Error('Project limit exceeded');
    const files={};
    for(const e of entries){
      const blob=await this.call(repo+'/git/blobs/'+e.sha);
      if(blob.encoding!=='base64' || blob.size>200000)throw Error('Unsupported project file');
      files[e.path]=new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')), c=>c.charCodeAt(0)));
    }
    return {files,tree:commit.tree.sha};
  }
  async load(){
    const base=await this.head();
    if(this.snapshot?.base===base)return this.snapshot;
    const doc=await this.call(repo+'/contents/README.md?ref='+base);
    const text=new TextDecoder().decode(Uint8Array.from(atob(doc.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));
    const projects=[...text.matchAll(/^\| ([A-Z]+-\d{3}) \| \[([^\]]+)\]\((projects\/[a-z-]+\/[A-Z]+-\d{3}\.md)\) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm)].map(m=>({id:m[1],name:m[2],path:m[3],category:m[3].split('/')[1],status:m[4].trim(),confidence:m[5].trim(),parent:m[6].trim()==='-'?'':m[6].trim(),tasks:[],loaded:false}));
    if(!projects.length)throw Error('Project registry could not be read. No data changed.');
    return this.snapshot={base,projects};
  }
  async project(base,path){const {files}=await this.files(base,[path]);if(!files[path])throw Error('Project no longer exists');return {...parseProject(path,files[path]),loaded:true};}
  async compare(base,drafts){
    if(await this.head()!==base)throw Error('GitHub has changed. Export your drafts, then refresh and reconcile before publishing.');
    if(!drafts || Array.isArray(drafts) || typeof drafts!=='object' || Object.keys(drafts).length>100)throw Error('Invalid draft batch');
    const {files,tree}=await this.files(base,Object.keys(drafts));const changes=[];
    for(const [path,edit] of Object.entries(drafts)){
      if(!Object.hasOwn(files,path))throw Error('Unknown project');
      const after=applyEdit(path,files[path],edit);
      if(after!==files[path])changes.push({path,before:files[path],after});
    }
    if(!changes.length)throw Error('No changes to review');
    return {base,tree,changes};
  }
  async commit(review){
    if(await this.head()!==review.base)throw Error('GitHub changed after comparison. Compare again.');
    const tree=await this.call(repo+'/git/trees','POST',{base_tree:review.tree,tree:review.changes.map(c=>({path:c.path,mode:'100644',type:'blob',content:c.after}))});
    const commit=await this.call(repo+'/git/commits','POST',{message:'Update project progress via Lifegress',tree:tree.sha,parents:[review.base]});
    review.commit=commit.sha;
    await this.call(repo+'/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});
    review.refUpdated=true;
    return this.verify(review);
  }
  async verify(review){
    const head=await this.head();
    if(head!==review.commit)throw Error('Publication not confirmed at current head. Drafts retained; inspect GitHub before retrying.');
    const {files}=await this.files(review.commit,review.changes.map(c=>c.path));
    if(review.changes.some(c=>files[c.path]!==c.after))throw Error('Read-back verification failed. Drafts retained.');
    return {base:head,verified:true};
  }
}
