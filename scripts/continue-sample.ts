import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';
// Continue the same authorized isolated sample after a terminal diagnostic; never creates a new sample/account/job.
const folder=process.argv[2];if(!folder||!/^outputs[\\/]whole-film-\d+$/.test(folder))throw new Error('指定已有样例目录');
const config=readConfig(),root=process.cwd(),out=join(root,folder);
const store=new DataStore({...config,dataRoot:join(root,'.test-artifacts/sample-data'),logsRoot:join(root,'.test-artifacts/sample-logs'),mailApiUrl:'',mailApiKey:'',officialQuotaApiUrl:'',officialQuotaApiKey:''});
await store.init();const ids=JSON.parse(await readFile(join(out,'sample-job.json'),'utf8'));
const project=await store.loadProject(ids.userId,ids.projectId),record=project.renders.find(r=>r.id===ids.jobId)!;
if(record.status!=='failed')throw new Error('只能继续已记录失败原因的样例');
await writeFile(join(out,'previous-failure.json'),JSON.stringify(record,null,2));
const director=new Director(store),scope={...ids,signal:new AbortController().signal,tokenUsage:record.tokenUsage??{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}};
await store.updateProject(ids.userId,ids.projectId,p=>Object.assign(p.renders.find(r=>r.id===ids.jobId)!,{status:'storyboarding',error:undefined,message:'继续同一个样例的五阶段创作'}));
const dir=join(await store.projectDir(ids.userId,ids.projectId),'renders',ids.jobId);
try {
  const board=await director.generateWholeFilm(scope,process.argv.includes('--resume-plans'));
  console.log('五阶段创作完成，开始检查与自动修复');
  const result=await director.assembleVideo(scope);
  await store.updateProject(ids.userId,ids.projectId,p=>Object.assign(p.renders.find(r=>r.id===ids.jobId)!,result,{status:'completed',progress:100,message:'真实样例通过检查',tokenUsage:scope.tokenUsage,completedAt:new Date().toISOString()}));
  await copyFile(join(dir,'final.mp4'),join(out,'灵感成片-五阶段.mp4'));
  const finished=await store.loadProject(ids.userId,ids.projectId);
  await writeFile(join(out,'sample-report.json'),JSON.stringify({passed:true,continued:true,render:finished.renders.find(r=>r.id===ids.jobId),storyboard:board,taskDirectory:dir},null,2));
  console.log('同一个真实样例已完成：'+join(out,'灵感成片-五阶段.mp4'));
} catch(error) {
  await store.updateProject(ids.userId,ids.projectId,p=>Object.assign(p.renders.find(r=>r.id===ids.jobId)!,{status:'failed',error:String(error),tokenUsage:scope.tokenUsage}));
  const failed=await store.loadProject(ids.userId,ids.projectId);
  await writeFile(join(out,'sample-report.json'),JSON.stringify({passed:false,continued:true,render:failed.renders.find(r=>r.id===ids.jobId),storyboard:failed.storyboard,taskDirectory:dir},null,2));
  console.error((error as {diagnostic?:string}).diagnostic??String(error));process.exitCode=1;
} finally {await director.dispose();}
