import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';
import {fixtureBoard} from '../tests/fixtures.js';
import {createApp} from '../plugins/cocode-studio-ui/index.js';
import {chromium} from 'playwright';
import {polishKnowledge} from '../plugins/cocode-director/prompt-polish.js';

const root=process.cwd(),out=resolve('.test-artifacts/harness-smoke');await mkdir(out,{recursive:true});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#254738"/><path d="M35 50h75v55q0 28-37 28t-38-28z" fill="#e3b981"/><path d="M110 59h10q20 0 20 18t-30 18" fill="none" stroke="#e3b981" stroke-width="9"/></svg>';
const html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:320px;height:180px;overflow:hidden;background:#193229;color:#f4e6cb;font:24px sans-serif}img{position:absolute;left:16px;top:44px;width:100px}h1{position:absolute;left:130px;top:45px;font-size:24px}canvas{position:absolute;left:130px;top:112px}</style></head><body><img src="assets/cup.png"><h1>COFFEE<br>灵感成片</h1><canvas width="160" height="50"></canvas><script src="runtime/gsap.min.js"></script><script>const ctx=document.querySelector('canvas').getContext('2d');const tl=gsap.timeline({paused:true}).to('img',{y:-6,duration:1}).to('img',{y:0,duration:1});window.render=t=>{tl.seek(t,false);ctx.clearRect(0,0,160,50);ctx.fillStyle='#f4c788';ctx.fillRect(0,14,30+t*50,8);};render(0);</script></body></html>`;
const board={...fixtureBoard,title:'咖啡创作测试',scenes:[{...fixtureBoard.scenes[0],duration:2,narration:'',headline:'COFFEE',caption:'灵感成片'}]};
const score={bpm:120,notes:[{beat:0,length:1,midi:60,gain:.12,voice:'bell'},{beat:2,length:1,midi:67,gain:.1,voice:'pad'}]};
const skillReads:[string,unknown][]=[];
const knowledge=polishKnowledge(readConfig(root));
for(const path of await knowledge.requiredSkills()){
  let offset=0;for(;;){skillReads.push(['read_skill',{path,offset,length:32000}]);const page=await knowledge.read(path,offset,32000);if(page.nextOffset===null)break;offset=page.nextOffset;}
}
const steps:[string,unknown][]=[
  ['inspect_environment',{}],['set_plan',{steps:[{title:'制作杯子和背景素材',status:'active'},{title:'编排并检查动作',status:'pending'},{title:'配乐并交付',status:'pending'}]}],
  ...skillReads,['write_file',{path:'assets/cup.svg',content:svg}],['process_image',{input:'assets/cup.svg',output:'assets/cup.png'}],
  ['write_file',{path:'index.html',content:html.replace('render(0);','window.render=()=>{throw Error("broken-motion-fixture")};')}],['set_project',{engine:'browser',entry:'index.html',duration:2,width:320,height:180,fps:12}],
  ['render_still',{at:.5,output:'previews/broken.png'}],['edit_file',{path:'index.html',before:'window.render=()=>{throw Error("broken-motion-fixture")};',after:'render(0);'}],
  ['render_still',{at:.5,output:'previews/keyframe.png'}],['inspect_artifact',{path:'previews/keyframe.png'}],['checkpoint_version',{label:'原始杯子'}],
  ['edit_file',{path:'index.html',before:"ctx.fillStyle='#f4c788'",after:"ctx.fillStyle='#fda56c'"}],['render_preview',{duration:1,scale:.5,output:'previews/motion.mp4'}],
  ['synthesize_music',{score,duration:2,output:'audio/music.wav'}],['set_audio',{cues:[],music:'audio/music.wav'}],
  ['export_video',{}],['review_video',{path:'exports/final.mp4'}],['set_plan',{steps:[{title:'制作杯子和背景素材',status:'done'},{title:'编排并检查动作',status:'done'},{title:'配乐并交付',status:'done'}]}],
  ['submit_delivery',{storyboard:board,summary:'独立 SVG、图像处理、GSAP/Canvas 动画和实际音乐已合成；已响应修改要求。'}],
];
let calls=0,reviews=0,sawSteering=false,sawDiagnostic=false;
const provider=createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;const request=JSON.parse(body);
  if(request.response_format){reviews++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({passed:true,issues:[],summary:'需求与代码一致，当前测试仅做代码评审。'})},finish_reason:'stop'}],usage:{prompt_tokens:50,completion_tokens:20,total_tokens:70}}));return;}
  if(request.messages.some((m:any)=>typeof m.content==='string'&&m.content.includes('暖橙色')))sawSteering=true;
  if(request.messages.some((m:any)=>m.role==='tool'&&m.content.includes('broken-motion-fixture')))sawDiagnostic=true;
  const [name,args]=steps[Math.min(calls,steps.length-1)],index=calls++;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'我会继续当前工程，',reasoning_content:'private test reasoning'}}]})+'\n\n');
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'完成这一步并观察结果。',tool_calls:[{index:0,id:'call-'+index,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:50,completion_tokens:20,total_tokens:70}})+'\n\ndata: [DONE]\n\n');
}).listen(0,'127.0.0.1');await new Promise<void>(r=>provider.once('listening',r));
const config={...readConfig(root),dataRoot:join(out,'data'),logsRoot:join(out,'logs'),creationMode:'harness' as const,baseUrl:'http://127.0.0.1:'+(provider.address() as {port:number}).port,
  apiKey:'test-only',visionBaseUrl:'',visionApiKey:'',visionModel:'',mailApiUrl:'',officialQuotaApiUrl:''};
const store=new DataStore(config);await store.init();const director=new Director(store);
let web:ReturnType<ReturnType<typeof createApp>['listen']>|undefined;
try {
  const user=await store.register('harness-'+Date.now()+'@example.com','password-12345','Harness','kuma','192.0.2.92'),project=await store.createProject(user.id,'自由创作咖啡片');
  const observations:any[]=[];director.subscribe(user.id,project.id,e=>observations.push(e));
  const job=await director.submit(user.id,project.id,{prompt:'制作两秒咖啡片，用 SVG 杯子、Canvas 和 GSAP，实际生成配乐。',duration:2,aspect:'16:9',style:'minimal',music:'generated'});
  await director.steer(user.id,project.id,'保留杯子和标题，把进度线换成暖橙色。');
  let finished;
  for(let i=0;i<600;i++){finished=await store.loadProject(user.id,project.id);if(['completed','failed'].includes(finished.renders.at(-1)!.status))break;await new Promise(r=>setTimeout(r,200));}
  const record=finished!.renders.at(-1)!;
  await writeFile(join(out,'events.json'),JSON.stringify(observations,null,2));await writeFile(join(out,'result.json'),JSON.stringify({render:record,calls,reviews,sawSteering,sawDiagnostic},null,2));
  if(record.status!=='completed')throw new Error(record.error+'\n'+JSON.stringify(observations.filter(e=>e.type==='tool'&&e.data.status==='error')));
  const errors=observations.filter(e=>e.type==='tool'&&e.data.status==='error');if(errors.length!==1||errors[0].data.name!=='render_still'||!sawDiagnostic||!record.qualityReport?.repairs)throw new Error('Expected runtime error and repair were not observed: '+JSON.stringify(errors));
  if(!sawSteering||!observations.some(e=>e.type==='message'&&e.data.streaming)||!observations.some(e=>e.type==='artifact'))throw new Error('Missing steering, streaming or artifact events');
  await copyFile(await store.artifact(user.id,project.id,record.video!),join(out,'final.mp4'));
  // Verify the actual frontend can display the final messages and artifact cards through authenticated routes.
  web=createApp(store,director).listen(0,'127.0.0.1');await new Promise<void>(r=>web!.once('listening',r));
  const origin='http://127.0.0.1:'+(web.address() as {port:number}).port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.PRODUCER_HEADLESS_SHELL_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:960}});await context.addCookies([{name:'cocode_session',value:await store.newSession(user.id),url:origin}]);
    const page=await context.newPage();await page.goto(origin+'/studio');await page.getByText('自由创作咖啡片',{exact:true}).first().click();
    const image=page.locator('.creative-artifact img').first();await image.scrollIntoViewIfNeeded();await image.waitFor();await image.evaluate((i:any)=>i.complete&&i.naturalWidth?true:new Promise((yes,no)=>{i.onload=()=>yes(true);i.onerror=()=>no(new Error('图片加载失败'));}));await page.screenshot({path:join(out,'studio.png'),fullPage:true});
    const hidden=await page.request.get(origin+`/api/projects/${project.id}/jobs/${job.id}/artifact?path=.harness/checkpoint.json`);if(hidden.status()!==404)throw new Error('Private checkpoint exposed');
    const zip=await page.request.get(origin+`/api/projects/${project.id}/jobs/${job.id}/source`);if(zip.status()!==200)throw new Error('Source archive route failed');
    await writeFile(join(out,'source.zip'),await zip.body());
  } finally {await browser.close();}
  console.log('Harness 自主工具循环、流式对话、中途修改、实际音视频导出和前端作品卡片通过');
} finally {await director.dispose();await new Promise<void>(r=>provider.close(()=>r()));if(web)await new Promise<void>(r=>web!.close(()=>r()));}
