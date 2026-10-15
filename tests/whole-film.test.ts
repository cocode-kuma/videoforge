import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';
import {fixtureBoard} from './fixtures.js';
import {validateWholeFilm} from '../plugins/cocode-director/whole-film.js';
import {briefSchema,wholeFilmSchema} from '../shared/contracts.js';
import {creationResponse,stageName} from './creation-fixtures.js';

const html=`<!doctype html><html><head><script src="gsap.min.js"></script><style>body{margin:0}#main{width:1280px;height:720px;background:#101b12;color:#f2f8ed}#headline{font:64px Arial}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="15" data-width="1280" data-height="720"><div id="headline">让灵感发生</div></div><script>const tl=gsap.timeline({paused:true});tl.fromTo('#headline',{x:-100},{x:100,duration:15});window.__timelines['main']=tl;</script></body></html>`;
test('whole film accepts free camera descriptions and rejects mismatched runtime contracts',async()=>{
  const board=structuredClone(fixtureBoard);board.scenes[0].camera='沿曲线路径追随光点';board.scenes[0].motif='流体墨迹';
  assert.equal(wholeFilmSchema.parse({storyboard:board,html}).storyboard.scenes[0].motif,'流体墨迹');
  const continuous=structuredClone(board);continuous.scenes=continuous.scenes.slice(0,1);continuous.scenes[0].duration=60;continuous.scenes[0].sustainedMotion='连续绘制故事中的物体';
  assert.equal(wholeFilmSchema.parse({storyboard:continuous,html}).storyboard.scenes[0].duration,60);
  const brief=briefSchema.parse({prompt:'创作连贯的全片动画',duration:15});
  await validateWholeFilm(html,board,brief);
  await assert.rejects(validateWholeFilm(html.replace('data-width="1280"','data-width="720"'),board,brief),/data-width/);
  await assert.rejects(validateWholeFilm(html.replace('data-composition-id="main"','data-composition-id="s1"'),board,brief),/合成根/);
  const shorter=structuredClone(board);shorter.scenes[0].duration=2;
  await assert.rejects(validateWholeFilm(html,shorter,brief),/总时长/);
});
test('production whole-film queue completes five stages without separate scene files',async()=>{
  let calls=0;
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const request=JSON.parse(raw);calls++;
    assert.equal(request.model,'fixed-whole-film-model');
    assert.match(request.messages[0].content,/search_skills/);
    assert.ok(!request.messages[0].content.includes('The Current'));
    assert.ok(request.tools.some((tool:{function:{name:string}})=>tool.function.name==='read_skill'));
    const input=JSON.parse(request.messages[1].content);
    assert.ok(input.availableRuntime.scripts.includes('runtime/MotionPathPlugin.min.js'));
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(creationResponse(stageName(request.messages[0].content),html))}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>provider.once('listening',resolve));
  const root=await mkdtemp(join(tmpdir(),'vf-whole-'));
  const store=new DataStore({...readConfig(root),creationMode:"pipeline",apiKey:'test-only',model:'fixed-whole-film-model',baseUrl:`http://127.0.0.1:${(provider.address() as {port:number}).port}`});await store.init();
  const director=new Director(store);let assembled=0;
  director.renderScene=async()=>{throw new Error('separate scene generation must not run');};
  director.assembleVideo=async scope=>{assembled++;const project=await store.loadProject(scope.userId,scope.projectId);assert.equal(project.renders.at(-1)?.generationMode,'whole-film');return {video:`renders/${scope.jobId}/final.mp4`,duration:15};};
  try{
    const user=await store.register('whole@example.com','whole-film-test-123','Whole','kuma','192.0.2.55');
    const project=await store.createProject(user.id,'Whole film');
    const job=await director.submit(user.id,project.id,{prompt:'自由创作完整的影片',duration:15,workflow:'auto'});
    let result;
    const deadline=Date.now()+60_000;
    while(Date.now()<deadline){result=(await store.loadProject(user.id,project.id)).renders.at(-1)!;if(['completed','failed'].includes(result.status))break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(result?.status,'completed',result?.error??`queue did not finish within 60 seconds (status=${result?.status}, providerCalls=${calls})`);
    assert.equal(calls,5);assert.equal(assembled,1);assert.equal(result?.tokenUsage?.calls,5);
    const dir=join(await store.projectDir(user.id,project.id),'renders',job.id);
    assert.equal(await readFile(join(dir,'index.html'),'utf8'),html);
    assert.equal(await stat(join(dir,'ledger.json')).then(()=>true).catch(()=>false),false);
    assert.equal(await stat(join(dir,'s1')).then(()=>true).catch(()=>false),false);
    assert.ok((await readFile(join(dir,'runtime/MotionPathPlugin.min.js'),'utf8')).includes('MotionPathPlugin'));
    for(const stage of ['story','design','motion','code','delivery'])assert.ok(await stat(join(dir,stage+'.json')));
  }finally{await director.dispose();await new Promise<void>(resolve=>provider.close(()=>resolve()));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:250});}
});
