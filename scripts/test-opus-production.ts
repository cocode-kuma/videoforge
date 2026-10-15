import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {readConfig} from '../shared/config.js';
import {CreativeRuntime,cleanExecutionEnv} from '../plugins/cocode-director/creative-runtime.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {runProcess} from '../plugins/cocode-director/process.js';
import {motionReview} from '../plugins/cocode-director/motion-review.js';
const root=resolve('.test-artifacts/opus-production'),config=readConfig(),workspace=new CreativeWorkspace(root);
await mkdir(root,{recursive:true});
const prompt='制作一条15秒的原创设计展预告，展名“灵感发生”，副标题“DESIGN IN MOTION”，时间“2026.11.01 — 11.15”，地点“城市艺术中心”。大胆中文字体、黑白基底、电光蓝与少量亮橙。用抽象几何与字体形变表现创意爆发，要有连续运动、层次、克制的高级感和明确收尾，不能像PPT切页。所有文字完整可读，别堆模板卡片。使用本地HTML/CSS/JS、SVG、Canvas或GSAP，无外部素材、无配音、无音乐，不调用付费素材生成服务。先检查静帧和短段动作，正式成片评审通过即交付，不自行反复打磨。';
const model=process.env.OPUS_TEST_MODEL!,baseUrl=process.env.OPUS_TEST_BASE_URL!,key=process.env.OPUS_TEST_API_KEY!;
const budget=10,records:any[]=[];let spent=0;
const resume=process.argv.includes('--resume');
if(resume){const previous=JSON.parse(await readFile(join(root,'cost-report.json'),'utf8'));records.push(...previous.records);spent=previous.estimatedTotalUsd;}
async function request(messages:any[],max_tokens:number,label:string){
  // UTF-8 bytes are a conservative upper bound for text token count. Image data
  // is deliberately overestimated here to reserve budget before a request.
  const reserve=Buffer.byteLength(JSON.stringify(messages),'utf8')/1e6*4+max_tokens/1e6*20;
  if(spent+reserve>budget)throw Error('预算保护：剩余额度不足以安全开始 '+label);
  const response=await fetch(baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,messages,max_tokens,stream:false}),signal:AbortSignal.timeout(300000)});
  if(!response.ok){await response.body?.cancel();throw Error('模型请求返回 HTTP '+response.status+'；停止重试以保护预算');}
  const data:any=await response.json(),u=data.usage;
  await writeFile(join(root,'response-'+records.length+'.txt'),String(data.choices?.[0]?.message?.content??''));
  if(!u||!Number.isFinite(u.prompt_tokens)||!Number.isFinite(u.completion_tokens))throw Error('服务未提供可核对用量，停止后续收费请求');
  const cache=u.prompt_tokens_details?.cached_tokens??u.cache_read_input_tokens??0;
  const creation=u.cache_creation_input_tokens??u.prompt_tokens_details?.cached_creation_tokens??0;
  const cost=(Math.max(0,u.prompt_tokens-cache)*4+cache*.2+u.completion_tokens*20+creation*5)/1e6;spent+=cost;
  records.push({label,usage:u,estimatedUsd:cost});
  await writeFile(join(root,'cost-report.json'),JSON.stringify({model,budgetUsd:budget,estimatedTotalUsd:spent,pricing:{input:4,output:20,cacheRead:.2},records,note:'按用户提供单价估算；未读取到实际账户扣款。'},null,2));
  console.log(JSON.stringify({stage:label,usage:u,estimatedUsd:cost,totalEstimatedUsd:spent}));
  if(data.choices?.[0]?.finish_reason==='length')throw Error('输出被截断，停止自动重试以保护预算');
  return data.choices?.[0]?.message?.content as string;
}
function json(raw:string){const fenced=raw.match(/```json\s*([\s\S]*?)```/);return JSON.parse((fenced?.[1]??raw).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
const system=`你是视频创意导演和动效开发者。制作用户指定的原创视频，输出必须为JSON对象 {"html":"完整HTML文档","description":"中文设计说明"}。不要Markdown。真实画布1920×1080，15秒，30fps。所有动画从时间完整重建，提供 window.render(t)，随机固定种子，不使用真实时钟/RAF/定时器/CSS动画。可以使用本地 runtime/gsap.min.js，完成后暂停时间线。不得引用外链、下载素材、生成配音或音乐。中文字体必须存在且可读；不要留下空框或丢失需求文字。`;
const plan=resume?await readFile(join(root,'storyboard.txt'),'utf8'):await request([{role:'system',content:'你是原创动效视频导演。用中文设计15秒完整制作方案：逐段时间、文字层次、构图、连续运动、收尾。用专业排版和运动设计，拒绝PPT和无意义装饰；只返回方案，不写代码。'},{role:'user',content:prompt}],3000,'分镜与创意方案');
await writeFile(join(root,'storyboard.txt'),plan);
const messages:any[]=[{role:'system',content:system+' 不得添加播放器、播放进度条、时间码、操作按钮等工具界面；视频只包含作品内容。'},{role:'user',content:prompt+'\n制作方案：\n'+plan}];
const raw=resume?await readFile(join(root,'generation.json'),'utf8'):await request(messages,12000,'首次生成');
await writeFile(join(root,'generation.json'),raw);
let result=json(raw);if(typeof result.html!=='string')throw Error('未返回完整HTML');
if(!process.argv.includes('--finish')&&!process.argv.includes('--review-only'))await workspace.write('index.html',result.html);
const spec={engine:'browser' as const,entry:'index.html',duration:15,width:1920,height:1080,fps:30};
await workspace.write('project.json',JSON.stringify(spec,null,2));
const runtime=new CreativeRuntime(config,workspace,new AbortController().signal,async text=>console.log(text));await runtime.prepareLibraries();
if(process.argv.includes('--finish')){
  const issues=JSON.parse(await readFile(join(root,'成片视觉评审.json'),'utf8')).result;
  const html=await readFile(join(root,'index.html'),'utf8');
  const overview=await readFile(join(root,'previews/overview.png')).catch(()=>null);
  const instructions=prompt+'\n修复已有作品的明确缺陷：'+JSON.stringify(issues.blocking)+'\n旧评审只抽了开头、中点、结尾，可能遗漏已有动画，不能盲信。附图如有，是0.5、2、3.5、5、8、11、13.5、14.9秒的真实作品概览，从左到右从上到下。请据实际画面判断。需要明显可见、连续且精致的几何运动；现在几何过暗，不能只是底纹。日期、地点、副标题至少完整同时显示3秒；开场0.5秒内有明确可见内容。最后保留完整信息落版。保持现有确定性window.render(t)，禁止RAF与自动播放。resetAll必须重置包括marginRight在内所有动画属性，避免乱序跳转不同像素。返回完整JSON，不能操作目录或输出思考。\n现有代码：\n'+html;
  const fixed=await request([{role:'system',content:system},{role:'user',content:overview?[{type:'text',text:instructions},{type:'image_url',image_url:{url:'data:image/png;base64,'+overview.toString('base64')}}]:instructions}],14000,'成片缺陷修复');
  result=json(fixed);await workspace.write('index.html',result.html);
}
try{await runtime.render(spec,'previews/check.png',{at:6.5});}
catch(error){
  const fixed=await request([...messages,{role:'assistant',content:raw},{role:'user',content:'实际渲染失败，请仅修正以下技术错误，保持原设计和所有需求，返回完整JSON：'+(error as Error).message}],12000,'技术错误修复');
  result=json(fixed);await workspace.write('index.html',result.html);await runtime.render(spec,'previews/check.png',{at:6.5});
}
async function review(video:string,label:string){
  const motion=await motionReview(config,workspace,video,spec,new AbortController().signal);
  const content:any[]=[{type:'text',text:'检查这条新生成的原创视频，结合下面的连续抽帧和帧差线索判断真实动态。时间标签及黑色格间隔是检查辅助，不属于视频。检查中文字是否完整、构图、对比度、连续运动、尾段是否清晰；有意停留合理，禁止机械阈值或为提高帧差而抖动。只将明确缺陷列为blocking，审美偏好放suggestions。返回JSON {passed:boolean,blocking:string[],suggestions:string[],summary:string}。\n需求：'+prompt+'\n帧差：'+JSON.stringify(motion.clues)}];
  for(const pick of motion.picks){const jpg=await sharp(await workspace.path(pick.file)).jpeg({quality:85}).toBuffer();content.push({type:'text',text:pick.label},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+jpg.toString('base64')}});}
  for(const at of [1.5,3,5,9,12,13.5]){const path='previews/review-'+at+'.png';await runtime.render(spec,path,{at});const jpg=await sharp(await workspace.path(path)).resize(640,360).jpeg({quality:85}).toBuffer();content.push({type:'text',text:at+'秒概览，用于补充连续窗口未覆盖的动作；不要声称未采样区间没有动画。'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+jpg.toString('base64')}});}
  const result=json(await request([{role:'user',content}],2500,label));await writeFile(join(root,label+'.json'),JSON.stringify({result,clues:motion.clues},null,2));return result;
}
if(!process.argv.includes('--finish')&&!process.argv.includes('--review-only')){
await runtime.render(spec,'previews/first-pass.mp4',{scale:.5,benchmark:{capture:'cdp',workers:6,stream:false}});
const initialReview=await review('previews/first-pass.mp4','预览视觉评审');
if(!initialReview.passed&&initialReview.blocking?.length){
  const fixed=await request([...messages,{role:'assistant',content:JSON.stringify(result)},{role:'user',content:'视觉检查发现明确问题，请修复这些问题，保持设计和所有需求，返回完整JSON。'+JSON.stringify(initialReview.blocking)}],14000,'修复明确视觉问题');
  result=json(fixed);await workspace.write('index.html',result.html);
}
}
if(!process.argv.includes('--review-only'))await runtime.render(spec,'exports/opus-draft.mp4',{benchmark:{capture:'cdp',workers:6,stream:false}});
await copyFile(join(root,'exports/opus-draft.mp4'),join(root,'opus-draft.mp4'));
const finalReview=await review('exports/opus-draft.mp4','成片视觉评审');
if(!finalReview.passed&&finalReview.blocking?.length)throw Error('成片评审发现明确缺陷，保留成片供检查，停止重复收费导出：'+JSON.stringify(finalReview.blocking));
const probe=JSON.parse(await runProcess(config.ffprobe,['-v','error','-count_frames','-show_entries','format=duration:stream=width,height,nb_read_frames','-of','json',join(root,'opus-draft.mp4')],root,new AbortController().signal,60000,undefined,cleanExecutionEnv()));
if(Number(probe.streams[0].nb_read_frames)!==450)throw Error('成片帧数不完整');
await writeFile(join(root,'draft-report.json'),JSON.stringify({model,prompt,probe,estimatedUsd:spent,description:result.description,finalReview,method:'分镜方案、代码生成、整段低分辨率检查预览、连续抽帧视觉评审、明确缺陷修复、1080p正式导出和最终评审；通过后立即交付。'},null,2));
console.log(JSON.stringify({video:join(root,'opus-draft.mp4'),estimatedUsd:spent,probe}));
