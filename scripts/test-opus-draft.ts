import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {readConfig} from '../shared/config.js';
import {CreativeRuntime,cleanExecutionEnv} from '../plugins/cocode-director/creative-runtime.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {runProcess} from '../plugins/cocode-director/process.js';
const root=resolve('.test-artifacts/opus-comparison'),config=readConfig(),workspace=new CreativeWorkspace(root);
await mkdir(root,{recursive:true});
const prompt='制作一条15秒的原创设计展预告，展名“灵感发生”，副标题“DESIGN IN MOTION”，时间“2026.11.01 — 11.15”，地点“城市艺术中心”。大胆中文字体、黑白基底、电光蓝与少量亮橙。用抽象几何与字体形变表现创意爆发，要有连续运动、层次、克制的高级感和明确收尾，不能像PPT切页。所有文字完整可读，别堆模板卡片。使用本地HTML/CSS/JS、SVG、Canvas或GSAP，无外部素材、无配音、无音乐，不调用付费素材生成服务。先检查静帧和短段动作，正式成片评审通过即交付，不自行反复打磨。';
const model=process.env.OPUS_TEST_MODEL!,baseUrl=process.env.OPUS_TEST_BASE_URL!,key=process.env.OPUS_TEST_API_KEY!;
const budget=3,records:any[]=[];let spent=0;
async function request(messages:any[],max_tokens:number,label:string){
  // UTF-8 bytes are a conservative upper bound for text token count. Image data
  // is deliberately overestimated here to reserve budget before a request.
  const reserve=Buffer.byteLength(JSON.stringify(messages),'utf8')/1e6*4+max_tokens/1e6*20;
  if(spent+reserve>budget)throw Error('预算保护：剩余额度不足以安全开始 '+label);
  const response=await fetch(baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,messages,max_tokens,stream:false}),signal:AbortSignal.timeout(300000)});
  if(!response.ok){await response.body?.cancel();throw Error('模型请求返回 HTTP '+response.status+'；停止重试以保护预算');}
  const data:any=await response.json(),u=data.usage;
  if(!u||!Number.isFinite(u.prompt_tokens)||!Number.isFinite(u.completion_tokens))throw Error('服务未提供可核对用量，停止后续收费请求');
  const cache=u.prompt_tokens_details?.cached_tokens??u.cache_read_input_tokens??0;
  const cost=(Math.max(0,u.prompt_tokens-cache)*4+cache*.2+u.completion_tokens*20)/1e6;spent+=cost;
  records.push({label,usage:u,estimatedUsd:cost});
  await writeFile(join(root,'cost-report.json'),JSON.stringify({model,budgetUsd:budget,estimatedTotalUsd:spent,pricing:{input:4,output:20,cacheRead:.2},records,note:'按用户提供单价估算；未读取到实际账户扣款。'},null,2));
  console.log(JSON.stringify({stage:label,usage:u,estimatedUsd:cost,totalEstimatedUsd:spent}));
  if(data.choices?.[0]?.finish_reason==='length')throw Error('输出被截断，停止自动重试以保护预算');
  return data.choices?.[0]?.message?.content as string;
}
function json(raw:string){return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
const system=`你是视频创意导演和动效开发者。制作用户指定的原创视频，输出必须为JSON对象 {"html":"完整HTML文档","description":"中文设计说明"}。不要Markdown。真实画布1920×1080，15秒，30fps。所有动画从时间完整重建，提供 window.render(t)，随机固定种子，不使用真实时钟/RAF/定时器/CSS动画。可以使用本地 runtime/gsap.min.js，完成后暂停时间线。不得引用外链、下载素材、生成配音或音乐。中文字体必须存在且可读；不要留下空框或丢失需求文字。`;
const messages=[{role:'system',content:system},{role:'user',content:prompt}];
const raw=await request(messages,12000,'首次生成');
await writeFile(join(root,'generation.json'),raw);
let result=json(raw);if(typeof result.html!=='string')throw Error('未返回完整HTML');
await workspace.write('index.html',result.html);
const spec={engine:'browser' as const,entry:'index.html',duration:15,width:1920,height:1080,fps:30};
await workspace.write('project.json',JSON.stringify(spec,null,2));
const runtime=new CreativeRuntime(config,workspace,new AbortController().signal,async text=>console.log(text));await runtime.prepareLibraries();
try{await runtime.render(spec,'previews/check.png',{at:6.5});}
catch(error){
  const fixed=await request([...messages,{role:'assistant',content:raw},{role:'user',content:'实际渲染失败，请仅修正以下技术错误，保持原设计和所有需求，返回完整JSON：'+(error as Error).message}],12000,'技术错误修复');
  result=json(fixed);await workspace.write('index.html',result.html);await runtime.render(spec,'previews/check.png',{at:6.5});
}
const picks=[];for(const [i,at] of [1.5,6.5,12.5].entries()){const path='previews/frame-'+i+'.png';await runtime.render(spec,path,{at});const jpg=await sharp(await workspace.path(path)).resize(640,360).jpeg({quality:80}).toBuffer();picks.push({at,url:'data:image/jpeg;base64,'+jpg.toString('base64')});}
// Images stay local; this draft test sends no repository documents or images.
await runtime.render(spec,'exports/opus-draft.mp4',{benchmark:{capture:'cdp',workers:6,stream:false}});
await copyFile(join(root,'exports/opus-draft.mp4'),join(root,'opus-draft.mp4'));
const probe=JSON.parse(await runProcess(config.ffprobe,['-v','error','-count_frames','-show_entries','format=duration:stream=width,height,nb_read_frames','-of','json',join(root,'opus-draft.mp4')],root,new AbortController().signal,60000,undefined,cleanExecutionEnv()));
if(Number(probe.streams[0].nb_read_frames)!==450)throw Error('成片帧数不完整');
await writeFile(join(root,'draft-report.json'),JSON.stringify({model,prompt,probe,estimatedUsd:spent,description:result.description,method:'同需求和渲染器；一次受预算限制的代码生成与静帧自评，不是之前的完整多轮Agent流程。'},null,2));
console.log(JSON.stringify({video:join(root,'opus-draft.mp4'),estimatedUsd:spent,probe}));
