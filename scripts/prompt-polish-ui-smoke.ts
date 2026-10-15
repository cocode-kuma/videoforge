import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {createApp} from '../plugins/cocode-studio-ui/index.js';
import {readConfig} from '../shared/config.js';

const out=resolve('.test-artifacts/prompt-polish-ui');await mkdir(out,{recursive:true});
const config={...readConfig(),dataRoot:join(out,'data-'+Date.now()),logsRoot:join(out,'logs'),apiKey:'ui-test-only',mailApiUrl:'',officialQuotaApiUrl:'',secure:false};
const store=new DataStore(config);await store.init();const director=new Director(store);
let release:(()=>void)|undefined;
const polished='制作一支 18 秒的中文缓存科普片，面向零基础手机观众。\n9:16，720p，24 FPS，以 SVG 与浏览器动画实现。\n用“常用工具放在手边的小盒子里”解释近处保存、下次快取，并提示需要更新。\n0–3 秒展示问题，3–8 秒建立类比，8–15 秒说明快取与更新，15–18 秒保留结论。\n关键帧和动态预览通过检查后交付 MP4、素材和可编辑源码。';
director.prepareBrief=async(_uid,_pid,input)=>{await new Promise<void>(r=>{release=r;});return {brief:{...(input as any),prompt:polished,duration:18,aspect:'9:16',exportResolution:'720p',exportFps:24},usage:{calls:1,promptTokens:100,completionTokens:50,totalTokens:150},sources:[]};};
director.submit=async(uid,pid,brief)=>store.enqueue(uid,pid,brief as any);
const server=createApp(store,director).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;config.origin=origin;
const browser=await chromium.launch({headless:true,executablePath:process.env.PRODUCER_HEADLESS_SHELL_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
  const user=await store.register('polish-ui@example.com','password-polish-ui','Polish UI','kuma','192.0.2.160');
  const project=await store.createProject(user.id,'提示词润色界面验收');
  const context=await browser.newContext({viewport:{width:1440,height:960}});await context.addCookies([{name:'cocode_session',value:await store.newSession(user.id),url:origin}]);
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/studio');await page.getByText(project.name,{exact:true}).first().click();
  await page.locator('textarea').fill('给手机用户做一个缓存科普');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/正在结合教程/);
  await page.screenshot({path:join(out,'pending-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'pending-mobile.png'),fullPage:true});
  const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=844);
  release!();await page.getByText('创意，已经清晰成形',{exact:true}).waitFor();
  assert.equal(await page.locator('.polish-result').innerText(),polished);
  await page.screenshot({path:join(out,'result-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:960});await page.screenshot({path:join(out,'result-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'查看创作进展'}).click();
  const persisted=await store.loadProject(user.id,project.id);assert.equal(persisted.brief?.prompt,polished);assert.equal(persisted.brief?.exportFps,24);
  assert.ok(!persisted.messages.some(m=>m.text==='给手机用户做一个缓存科普'));
  assert.deepEqual(errors,[]);console.log('润色动画、桌面与手机布局、润色结果和实际入队内容验证通过。');
}finally{release?.();await browser.close();await director.dispose();await new Promise<void>(r=>server.close(()=>r()));}
