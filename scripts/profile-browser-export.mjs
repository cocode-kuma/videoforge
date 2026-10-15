import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,cp} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import sharp from 'sharp';
const source=resolve(process.argv[2]),out=resolve(process.argv[3]||'.test-artifacts/export-profile');
await mkdir(out,{recursive:true});
const root=join(out,'workspace');
await cp(source,root,{recursive:true,filter:p=>!/[\\/](?:exports|previews|versions|audio|\.harness|\.render-[^\\/]+)(?:[\\/]|$)/.test(p)&&!/[\\/](?:final[^\\/]*\.mp4|review\.json|delivery\.json)$/.test(p)});
const spec=JSON.parse(await readFile(join(root,'project.json'),'utf8'));
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(root))throw Error();res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const results=[];
try{
 const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},serviceWorkers:'block'});
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/${spec.entry}`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);
 const cdp=await context.newCDPSession(page);
 const gpu=await page.evaluate(()=>{const c=document.querySelector('canvas'),g=c?.getContext('webgl2')||c?.getContext('webgl');const e=g?.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null;});
 for(let f=0;f<8;f++){
  const t=7.5+f/spec.fps,record={frame:f};let a=performance.now();await page.evaluate(t=>window.render(t),t);record.seekMs=performance.now()-a;
  a=performance.now();const normal=await page.screenshot({type:'png'});record.playwrightMs=performance.now()-a;
  a=performance.now();const fast=Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true})).data,'base64');record.cdpMs=performance.now()-a;
  a=performance.now();await writeFile(join(out,`frame-${f}.png`),fast);record.writeMs=performance.now()-a;
  const x=await sharp(normal).ensureAlpha().raw().toBuffer(),y=await sharp(fast).ensureAlpha().raw().toBuffer();record.identical=x.equals(y);results.push(record);console.log(JSON.stringify(record));
 }
 await writeFile(join(out,'profile.json'),JSON.stringify({gpu,spec,results},null,2));console.log('GPU',gpu);
}finally{await browser.close();await new Promise(r=>server.close(r));}
