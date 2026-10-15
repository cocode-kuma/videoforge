import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';
const root=process.cwd(),out=join(root,'outputs');
const config=readConfig();
const store=new DataStore({...config,dataRoot:join(root,'.test-artifacts/sample-data'),logsRoot:join(root,'.test-artifacts/sample-logs'),mailApiUrl:'',mailApiKey:''});await store.init();
const ids=JSON.parse(await readFile(join(out,'sample-job.json'),'utf8'));
const project=await store.loadProject(ids.userId,ids.projectId),record=project.renders.find(r=>r.id===ids.jobId)!;
const scope={...ids,signal:new AbortController().signal,tokenUsage:record.tokenUsage??{promptTokens:0,completionTokens:0,totalTokens:0,calls:0}};
const director=new Director(store);
try {
  console.log('继续验收同一批真实 AI 镜头');
  const result=await director.assembleVideo(scope);
  await store.updateProject(ids.userId,ids.projectId,p=>Object.assign(p.renders.find(r=>r.id===ids.jobId)!,result,{status:'completed',progress:100,error:undefined,message:'视频已通过检查',tokenUsage:scope.tokenUsage}));
  await copyFile(await store.artifact(ids.userId,ids.projectId,result.video),join(out,'灵感成片-DeepSeek.mp4'));
  const final=await store.loadProject(ids.userId,ids.projectId);
  await writeFile(join(out,'sample-report.json'),JSON.stringify({render:final.renders.find(r=>r.id===ids.jobId),storyboard:final.storyboard},null,2));
  console.log('成片已保存，真实时长：'+result.duration+'s');
}finally{await director.dispose();}
