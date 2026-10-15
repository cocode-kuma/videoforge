import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director,type RunScope} from '../plugins/cocode-director/index.js';
import {readConfig} from '../shared/config.js';
import {AppError} from '../shared/contracts.js';
import {creationHtml,creationResponse,stageName,creationBoard} from './creation-fixtures.js';
import sharp from 'sharp';

async function harness(provider:(request:any)=>unknown,config:Record<string,unknown>={}) {
  const requests:any[]=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    const request=JSON.parse(raw);requests.push(request);
    try {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:provider(request)}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}}));}
    catch(error){res.statusCode=500;res.end(String(error));}
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const root=await mkdtemp(join(tmpdir(),'vf-pipeline-'));
  const store=new DataStore({...readConfig(root),creationMode:"pipeline",thinking:true,apiKey:'test-only',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,visionBaseUrl:'',visionApiKey:'',visionModel:'',maxRepairs:2,...config});
  await store.init();const director=new Director(store);
  const user=await store.register('pipeline@example.com','test-password-123','Pipeline','kuma','192.0.2.102');
  const project=await store.createProject(user.id,'Pipeline');
  const job=await store.enqueue(user.id,project.id,{prompt:'制作两个连续场景，保持主体与清晰文案',duration:15,aspect:'16:9',style:'minimal'});
  const scope:RunScope={userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}};
  return {store,director,scope,requests,root,dir:join(await store.projectDir(user.id,project.id),'renders',job.id),
    close:async()=>{await director.dispose();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:250});}};
}

test('five stages use native skill tools, preserve thinking tool context and share two repairs',async()=>{
  let reviewCalls=0;
  const h=await harness(request=>{
    const stage=stageName(request.messages[0].content);
    const toolMessages=request.messages.filter((m:any)=>m.role==='tool');
    if(stage==='story'&&toolMessages.length===0)return {content:null,reasoning_content:'需要查阅叙事规范',tool_calls:[{id:'search',type:'function',function:{name:'search_skills',arguments:JSON.stringify({query:'story-spine'})}}]};
    if(stage==='story'&&toolMessages.length===1) {
      const found=JSON.parse(toolMessages[0].content);assert.ok(found[0].path.includes('story-spine'));
      return {content:null,reasoning_content:'读取规范',tool_calls:[{id:'read',type:'function',function:{name:'read_skill',arguments:JSON.stringify({path:found[0].path})}}]};
    }
    if(stage==='story') {
      assert.ok(JSON.parse(toolMessages[1].content).content.length>100);
      assert.equal(request.messages.find((m:any)=>m.tool_calls?.[0]?.id==='search').reasoning_content,'需要查阅叙事规范');
    }
    let result:unknown=creationResponse(stage,stage==='code'?creationHtml.replace("const tl=",'const =; const tl='):creationHtml);
    if(stage==='review'&&reviewCalls++===0)result={passed:false,issues:[{severity:'error',at:8,problem:'第二阶段文案信息未充分表现',fix:'保留主体与时间线，补全第二阶段文案表现'}],summary:'需局部修复'};
    return {content:JSON.stringify(result)};
  });
  try {
    await h.director.generateWholeFilm(h.scope);
    let audits=0,exports=0;
    h.director.auditWholeFilm=async(_s,dir)=>{
      audits++;
      if((await readFile(join(dir,'index.html'),'utf8')).includes('const =;'))throw Object.assign(new AppError(503,'语法错误'),{diagnostic:'SyntaxError: const =;'});
    };
    h.director.exportVideo=async()=>{exports++;return {video:'test.mp4',duration:15};};
    await h.director.assembleWholeFilm(h.scope);
    assert.equal(audits,3);assert.equal(exports,1);assert.equal(reviewCalls,2);
    const record=(await h.store.loadProject(h.scope.userId,h.scope.projectId)).renders.at(-1)!;
    assert.equal(record.repairCount,2);assert.equal(record.qualityReport?.passed,true);
    assert.equal(record.qualityReport?.reviewMode,'code');assert.equal(record.qualityReport?.visualReviewPassed,undefined);
    assert.ok(!record.qualityReport?.checks.includes('visual-review'));
    const snapshot=JSON.parse(await readFile(join(h.dir,'skills.json'),'utf8'));
    assert.ok(snapshot.files.some((file:any)=>file.path.includes('story-spine')));
    assert.equal(h.scope.tokenUsage.calls,h.requests.length);assert.equal(h.scope.tokenUsage.totalTokens,h.requests.length*300);
    assert.ok(h.requests.every(request=>request.thinking.type==='enabled'));
    assert.equal(await readFile(join(h.dir,'index.html'),'utf8'),creationHtml);
    assert.ok((await readFile(join(h.dir,'repair-1-before.txt'),'utf8')).includes('const =;'));
    await assert.rejects(h.director.repairWholeFilm(h.scope,'仍有错误'),/2 次修复/);
  } finally {await h.close();}
});

test('delivery metadata mismatch is corrected and source edits carry previous HTML and assets',async()=>{
  let deliveryCalls=0;
  const h=await harness(request=>{
    const stage=stageName(request.messages[0].content);
    const value:any=creationResponse(stage);
    if(stage==='delivery'&&deliveryCalls++===0)value.storyboard.scenes[0].duration=6;
    return {content:JSON.stringify(value)};
  });
  try {
    await h.director.generateWholeFilm(h.scope);
    assert.equal(deliveryCalls,2);
    await mkdir(join(h.dir,'assets'),{recursive:true});
    await writeFile(join(h.dir,'assets','retained.svg'),'<svg/>');
    await writeFile(join(h.dir,'asset-manifest.json'),JSON.stringify([{id:'retained',file:'assets/retained.svg',name:'旧版主体',kind:'image'}]));
    await h.store.updateProject(h.scope.userId,h.scope.projectId,p=>p.renders.at(-1)!.status='completed');
    const next=await h.store.enqueue(h.scope.userId,h.scope.projectId,{prompt:'仅把主标题放大，其余主体保留',duration:15,aspect:'16:9',style:'minimal'});
    const scope={...h.scope,jobId:next.id};
    await h.director.generateWholeFilm(scope);
    const codeRequests=h.requests.filter(request=>stageName(request.messages[0].content)==='code');
    const input=JSON.parse(codeRequests.at(-1).messages[1].content);
    assert.equal(input.previousHtml,creationHtml);
    assert.ok(input.assets.some((asset:any)=>asset.file==='assets/retained.svg'));
    const nextDir=join(await h.store.projectDir(scope.userId,scope.projectId),'renders',scope.jobId);
    assert.equal(await readFile(join(nextDir,'assets/retained.svg'),'utf8'),'<svg/>');
  } finally {await h.close();}
});

test('configured vision receives actual screenshots and records a separate visual result',async()=>{
  let sawPixels=false;
  const h=await harness(request=>{
    const stage=stageName(request.messages[0].content);
    if(stage==='review') {
      assert.equal(request.model,'vision-test');
      sawPixels=request.messages[1].content.some((part:any)=>part.type==='image_url'&&part.image_url.url.startsWith('data:image/jpeg;base64,'));
    }
    return {content:JSON.stringify(creationResponse(stage))};
  });
  try {
    await h.director.generateWholeFilm(h.scope);
    h.store.config.visionBaseUrl=h.store.config.baseUrl;h.store.config.visionApiKey='test';h.store.config.visionModel='vision-test';
    await mkdir(join(h.dir,'seek-snapshots'),{recursive:true});
    await writeFile(join(h.dir,'seek-snapshots','s1-1.000.png'),await sharp({create:{width:64,height:64,channels:3,background:'#101b12'}}).png().toBuffer());
    const result=await h.director.reviewWholeFilm(h.scope,h.dir,creationBoard);
    assert.equal(result.mode,'vision');assert.equal(sawPixels,true);
    assert.equal(JSON.parse(await readFile(join(h.dir,'review-0.json'),'utf8')).mode,'vision');
  } finally {await h.close();}
});

test('environmental failures do not consume HTML repair calls',async()=>{
  const h=await harness(request=>({content:JSON.stringify(creationResponse(stageName(request.messages[0].content)))}));
  try {
    await h.director.generateWholeFilm(h.scope);
    h.director.auditWholeFilm=async()=>{throw new AppError(503,'无法启动视频引擎');};
    await assert.rejects(h.director.assembleWholeFilm(h.scope),/无法启动/);
    assert.equal(h.requests.length,5);
    assert.equal((await h.store.loadProject(h.scope.userId,h.scope.projectId)).renders.at(-1)?.repairCount,0);
    h.director.auditWholeFilm=async()=>{throw Object.assign(new AppError(503,'引擎失败'),{diagnostic:'ENAMETOOLONG: temporary path too long'});};
    await assert.rejects(h.director.assembleWholeFilm(h.scope),/引擎失败/);
    assert.equal(h.requests.length,5);
  } finally {await h.close();}
});
