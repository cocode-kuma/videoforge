import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readConfig} from '../shared/config.js';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {CreativeHarness} from '../plugins/cocode-director/harness.js';
import type {Message,Brief} from '../shared/contracts.js';

const base=readConfig(),output=resolve('.test-artifacts/model-comparison');await mkdir(output,{recursive:true});
const brief:Brief={prompt:'制作一条15秒的原创设计展预告，展名“灵感发生”，副标题“DESIGN IN MOTION”，时间“2026.11.01 — 11.15”，地点“城市艺术中心”。大胆中文字体、黑白基底、电光蓝与少量亮橙。用抽象几何与字体形变表现创意爆发，要有连续运动、层次、克制的高级感和明确收尾，不能像PPT切页。所有文字完整可读，别堆模板卡片。使用本地HTML/CSS/JS、SVG、Canvas或GSAP，无外部素材、无配音、无音乐，不调用付费素材生成服务。先检查静帧和短段动作，正式成片评审通过即交付，不自行反复打磨。',duration:15,aspect:'16:9',style:'vibrant',engine:'browser',exportResolution:'1080p',taskMode:'video',narrationEnabled:false,music:'none'};
const results:any[]=[];const resume=process.argv.includes('--resume');const prior:any[]=resume?JSON.parse(await readFile(join(output,'report.json'),'utf8')):[];if(resume)await writeFile(join(output,'attempt-report-'+Date.now()+'.json'),JSON.stringify(prior,null,2));
for(const variant of ['qwen','deepseek'] as const){
  const config={...base,dataRoot:join(output,variant,'data'),logsRoot:join(output,variant,'logs'),
    ...(variant==='qwen'?{model:'qwen3.8-flash',baseUrl:process.env.QWEN_BASE_URL!,apiKey:process.env.QWEN_API_KEY!,visionModel:'qwen3.8-flash',visionBaseUrl:process.env.QWEN_BASE_URL!,visionApiKey:process.env.QWEN_API_KEY!}:{})};
  const store=new DataStore(config);await store.init();
  const previous=prior.find(r=>r.variant===variant);
  let user:any,project:any,job:any,root:string;
  if(previous){const ids=relative(config.dataRoot,previous.workspace).split(sep);user={id:ids[0]};project=await store.loadProject(user.id,ids[1]);job=project.renders.find((r:{id:string})=>r.id===ids[3])!;root=previous.workspace;}
  else{user=await store.register(variant+'@comparison.local','local-comparison-only',variant,'kuma','192.0.2.'+(variant==='qwen'?121:122));project=await store.createProject(user.id,'模型对比 · '+config.model);job=await store.enqueue(user.id,project.id,brief);root=join(await store.projectDir(user.id,project.id),'renders',job.id,'workspace');}
  const usage={calls:0,promptTokens:0,completionTokens:0,totalTokens:0},messages=new Map<string,Message>();
  let lastLog=0;const started=Date.now();
  console.log(JSON.stringify({variant,model:config.model,stage:'开始制作',root}));
  try{
    await store.updateProject(user.id,project.id,p=>{p.renders[0].generationMode='harness';p.renders[0].status='storyboarding';});
    const harness=new CreativeHarness(store,{userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:usage},root,{
      input:async()=>[],
      emit:event=>{if(event.type==='message'&&event.data&&typeof event.data==='object'){const m=event.data as Message;if(m.id)messages.set(m.id,m);}if(event.type==='message'&&!(event.data as Message)?.kind&&!(event.data as Message)?.streaming&&(event.data as Message)?.text)console.log(JSON.stringify({variant,stage:'说明',text:(event.data as Message).text.slice(0,400)}));},
      progress:async patch=>{await store.updateProject(user.id,project.id,p=>Object.assign(p.renders[0],patch));if(Date.now()-lastLog>15000){lastLog=Date.now();console.log(JSON.stringify({variant,stage:patch.message??'继续制作',elapsedSeconds:Math.round((Date.now()-started)/1000)}));}}
    });
    const result=await harness.run();
    if(!('video' in result))throw Error('Model ended without a video');
    await store.commitQuota(user.id,project.id,job.id);
    await store.updateProject(user.id,project.id,p=>{Object.assign(p.renders[0],result,{status:'completed',progress:100,completedAt:new Date().toISOString(),tokenUsage:usage});for(const m of messages.values())if(!p.messages.some(n=>n.id===m.id))p.messages.push(m);});
    const record={variant,model:config.model,seconds:(Date.now()-started)/1000,initialAttemptSeconds:previous?.seconds,usage,initialAttemptUsage:previous?.usage,video:join(await store.projectDir(user.id,project.id),result.video),workspace:root,brief};results.push(record);
    console.log(JSON.stringify({variant,stage:'交付',video:record.video,seconds:record.seconds,usage}));
  }catch(e){
    await store.releaseQuota(user.id,project.id,job.id);
    await store.updateProject(user.id,project.id,p=>Object.assign(p.renders[0],{status:'failed',error:(e as Error).message}));
    results.push({variant,model:config.model,error:(e as Error).message,seconds:(Date.now()-started)/1000,usage,workspace:root});
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(join(output,'report.json'),JSON.stringify(results,null,2));
}
