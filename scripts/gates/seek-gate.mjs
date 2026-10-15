import { spawn,spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const hfRequire=createRequire(require.resolve('hyperframes/package.json'));
const {default:puppeteer}=await import(pathToFileURL(hfRequire.resolve('puppeteer-core')).href);
const {default:sharp}=await import(pathToFileURL(hfRequire.resolve('sharp')).href);
const project=process.argv[2];
if(!project)throw new Error('需要项目目录');
const brief=JSON.parse(await readFile(join(project,'brief.json'),'utf8'));
const board=JSON.parse(await readFile(join(project,'storyboard.json'),'utf8'));
const [width,height]=brief.aspect==='9:16'?[720,1280]:brief.aspect==='1:1'?[960,960]:[1280,720];
const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const base=`http://127.0.0.1:${port}`;
const env={...process.env};delete env.HYPERFRAME_RUNTIME_URL;
const server=spawn(process.execPath,[join(require.resolve('hyperframes/package.json'),'../bin/hyperframes.mjs'),'preview','--foreground','--no-open','--port',String(port)],{cwd:project,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',chunk=>log=(log+chunk).slice(-4000));server.stderr.on('data',chunk=>log=(log+chunk).slice(-4000));
let browser;
try {
  const deadline=Date.now()+120000;let projects;
  while(Date.now()<deadline){
    if(server.exitCode!==null)throw new Error('预览服务提前退出：'+log);
    try{const response=await fetch(base+'/api/projects',{signal:AbortSignal.timeout(1000)});if(response.ok){projects=await response.json();break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  const id=projects?.projects?.[0]?.id;if(!id)throw new Error('预览未启动：'+log);
  const executable=process.env.PRODUCER_HEADLESS_SHELL_PATH||process.env.CHROME_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);
  if(!executable)throw new Error('没有浏览器');
  browser=await puppeteer.launch({executablePath:executable,headless:true,args:['--hide-scrollbars','--mute-audio','--no-first-run']});
  const page=await browser.newPage();await page.setViewport({width,height,deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',request=>{const url=request.url();if(url.startsWith(base+'/')||url.startsWith('data:')||url.startsWith('blob:'))request.continue();else {errors.push('渲染使用未冻结外部资源：'+url);request.abort();}});
  await page.goto(`${base}/api/projects/${id}/preview/comp/index.html`,{waitUntil:'networkidle0',timeout:90000});
  await page.waitForFunction(()=>window.__playerReady&&window.__renderReady&&window.__player,{timeout:45000});
  await page.evaluate(()=>document.fonts.ready);
  const times=[];let start=0;
  for(const scene of board.scenes){times.push({scene:scene.id,t:Math.round((start+scene.duration*0.23)*30)/30},{scene:scene.id,t:Math.round((start+scene.duration*0.71)*30)/30});start+=scene.duration;}
  const frames=new Map();await mkdir(join(project,'seek-snapshots'),{recursive:true});
  async function snapshot(time){
    await page.evaluate(t=>{window.__player.pause();window.__player.seek(t);void document.body.offsetHeight;},time);
    // Let the renderer paint after the explicit seek; this clock never drives the composition.
    await new Promise(resolve=>setTimeout(resolve,100));
    return Buffer.from(await page.screenshot({type:'png'}));
  }
  async function raw(frame){return sharp(frame).resize(320,180,{fit:'fill'}).removeAlpha().raw().toBuffer();}
  function difference(a,b){let total=0,changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);total+=d;if(d>8)changed++;}return {mean:total/a.length,changed:changed/a.length};}
  for(const sample of times){const frame=await snapshot(sample.t);const pixels=await raw(frame);frames.set(sample.t,pixels);await writeFile(join(project,'seek-snapshots',`${sample.scene}-${sample.t.toFixed(3)}.png`),frame);
    let sum=0,squares=0;for(let i=0;i<pixels.length;i+=3){const p=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];sum+=p;squares+=p*p;}const count=pixels.length/3,mean=sum/count,variance=squares/count-mean*mean;
    if(mean<2||variance<3)throw new Error(`镜头 ${sample.scene} 在 ${sample.t}s 是黑帧或空白画面`);
  }
  const results=[];
  // Non-monotonic seeks catch incremental canvas callbacks and state leaking between scenes.
  for(const sample of [...times].reverse()){const current=await raw(await snapshot(sample.t));const delta=difference(frames.get(sample.t),current);results.push({...sample,...delta});if(delta.mean>0.5||delta.changed>0.005)throw new Error(`镜头 ${sample.scene} 在 ${sample.t}s 回退跳转画面不一致：${JSON.stringify(delta)}`);}
  for(let i=0;i<times.length;i+=2){const delta=difference(frames.get(times[i].t),frames.get(times[i+1].t));if(delta.changed<0.0005)throw new Error(`镜头 ${times[i].scene} 没有可见推进，两个取样画面完全相同`);}
  const readability=await page.evaluate(async ({scenes,width,height})=>{
    const results=[];let start=0;
    const clean=text=>text.replace(/\s+/g,'').trim();
    for(const scene of scenes){
      const step=0.2;let consecutive=0,longest=0;
      for(let local=0.1;local<scene.duration;local+=step){
        window.__player.pause();window.__player.seek(start+local);void document.body.offsetHeight;
        await new Promise(resolve=>setTimeout(resolve,40));
        const nodes=[...document.querySelectorAll('h1,h2,h3,p,span,div')].filter(el=>clean(el.textContent??'')===clean(scene.headline));
        const readable=nodes.some(el=>{
          let opacity=1;for(let node=el;node&&node.nodeType===1;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return false;opacity*=Number(style.opacity);}
          const r=el.getBoundingClientRect();
          return opacity>=0.85&&r.width>0&&r.height>0&&r.left>=2&&r.top>=2&&r.right<=width-2&&r.bottom<=height-2&&parseFloat(getComputedStyle(el).fontSize)>=24;
        });
        consecutive=readable?consecutive+step:0;longest=Math.max(longest,consecutive);
      }
      results.push({scene:scene.id,headline:scene.headline,readableSeconds:longest,requiredSeconds:Math.min(1.5,scene.duration*0.45)});start+=scene.duration;
    }
    return results;
  },{scenes:board.scenes,width,height});
  for(const result of readability)if(result.readableSeconds+0.01<result.requiredSeconds)throw new Error(`镜头 ${result.scene} 主文案阅读时间不足：${JSON.stringify(result)}。主文案需提前出现，在稳定位置清晰保持至少 ${result.requiredSeconds}s。`);
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ok:true,samples:times.length,reverseSeeks:results,readability,checks:['nonblank','visible-progression','backward-seek','frozen-resources','headline-readability']},null,2));
} finally {
  await browser?.close();
  if(server.pid){if(process.platform==='win32')spawnSync('taskkill',['/pid',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else {try{process.kill(-server.pid,'SIGTERM');}catch{}}}
}
