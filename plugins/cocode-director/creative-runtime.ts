import {mkdir,writeFile,readFile,rm,copyFile,readdir} from 'node:fs/promises';
import {join,dirname,extname,resolve,relative,delimiter} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';
import type {Config} from '../../shared/config.js';
import {AppError} from '../../shared/contracts.js';
import {CreativeWorkspace} from './workspace.js';
import {runProcess} from './process.js';
import {createHash} from 'node:crypto';
import {sep} from 'node:path';
import {withRenderSlot} from './render-slots.js';
import {PngEncoder} from './png-encoder.js';
import {renderFingerprint} from './render-cache.js';
import {freemem,availableParallelism} from 'node:os';

const require=createRequire(import.meta.url);
export type RenderOptions={at?:number;start?:number;duration?:number;scale?:number;benchmark?:{capture:'playwright'|'cdp';workers:1|2|4|6|8|16;stream:boolean;onFrame?:(index:number,png:Buffer)=>Promise<void>}};
export function captureWorkerLimit(memory=freemem(),processors=availableParallelism(),requested=process.env.VIDEOFORGE_CAPTURE_WORKERS){
  const allowed=[1,2,4,6,8,16],explicit=Number(requested);
  if(requested&&allowed.includes(explicit))return explicit;
  const gib=memory/1024**3;
  if(gib>=16&&processors>=16)return 16;
  if(gib>=8&&processors>=8)return 8;
  if(gib<1)return 1;if(gib<2)return 2;if(gib<3)return 4;
  return 6;
}
export type Engine='browser'|'hyperframes'|'remotion'|'blender';
export type RenderSpec={engine:Engine;entry:string;duration:number;width:number;height:number;fps:number;composition?:string};
export function cleanExecutionEnv():NodeJS.ProcessEnv {
  const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','LANG','LD_LIBRARY_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  env.PATH=resolve(process.env.VIDEOFORGE_ROOT??process.cwd(),'.runtime/bin')+delimiter+(env.PATH??'');return env;
}
export class CreativeRuntime {
  private librariesReady=false;
  constructor(readonly config:Config,readonly workspace:CreativeWorkspace,readonly signal:AbortSignal,readonly onProgress?:(text:string)=>Promise<void>) {}
  async command(command:string,workdir='.'){
    const cwd=workdir==='.'?this.workspace.root:await this.workspace.path(workdir);
    if(process.env.NODE_ENV==='production'&&this.config.executionMode!=='container')throw new AppError(503,'公开部署须启用隔离执行容器');
    if(this.config.executionMode==='container')return runProcess('docker',['run','--rm','--network=none','--memory=4g','--cpus=4','--pids-limit=256','--cap-drop=ALL','--security-opt=no-new-privileges',
      '-v',this.workspace.root+':/work','-v',join(this.config.root,'node_modules')+':/work/node_modules:ro','-w','/work/'+relative(this.workspace.root,cwd).replace(/\\/g,'/'),this.config.executionImage,'bash','-lc',command],this.workspace.root,this.signal,this.config.renderTimeout,undefined,cleanExecutionEnv());
    const shell=process.platform==='win32'?join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'):'/bin/bash';
    const args=process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',command]:['-lc',command];
    return runProcess(shell,args,cwd,this.signal,this.config.renderTimeout,undefined,cleanExecutionEnv());
  }
  async execute(kind:'node'|'python'|'blender',script:string,args:string[]=[]) {
    const file=await this.workspace.path(script);
    if(process.env.NODE_ENV==='production'&&this.config.executionMode!=='container')throw new AppError(503,'公开部署须启用隔离执行容器');
    const executable=kind==='node'?process.execPath:kind==='python'?this.config.python:this.config.blender;
    const parameters=kind==='blender'?['--background','--python',file,'--',...args]:[file,...args];
    if(this.config.executionMode==='container') {
      const inside='/work/'+script.replace(/\\/g,'/');
      return runProcess('docker',['run','--rm','--network=none','--memory=4g','--cpus=4','--pids-limit=256','--cap-drop=ALL','--security-opt=no-new-privileges',
        '-v',this.workspace.root+':/work','-v',join(this.config.root,'node_modules')+':/work/node_modules:ro','-w','/work',this.config.executionImage,
        kind==='node'?'node':kind==='python'?'python':'blender',...(kind==='blender'?['--background','--python',inside,'--',...args]:[inside,...args])],this.workspace.root,this.signal,this.config.renderTimeout,undefined,cleanExecutionEnv());
    }
    // Local desktop mode is for the owner of the workspace; never inherit provider credentials.
    const flags=kind==='node'?['--permission','--allow-fs-read='+this.workspace.root,'--allow-fs-read='+join(this.config.root,'node_modules'),
      '--allow-fs-read='+join(this.config.root,'package.json'),'--allow-fs-write='+this.workspace.root]:[];
    return runProcess(executable,[...flags,...parameters],this.workspace.root,this.signal,this.config.renderTimeout,undefined,cleanExecutionEnv());
  }
  async prepareLibraries() {
    if(this.librariesReady)return;
    await mkdir(join(this.workspace.root,'runtime'),{recursive:true});
    await copyFile(require.resolve('gsap/dist/gsap.min.js'),join(this.workspace.root,'runtime/gsap.min.js'));
    for(const name of ['MotionPathPlugin','DrawSVGPlugin','MorphSVGPlugin','SplitText','Flip','CustomEase','ScrollTrigger']) {
      try {await copyFile(require.resolve('gsap/dist/'+name+'.min.js'),join(this.workspace.root,'runtime/'+name+'.min.js'));}catch{}
    }
    try {
      const entry=require.resolve('three');
      await copyFile(join(dirname(entry),'three.module.js'),join(this.workspace.root,'runtime/three.module.js'));
      await copyFile(join(dirname(entry),'three.core.js'),join(this.workspace.root,'runtime/three.core.js'));
    }catch{}
    this.librariesReady=true;
  }
  async build(entry:string,output:string) {
    await this.prepareLibraries();
    const source=await this.workspace.path(entry),target=await this.workspace.path(output,true);
    const {build}=await import('esbuild');
    const result=await build({entryPoints:[source],outfile:target,bundle:true,platform:'browser',format:'esm',target:'es2022',nodePaths:[join(this.config.root,'node_modules')],logLevel:'silent',metafile:true});
    const inputs:Record<string,string>={};
    for(const file of Object.keys(result.metafile.inputs)){const absolute=resolve(file);if(absolute.startsWith(resolve(this.workspace.root)+sep))inputs[relative(this.workspace.root,absolute).replace(/\\/g,'/')]=createHash('sha256').update(await readFile(absolute)).digest('hex');}
    const builds=await this.workspace.read('build-manifest.json').then(r=>JSON.parse(r.content)).catch(()=>({}));
    builds[output]={entry,output,inputs};await this.workspace.write('build-manifest.json',JSON.stringify(builds));
    return {path:output};
  }
  async render(spec:RenderSpec,output:string,options:RenderOptions={}) {
    return withRenderSlot(this.config.dataRoot,this.config.concurrency,this.signal,()=>this.renderUnqueued(spec,output,options));
  }
  private async renderUnqueued(spec:RenderSpec,output:string,options:RenderOptions={}) {
    if(spec.engine==='browser'||spec.engine==='hyperframes')await this.prepareLibraries();
    if(options.at!==undefined&&(options.at<0||options.at>=spec.duration))throw new AppError(400,'静帧时间必须在影片范围内');
    if((options.start??0)<0||(options.start??0)+(options.duration??spec.duration-(options.start??0))>spec.duration+0.001)throw new AppError(400,'渲染时间超出片长');
    if(options.start!==undefined&&options.duration===undefined)options={...options,duration:spec.duration-options.start};
    await this.workspace.path(spec.entry);const target=await this.workspace.path(output,true);
    if(spec.engine==='blender')return this.blender(spec,target,options);
    if(spec.engine==='remotion')return this.remotion(spec,target,options);
    const builds=await this.workspace.read('build-manifest.json').then(r=>JSON.parse(r.content) as Record<string,{entry:string;output:string;inputs:Record<string,string>}>).catch(()=>({}));
    for(const build of Object.values(builds)){let stale=false;for(const [file,hash] of Object.entries(build.inputs)){if(createHash('sha256').update(await readFile(await this.workspace.path(file))).digest('hex')!==hash){stale=true;break;}}if(stale)await this.build(build.entry,build.output);}
    if(spec.engine==='hyperframes'&&options.at===undefined&&options.start===undefined&&options.duration===undefined)return this.hyperframes(spec,target);
    return this.browser(spec,target,options);
  }
  private async hyperframes(spec:RenderSpec,target:string){
    const cli=join(this.config.root,'node_modules/hyperframes/bin/hyperframes.mjs');
    if(!existsSync(cli))throw new AppError(503,'Hyperframes 导出工具未安装');
    await this.onProgress?.('正在使用 Hyperframes 官方引擎导出成片');
    const env:NodeJS.ProcessEnv={...cleanExecutionEnv(),HYPERFRAMES_TELEMETRY_DISABLED:'1'};
    if(process.env.PRODUCER_HEADLESS_SHELL_PATH)env['PRODUCER_HEADLESS_SHELL_PATH']=process.env.PRODUCER_HEADLESS_SHELL_PATH;
    await runProcess(process.execPath,[cli,'render',this.workspace.root,'--composition',spec.entry,'--output',target,'--fps',String(spec.fps),'--quality','high'],this.workspace.root,this.signal,this.config.renderTimeout,undefined,env);
    if(!existsSync(target))throw new AppError(503,'Hyperframes 未生成成片文件');
    await this.onProgress?.('Hyperframes 成片已导出，正在准备声音与交付检查');
    return {path:target,width:spec.width,height:spec.height,duration:spec.duration};
  }
  private async serve() {
    const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.wav':'audio/wav','.json':'application/json','.glb':'model/gltf-binary','.woff2':'font/woff2'};
    const server=createServer(async(req,res)=>{try{
      const path=decodeURIComponent(new URL(req.url??'/','http://localhost').pathname).slice(1);
      if(!path||path.startsWith('.harness/')||path.startsWith('versions/'))throw new Error('private');
      const file=await this.workspace.path(path);res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
    }catch{res.statusCode=404;res.end('not found');}}).listen(0,'127.0.0.1');
    await new Promise<void>(r=>server.once('listening',r));return {server,origin:'http://127.0.0.1:'+(server.address() as {port:number}).port};
  }
  private async browser(spec:RenderSpec,target:string,options:RenderOptions) {
    const {server,origin}=await this.serve(),scale=options.scale??1,width=Math.round(spec.width*scale),height=Math.round(spec.height*scale);
    const executablePath=process.env.PRODUCER_HEADLESS_SHELL_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(existsSync);
    let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,frames:string|undefined,encoder:PngEncoder|undefined;
    const metrics={seekMs:0,captureMs:0,captureWallMs:0,writeMs:0,progressMs:0,encodeMs:0,totalMs:0,frames:0,capture:'playwright',workers:1,stream:false};const started=performance.now();
    const stop=()=>{void browser?.close().catch(()=>{});};this.signal.addEventListener('abort',stop,{once:true});
    const errors:string[]=[];
    try {
      browser=await chromium.launch({headless:true,executablePath});
      this.signal.throwIfAborted();
      const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:scale,serviceWorkers:'block'});
      await context.routeWebSocket('**/*',s=>s.close());
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push('素材加载失败：'+r.url()));page.on('response',r=>{if(r.status()>=400)errors.push('素材返回 '+r.status()+'：'+r.url());});
      await page.goto(origin+'/'+spec.entry.replace(/\\/g,'/'),{waitUntil:'networkidle',timeout:60000});
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?(i.naturalWidth?Promise.resolve():Promise.reject(new Error('图片无法加载：'+i.src))):new Promise<void>((r,j)=>{i.onload=()=>r();i.onerror=()=>j(new Error('图片无法加载：'+i.src));})));});
      const seek=async(t:number,renderPage=page)=>{
        this.signal.throwIfAborted();
        await renderPage.evaluate(async(time)=>{
          const w=window as any;const fn=w.render??w.seek??w.__seek;
          if(typeof fn==='function')await fn(time);
          else if(w.__timelines?.main)w.__timelines.main.pause().seek(time,false);
          else throw new Error('工程需要提供 render(t)、seek(t) 或 window.__timelines.main，以准确重建指定时间的画面');
        },t);
        if(errors.length)throw Object.assign(new AppError(422,'画面运行出错'),{diagnostic:errors.join('\n')});
      };
      if(options.at!==undefined){await seek(options.at);await page.screenshot({path:target});return {path:target,width,height,at:options.at};}
      const start=options.start??0,duration=options.duration??spec.duration,count=Math.round(duration*spec.fps);if(count<1)throw new AppError(400,'预览时长不足一帧');
      frames=await this.workspace.path('.render-'+Date.now()+'/frame-000000.png',true);frames=dirname(frames);
      const key=await renderFingerprint(this.workspace,{spec,scale},true);
      let profile=await readFile(join(this.workspace.root,'.cache/browser-profile.json'),'utf8').then(JSON.parse).catch(()=>null);
      if(!options.benchmark&&!(profile?.verified&&profile.key===key&&profile.browserVersion===browser.version()&&profile.concurrencyVersion===2)){
        await this.onProgress?.('正在校验快速无损截图，保持画质不变');
        const probe=await context.newPage();probe.on('pageerror',e=>errors.push(e.message));
        await probe.goto(origin+'/'+spec.entry.replace(/\\/g,'/'),{waitUntil:'networkidle',timeout:60000});
        await probe.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
        const session=await context.newCDPSession(probe),{default:sharp}=await import('sharp');
        const concurrencyPages=[probe];
        let equal=true,slowMs=0,fastMs=0;
        try{
          for(const t of [0,spec.duration*.5,Math.max(0,spec.duration-1/spec.fps)]){
            await seek(t,page);let begin=performance.now();const old=await page.screenshot({type:'png'});slowMs+=performance.now()-begin;
            await seek(t,probe);begin=performance.now();const quick=Buffer.from((await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true})).data,'base64');fastMs+=performance.now()-begin;
            const oldPixels=await sharp(old).ensureAlpha().raw().toBuffer(),newPixels=await sharp(quick).ensureAlpha().raw().toBuffer();if(!oldPixels.equals(newPixels))equal=false;
          }
          const workerLimit=captureWorkerLimit();
          profile={verified:true,key,browserVersion:browser.version(),strategy:{capture:equal&&fastMs<slowMs*.95?'cdp':'playwright',workers:equal?workerLimit:1,stream:false},calibration:{equal,slowMs,fastMs}};
          if(profile.strategy.capture==='cdp'&&count>=150){
            const candidates=[1,2,4,6,8,16].filter(n=>n<=workerLimit);
            await this.onProgress?.('正在比较 '+candidates.join('、')+' 页截图速度，并校验画面一致性');
            for(let i=1;i<workerLimit;i++){
              const extra=await context.newPage();concurrencyPages.push(extra);
              extra.on('pageerror',e=>errors.push(e.message));
              await extra.goto(origin+'/'+spec.entry.replace(/\\/g,'/'),{waitUntil:'networkidle',timeout:60000});
              await extra.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
            }
            const sessions=await Promise.all(concurrencyPages.map(p=>context.newCDPSession(p)));
            const reference:Buffer[]=[],measurements:{workers:number;ms:number;equal:boolean}[]=[],probeCount=Math.max(12,workerLimit*2);
            for(const workers of candidates){
              await Promise.all(concurrencyPages.slice(0,workers).map(async p=>{await p.reload({waitUntil:'networkidle'});await p.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});}));
              const captures:Buffer[]=[],begin=performance.now();
              await Promise.all(concurrencyPages.slice(0,workers).map(async(p,index)=>{
                for(let f=index;f<probeCount;f+=workers){
                  await seek(start+f*Math.max(0,duration-1/spec.fps)/(probeCount-1),p);
                  captures[f]=Buffer.from((await sessions[index].send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true})).data,'base64');
                }
              }));
              const ms=performance.now()-begin;let identical=true;
              for(let f=0;f<probeCount;f++){
                const raw=await sharp(captures[f]).ensureAlpha().raw().toBuffer();
                if(workers===1)reference[f]=raw;else if(!reference[f].equals(raw))identical=false;
              }
              measurements.push({workers,ms,equal:identical});
            }
            const fastest=measurements.filter(m=>m.equal).sort((a,b)=>a.ms-b.ms)[0];
            const preferred=measurements.find(m=>m.workers===workerLimit&&m.equal);
            profile.strategy.workers=preferred&&preferred.ms<=fastest.ms*1.15?workerLimit:fastest.workers;
            profile.concurrency=measurements;
            await this.onProgress?.('截图校验完成，采用 '+profile.strategy.workers+' 页并行无损截图');
          }
          profile.concurrencyVersion=2;
          await mkdir(join(this.workspace.root,'.cache'),{recursive:true});await writeFile(join(this.workspace.root,'.cache/browser-profile.json'),JSON.stringify(profile));
        }catch(error){
          this.signal.throwIfAborted();if(errors.length)throw error;
          profile={verified:true,concurrencyVersion:2,key,browserVersion:browser.version(),strategy:{capture:'playwright',workers:1,stream:false}};
          await this.onProgress?.('快速截图校验未通过，保留原画质截图方式');
        }finally{await Promise.all(concurrencyPages.map(p=>p.close()));}
        await page.reload({waitUntil:'networkidle'});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
      }
      const trusted=profile?.verified===true&&profile.key===key&&profile.browserVersion===browser.version();
      const selected=options.benchmark??(trusted?profile.strategy:{capture:'playwright',workers:1,stream:false});
      const workers=selected.stream?1:Math.min(count,options.benchmark?selected.workers:Math.min(captureWorkerLimit(),[1,2,4,6,8,16].includes(selected.workers)?selected.workers:6));
      Object.assign(metrics,{capture:selected.capture,workers,stream:selected.stream});
      const pages=[page];
      const extraPages=await Promise.all(Array.from({length:workers-1},async()=>{
        const extra=await context.newPage();extra.on('pageerror',e=>errors.push(e.message));
        extra.on('requestfailed',r=>errors.push('素材加载失败：'+r.url()));
        extra.on('response',r=>{if(r.status()>=400)errors.push('素材返回 '+r.status()+'：'+r.url());});
        await extra.goto(origin+'/'+spec.entry.replace(/\\/g,'/'),{waitUntil:'networkidle',timeout:60000});
        await extra.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});return extra;
      }));
      pages.push(...extraPages);
      const sessions=await Promise.all(pages.map(p=>context.newCDPSession(p)));
      if(selected.stream)encoder=new PngEncoder(this.config.ffmpeg,spec.fps,target,this.workspace.root,this.signal,this.config.renderTimeout);
      let lastProgress=0,finished=0;
      const captureStarted=performance.now();
      await Promise.all(pages.map(async(renderPage,index)=>{
        for(let f=index;f<count;f+=workers){
          let at=performance.now();await seek(start+f/spec.fps,renderPage);metrics.seekMs+=performance.now()-at;
          at=performance.now();
          const png=selected.capture==='cdp'?Buffer.from((await sessions[index].send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true})).data,'base64'):await renderPage.screenshot({type:'png'});
          metrics.captureMs+=performance.now()-at;
          await options.benchmark?.onFrame?.(f,png);
          at=performance.now();if(encoder)await encoder.write(png);else await writeFile(join(frames!,'frame-'+String(f).padStart(6,'0')+'.png'),png);metrics.writeMs+=performance.now()-at;
          finished++;metrics.frames=finished;
          if(this.onProgress&&(Date.now()-lastProgress>1000||finished===count)){lastProgress=Date.now();at=performance.now();await this.onProgress('正在渲染 '+finished+' / '+count+' 帧 · '+(finished/spec.fps).toFixed(1)+' / '+duration.toFixed(1)+' 秒');metrics.progressMs+=performance.now()-at;}
        }
      }));
      metrics.captureWallMs=performance.now()-captureStarted;
      await this.onProgress?.('画面捕获完成，正在完成视频编码');
      const encodeStart=performance.now();
      if(encoder)await encoder.finish();
      else await runProcess(this.config.ffmpeg,['-y','-hide_banner','-loglevel','error','-framerate',String(spec.fps),'-i',join(frames,'frame-%06d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',target],this.workspace.root,this.signal,this.config.renderTimeout,undefined,cleanExecutionEnv());
      metrics.encodeMs=performance.now()-encodeStart;metrics.totalMs=performance.now()-started;
      await mkdir(join(this.workspace.root,'.cache'),{recursive:true});await writeFile(join(this.workspace.root,'.cache/last-render.json'),JSON.stringify({key,browserVersion:browser.version(),metrics},null,2));
      return {path:target,width,height,duration,frames:count,metrics};
    } finally {this.signal.removeEventListener('abort',stop);await encoder?.dispose();await browser?.close();await new Promise<void>(r=>server.close(()=>r()));if(frames)await rm(frames,{recursive:true,force:true});}
  }
  private async remotion(spec:RenderSpec,target:string,options:RenderOptions) {
    const {bundle}=await import('@remotion/bundler'),{selectComposition,renderStill,renderMedia}=await import('@remotion/renderer');
    const serveUrl=await bundle({entryPoint:await this.workspace.path(spec.entry),outDir:await this.workspace.path('.cache/remotion',true),publicDir:join(this.workspace.root,'public'),
      webpackOverride:config=>({...config,resolve:{...config.resolve,modules:[join(this.config.root,'node_modules'),'node_modules']}})});
    const browserExecutable=process.env.PRODUCER_HEADLESS_SHELL_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(existsSync);
    const selected=await selectComposition({serveUrl,id:spec.composition??'main',browserExecutable});
    const composition={...selected,width:spec.width,height:spec.height,fps:spec.fps,durationInFrames:Math.round(spec.duration*spec.fps)};
    if(options.at!==undefined)await renderStill({serveUrl,composition,output:target,frame:Math.min(composition.durationInFrames-1,Math.round(options.at*spec.fps)),browserExecutable,scale:options.scale??1});
    else {
      const first=Math.round((options.start??0)*spec.fps),last=first+Math.round((options.duration??spec.duration)*spec.fps)-1;
      const {makeCancelSignal}=await import('@remotion/renderer');const {cancelSignal,cancel}=makeCancelSignal();
      const stop=()=>cancel();this.signal.addEventListener('abort',stop,{once:true});
      try {await renderMedia({serveUrl,composition,outputLocation:target,codec:'h264',browserExecutable,frameRange:[first,last],scale:options.scale??1,concurrency:2,cancelSignal});}
      finally {this.signal.removeEventListener('abort',stop);}
    }
    return {path:target,duration:options.duration??spec.duration,engine:'remotion'};
  }
  private async blender(spec:RenderSpec,target:string,options:RenderOptions) {
    const source=await this.workspace.path(spec.entry);
    const folder=dirname(target),stem=join(folder,'blender-frame-');
    const map=(file:string)=>this.config.executionMode==='container'?'/work/'+relative(this.workspace.root,file).replace(/\\/g,'/'):file;
    const start=Math.round((options.at??options.start??0)*spec.fps)+1,end=options.at!==undefined?start:start+Math.round((options.duration??spec.duration)*spec.fps)-1;
    const script=`import bpy\nbpy.ops.wm.open_mainfile(filepath=${JSON.stringify(map(source))})\ns=bpy.context.scene\ns.render.resolution_x=${spec.width}\ns.render.resolution_y=${spec.height}\ns.render.resolution_percentage=${Math.round((options.scale??1)*100)}\ns.render.fps=${spec.fps}\ns.frame_start=${start}\ns.frame_end=${end}\ns.render.image_settings.file_format='PNG'\ns.render.filepath=${JSON.stringify(map(stem))}\nbpy.ops.render.render(animation=True)\n`;
    const file='scripts/.blender-render.py';await this.workspace.write(file,script);await this.execute('blender',file);
    if(options.at!==undefined)await copyFile(stem+String(start).padStart(4,'0')+'.png',target);
    else await runProcess(this.config.ffmpeg,['-y','-hide_banner','-loglevel','error','-framerate',String(spec.fps),'-start_number',String(start),'-i',stem+'%04d.png','-c:v','libx264','-pix_fmt','yuv420p',target],this.workspace.root,this.signal,this.config.renderTimeout,undefined,cleanExecutionEnv());
    for(const f of await readdir(folder))if(f.startsWith('blender-frame-')&&f.endsWith('.png'))await rm(join(folder,f));
    return {path:target,duration:options.duration??spec.duration,engine:'blender'};
  }
}
