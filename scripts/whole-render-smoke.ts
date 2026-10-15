import {createServer} from 'node:http';import {mkdtemp,mkdir,rm,copyFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DataStore} from '../plugins/cocode-data-store/index.js';import {Director} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';import {fixtureBoard} from '../tests/fixtures.js';
const board=structuredClone(fixtureBoard);
// Deterministic fixture only: exercises supplied SDK dependencies and the real renderer.
const html=`<!doctype html><html><head><script src="gsap.min.js"></script><script src="runtime/MotionPathPlugin.min.js"></script><style>@font-face{font-family:"Microsoft YaHei";src:local("Microsoft YaHei"),local("Noto Sans CJK SC")}html,body{margin:0;width:1280px;height:720px;background:#101b12;color:#f2f8ed}#main{position:relative;width:1280px;height:720px;overflow:hidden}.headline{position:absolute;left:110px;top:140px;font:64px Arial,"Microsoft YaHei",sans-serif}#two{opacity:0}#dot{position:absolute;width:48px;height:48px;border-radius:50%;background:#b8ef88;left:0;top:0}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="15" data-width="1280" data-height="720"><div class="headline" id="one">${board.scenes[0].headline}</div><div class="headline" id="two">${board.scenes[1].headline}</div><div id="dot"></div></div><script>gsap.registerPlugin(MotionPathPlugin);const tl=gsap.timeline({paused:true});tl.to('#dot',{motionPath:{path:[{x:100,y:400},{x:500,y:520},{x:1150,y:420}]},duration:15,ease:'none'},0);tl.set('#one',{opacity:0},7.5);tl.set('#two',{opacity:1},7.5);window.__timelines['main']=tl;</script></body></html>`;
let calls=0;const provider=createServer(async(req,res)=>{for await(const _ of req){}calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({storyboard:board,html})}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>provider.once('listening',resolve));
const root=await mkdtemp(join(tmpdir(),'vf-full-render-')),config=readConfig();
const store=new DataStore({...config,dataRoot:join(root,'data'),logsRoot:join(root,'logs'),apiKey:'local-fixture',baseUrl:`http://127.0.0.1:${(provider.address() as {port:number}).port}`,mailApiUrl:''});await store.init();
const director=new Director(store);
try{
  const user=await store.register('full-render@example.com','render-fixture-password','验证','kuma','127.0.0.1'),project=await store.createProject(user.id,'全片渲染验证');
  const job=await store.enqueue(user.id,project.id,{prompt:'验证全片渲染与本地插件',duration:15,aspect:'16:9',style:'minimal'});
  const scope={userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:{promptTokens:0,completionTokens:0,totalTokens:0,calls:0}};
  await director.generateWholeFilm(scope);const result=await director.assembleVideo(scope);
  const dir=join(process.cwd(),'.test-artifacts');await mkdir(dir,{recursive:true});
  await copyFile(await store.artifact(user.id,project.id,result.video),join(dir,'whole-render-smoke.mp4'));
  const finished=await store.loadProject(user.id,project.id);
  await writeFile(join(dir,'whole-render-result.json'),JSON.stringify({calls,result,render:finished.renders.at(-1)},null,2));
  console.log('全片单时间线、本地 MotionPathPlugin、运行时与回退跳转检查、真实导出通过；模型协议调用次数：'+calls);
}finally{await director.dispose();await new Promise<void>(resolve=>provider.close(()=>resolve()));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:300});}
