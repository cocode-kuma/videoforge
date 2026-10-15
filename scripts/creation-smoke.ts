import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm,copyFile,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';
import {creationHtml,creationResponse,stageName} from '../tests/creation-fixtures.js';

// Real queue, one real automatic code repair, browser checks, frame capture, FFmpeg and final MP4.
// The provider is local and deterministic: this test never consumes an external account's credits.
const root=process.cwd(),isolated=await mkdtemp(join(tmpdir(),'vf-five-stage-'));
let requests=0;
const server=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  const request=JSON.parse(raw),stage=stageName(request.messages[0].content);requests++;
  const html=stage==='code'?creationHtml.replace("tl.to('#ball',{x:800","tl.to('#ball',{left:800"):creationHtml;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(creationResponse(stage,html))}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));
}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const config={...readConfig(root),creationMode:'pipeline' as const,dataRoot:join(isolated,'data'),logsRoot:join(isolated,'logs'),apiKey:'smoke-local',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,
  visionBaseUrl:'',visionApiKey:'',visionModel:'',mediaApiUrl:'',mediaApiKey:'',mailApiUrl:'',mailApiKey:'',officialQuotaApiUrl:'',officialQuotaApiKey:'',maxRepairs:2};
const store=new DataStore(config);await store.init();const director=new Director(store);
try {
  const user=await store.register('five-stage-smoke@example.com','five-stage-smoke-123','生成链路测试','kuma','192.0.2.203');
  const project=await store.createProject(user.id,'五阶段自动修复实测');
  const job=await director.submit(user.id,project.id,{prompt:'生成清晰的两个阶段，绿色主体持续前进，主文案分别为让灵感发生和想象成为作品',duration:15,style:'minimal'});
  const deadline=Date.now()+300000;let record;
  while(Date.now()<deadline) {
    record=(await store.loadProject(user.id,project.id)).renders.find(r=>r.id===job.id)!;
    if(record.status==='completed'||record.status==='failed')break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const log=await readFile(join(config.logsRoot,new Date().toISOString().slice(0,10)+'.jsonl'),'utf8').catch(()=>'');
  assert.equal(record?.status,'completed',`${record?.error}\n${log}`);
  assert.equal(record?.repairCount,1);assert.equal(record?.qualityReport?.passed,true);
  assert.ok(requests>=7);
  const dir=join(await store.projectDir(user.id,project.id),'renders',job.id);
  const output=join(root,'.test-artifacts/creation-smoke');await mkdir(output,{recursive:true});
  for(const file of ['final.mp4','generation.json','check-report.json','seek-report.json','repair-1-diagnostic.txt','repair-1-before.txt','repair-1-after.txt'])await copyFile(join(dir,file),join(output,file));
  await writeFile(join(output,'result.json'),JSON.stringify(record,null,2));
  console.log(JSON.stringify({passed:true,requests,repairs:record?.repairCount,video:join(output,'final.mp4')}));
} finally {await director.dispose();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(isolated,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
