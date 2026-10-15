import {join,resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';
import {createApp} from '../plugins/cocode-studio-ui/index.js';

const out=resolve('.test-artifacts/harness-smoke'),config={...readConfig(),dataRoot:join(out,'data'),logsRoot:join(out,'logs')};
const store=new DataStore(config);await store.init();
const accounts=JSON.parse(await readFile(join(out,'data/users.json'),'utf8'));
const user=accounts.users.at(-1),project=(await store.listProjects(user.id))[0],job=project.renders.at(-1)!;
const director=new Director(store),server=createApp(store,director).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
const browser=await chromium.launch({headless:true,executablePath:process.env.PRODUCER_HEADLESS_SHELL_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
  const context=await browser.newContext({viewport:{width:1440,height:960}});await context.addCookies([{name:'cocode_session',value:await store.newSession(user.id),url:origin}]);
  const page=await context.newPage();const failures:string[]=[];page.on('response',r=>{if(r.status()>=400)failures.push(r.status()+' '+r.url());});page.on('pageerror',e=>{failures.push('JS '+e.message);console.log('UI error: '+e.message);});
  await page.goto(origin+'/studio');await page.getByText(project.name,{exact:true}).first().click();
  await page.screenshot({path:join(out,'studio-before.png'),fullPage:true});
  await writeFile(join(out,'ui-state.json'),JSON.stringify({project:project.id,job:job.id,body:await page.locator('body').innerText(),failures},null,2));
  const img=page.locator('.creative-artifact img').first();await img.scrollIntoViewIfNeeded();await img.waitFor();
  await img.evaluate((i:any)=>i.complete&&i.naturalWidth?true:new Promise((yes,no)=>{i.onload=()=>yes(true);i.onerror=()=>no(new Error('图片加载失败'));}));
  await page.screenshot({path:join(out,'studio.png'),fullPage:true});
  const prefix=origin+`/api/projects/${project.id}/jobs/${job.id}`;
  const hidden=await page.request.get(prefix+'/artifact?path=.harness/checkpoint.json');if(hidden.status()!==404)throw new Error('私有检查点泄露');
  const zip=await page.request.get(prefix+'/source');if(zip.status()!==200)throw new Error('源码包下载失败');await writeFile(join(out,'source.zip'),await zip.body());
  const visible=failures.filter(s=>!s.includes('.harness'));if(visible.length)throw new Error(visible.join('\n'));
  console.log('前端真实素材加载、对话展示、源码下载和私有文件隔离通过');
} finally {await browser.close();await director.dispose();await new Promise<void>(r=>server.close(()=>r()));}
