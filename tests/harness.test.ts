import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {HarnessLoop} from '../plugins/cocode-director/harness-loop.js';
import {readConfig} from '../shared/config.js';
import type {TokenUsage} from '../shared/contracts.js';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {CreativeHarness} from '../plugins/cocode-director/harness.js';
import {fixtureBoard} from './fixtures.js';

test('workspace supports independent assets, exact edits, snapshots and restoration without traversal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vf-workspace-')),w=new CreativeWorkspace(root);
  try {
    await w.write('assets/cup.svg','<svg>cup</svg>');await w.write('src/main.js','render(0)');const version=await w.snapshot('before');
    await w.edit('src/main.js','render(0)','render(1)');await w.write('extra.js','extra');await w.restore(version.id);
    assert.equal((await w.read('src/main.js')).content,'render(0)');assert.equal((await w.files()).some(f=>f.path==='extra.js'),false);
    await assert.rejects(()=>w.write('../outside.txt','escape'));await assert.rejects(()=>w.read('C:/secret'));await assert.rejects(()=>w.edit('src/main.js','missing','x'));
  } finally {await rm(root,{recursive:true,force:true});}
});
test('harness streams public text, keeps native thinking/tool context, permits tools beyond round four and accepts steering',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vf-loop-'));let calls=0,toolRuns=0,publicMessages:string[]=[],steered=false;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;const request=JSON.parse(raw);const i=calls++;
    assert.equal(request.tool_choice,'auto');assert.equal(request.response_format,undefined);
    const images=request.messages.filter((m:any)=>Array.isArray(m.content)).flatMap((m:any)=>m.content).filter((p:any)=>p.type==='image_url');
    if(i===1)assert.equal(images.length,1);
    if(i>=2)assert.equal(images.length,0,'already observed screenshots should not be billed again on every turn');
    if(i>0)assert.ok(request.messages.some((m:any)=>m.reasoning_content==='private planning'));
    if(i===6){steered=request.messages.some((m:any)=>m.content==='把杯子放大');}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'我正在制作',reasoning_content:'private planning'}}]})+'\n\n');
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'工程。',tool_calls:[{index:0,id:'c'+i,type:'function',function:{name:i===6?'submit_delivery':'work',arguments:JSON.stringify({step:i})}}]},finish_reason:'tool_calls'}]})+'\n\n');
    res.end('data: '+JSON.stringify({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},choices:[]})+'\n\ndata: [DONE]\n\n');
  }).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  // Start above the former ceilings; usage is accounting, never a stop condition.
  const usage:TokenUsage={calls:81,promptTokens:600001,completionTokens:0,totalTokens:600001};
  const config={...readConfig(),baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port,apiKey:'test-only'};
  let sent=false;
  try {
    const loop=new HarnessLoop(config,new AbortController().signal,usage,root,{message:async(_id,text)=>{publicMessages.push(text);},input:async()=>{if(toolRuns===6&&!sent){sent=true;return ['把杯子放大'];}return [];},checkpoint:async()=>{},state:async()=>({}),tool:async()=>{}});
    await loop.run('create',{brief:'cup'},[{name:'work',description:'work',parameters:{type:'object'},execute:async()=>{toolRuns++;return {saved:true,...(toolRuns===1?{__images:[{type:'text',text:'实际画面 previews/cup.png'},{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]}:{})};}},
      {name:'submit_delivery',description:'submit',parameters:{type:'object'},execute:async()=>({accepted:true})}]);
    assert.equal(calls,7);assert.equal(toolRuns,6);assert.equal(steered,true);assert.equal(usage.totalTokens,600106);assert.equal(usage.calls,88);
    assert.ok(publicMessages.includes('我正在制作工程。'));assert.ok(publicMessages.every(m=>!m.includes('private planning')));
    assert.ok(JSON.parse(await readFile(join(root,'checkpoint.json'),'utf8')).messages.length>10);
  } finally {await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
test('interrupted tool calls are reconciled from journal rather than repeating a paid action',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vf-resume-'));
  await writeFile(join(root,'checkpoint.json'),JSON.stringify({messages:[{role:'system',content:'old'},{role:'user',content:'brief'},
    {role:'assistant',content:null,reasoning_content:'thinking',tool_calls:[{id:'paid',type:'function',function:{name:'generate_asset',arguments:'{}'}}]}]}));
  await writeFile(join(root,'tool-paid.json'),JSON.stringify({path:'assets/already-created.png'}));
  let repeated=0,sawSaved=false;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;const request=JSON.parse(raw);sawSaved=request.messages.some((m:any)=>m.role==='tool'&&m.content.includes('already-created'));
    assert.match(request.messages[0].content,/VideoForge 内部创作准则 v1/);
    assert.match(request.messages[0].content,/任意时刻都能准确重建画面/);
    assert.match(request.messages[0].content,/用时间点、问题和期望做最小修订/);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'继续已有作品',tool_calls:[{id:'finish',type:'function',function:{name:'submit_delivery',arguments:'{}'}}]},finish_reason:'tool_calls'}]}));
  }).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try {
    const config={...readConfig(),baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port,apiKey:'test-only'};
    const loop=new HarnessLoop(config,new AbortController().signal,{calls:0,promptTokens:0,completionTokens:0,totalTokens:0},root,{message:async()=>{},input:async()=>[],checkpoint:async()=>{},state:async()=>({}),tool:async()=>{}});
    await loop.run('new',{},[{name:'generate_asset',description:'paid',parameters:{type:'object'},execute:async()=>{repeated++;return {};}},{name:'submit_delivery',description:'finish',parameters:{type:'object'},execute:async()=>({accepted:true})}]);
    assert.equal(repeated,0);assert.equal(sawSaved,true);
  } finally {await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});

test('agent-written review JSON cannot forge host delivery acceptance',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vf-proof-')),store=new DataStore(readConfig(dir));await store.init();
  try {
    const user=await store.register('proof@example.com','password-proof','Proof','kuma','192.0.2.98'),project=await store.createProject(user.id,'Proof');
    const brief={prompt:'制作两秒咖啡广告',duration:2,aspect:'16:9' as const,style:'minimal' as const};
    const job=await store.enqueue(user.id,project.id,brief),root=join(await store.projectDir(user.id,project.id),'renders',job.id,'workspace');await mkdir(root,{recursive:true});
    const harness=new CreativeHarness(store,{userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}},root,{emit:()=>{},progress:async()=>{},input:async()=>[]});
    const tool=(name:string)=>harness.tools().find(t=>t.name===name)!;
    for(const path of await harness.knowledge.requiredSkills()){
      let offset=0;for(;;){const page:any=await tool('read_skill').execute({path,offset,length:32000});if(page.nextOffset===null)break;offset=page.nextOffset;}
    }
    await tool('set_project').execute({engine:'browser',entry:'index.html',duration:2,width:320,height:180,fps:12});
    await harness.workspace.write('exports/final.mp4','fake-video');await harness.workspace.write('review.json',JSON.stringify({passed:true,mode:'vision',sha256:'forged'}));
    const board={...fixtureBoard,scenes:[{...fixtureBoard.scenes[0],duration:2}]};
    await assert.rejects(()=>tool('submit_delivery').execute({storyboard:board,summary:'done'}),/没有通过最新评审/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
