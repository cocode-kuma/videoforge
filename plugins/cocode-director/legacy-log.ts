import {readFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {DataStore} from '../cocode-data-store/index.js';
import type {Message} from '../../shared/contracts.js';
import {activityTitle,publicToolData} from '../../shared/agent-activity.js';

/** Recover recorded facts only: older versions did not persist every call name. */
export async function recoverLegacyLogs(store:DataStore,userId:string,projectId:string){
  const project=await store.loadProject(userId,projectId),base=await store.projectDir(userId,projectId);
  const c=store.config,secrets=[c.apiKey,c.visionApiKey,c.mediaApiKey,c.ttsApiKey,c.elevenLabsApiKey,c.miniMaxApiKey,c.searchApiKey];
  for(const job of project.renders.filter(r=>r.generationMode==='harness'&&r.status==='failed'&&!r.publicLogRecovered)){
    const folder=join(base,'renders',job.id,'workspace/.harness');
    const native=await readFile(join(folder,'native-session.json'),'utf8').catch(()=>null);
    const files=native?[]:await readdir(folder).catch(()=>[]);
    const checkpoint=native?null:await readFile(join(folder,'checkpoint.json'),'utf8').then(JSON.parse).catch(()=>null);
    const known=new Map<string,{name:string;args:unknown}>();
    for(const message of checkpoint?.messages??[])for(const call of message.tool_calls??[]){
      let args:unknown;try{args=JSON.parse(call.function.arguments);}catch{args=call.function.arguments;}
      known.set('tool-'+String(call.id).replace(/[^a-zA-Z0-9_-]/g,'_')+'.json',{name:call.function.name,args});
    }
    const recovered:Message[]=[];
    for(const file of files.filter(f=>/^tool-[a-zA-Z0-9_-]+\.json$/.test(f))){
      const path=join(folder,file),result=await readFile(path,'utf8').then(JSON.parse).catch(()=>null);if(result===null)continue;
      const call=known.get(file),time=(await stat(path).catch(()=>null))?.mtime.toISOString()??job.createdAt;
      recovered.push({id:'legacy-'+job.id+'-'+file,role:'assistant',kind:'tool',revision:1,createdAt:time,jobId:job.id,
        text:call?activityTitle(call.name,call.args):'历史工具结果（旧版未保存调用名称和参数）',
        tool:{name:call?.name??'archived_execution',status:result.error?'error':'done',args:call?publicToolData(call.args,secrets):undefined,result:publicToolData(result,secrets),startedAt:time,finishedAt:time}});
    }
    await store.updateProject(userId,projectId,p=>{
      const record=p.renders.find(r=>r.id===job.id);if(!record)return;record.publicLogRecovered=true;
      for(const message of recovered)if(!p.messages.some(m=>m.id===message.id))p.messages.push(message);
      p.messages.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    });
  }
}
