import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeHarness} from '../plugins/cocode-director/native-harness.js';
import {CreativeHarness} from '../plugins/cocode-director/harness.js';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {readConfig} from '../shared/config.js';
import {publicToolData} from '../shared/agent-activity.js';

test('native DSH conversation persists assistant/tool context across follow-up turns and ends without requiring a video',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vf-native-')),requests:any[]=[],messages:string[]=[],events:string[]=[],snapshots:{text:string;streaming:boolean}[]=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
    res.setHeader('Content-Type','text/event-stream');
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'流式开头 '},finish_reason:null}]})+'\n\n');
    await new Promise(resolve=>setTimeout(resolve,220));
    res.end('data: '+JSON.stringify({choices:[{delta:{content:'正常讨论回复 '+requests.length,reasoning_content:'private internal reasoning',tool_calls:[{index:0,id:'call-'+requests.length,type:'function',function:{name:'finish_response',arguments:'{"summary":"讨论已完成"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\ndata: [DONE]\n\n');
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try{
    const config={...readConfig(),apiKey:'test-only',baseUrl:'http://127.0.0.1:'+(server.address() as any).port};
    const usage={calls:0,promptTokens:0,completionTokens:0,totalTokens:0};
    const hooks={message:async(_id:string,text:string,streaming=false)=>{messages.push(text);snapshots.push({text,streaming});},input:async()=>[],checkpoint:async()=>{},state:async()=>({}),tool:async()=>{},event:async(_id:string,type:string)=>{events.push(type);}};
    const tools=[{name:'finish_response',description:'结束讨论回复',parameters:{type:'object',properties:{summary:{type:'string'}},required:['summary']},execute:async()=>({accepted:true})}];
    await new NativeHarness(config,new AbortController().signal,usage,join(dir,'.harness'),hooks).run('讨论任务',{prompt:'先讨论构图'},tools);
    await new NativeHarness(config,new AbortController().signal,usage,join(dir,'.harness'),hooks).run('讨论任务',{prompt:'继续刚才讨论'},tools);
    assert.ok(snapshots.some(m=>m.streaming&&m.text==='流式开头 '));
    assert.ok(snapshots.some(m=>!m.streaming&&m.text==='流式开头 正常讨论回复 1'));
    assert.equal(requests.length,2);assert.match(JSON.stringify(requests[1].messages),/正常讨论回复 1/);
    assert.equal(messages.some(m=>m.includes('private internal reasoning')),false);assert.equal(usage.totalTokens,30);
    assert.ok(events.includes('turn/end'));assert.ok(events.includes('request/header'));
    const moved=join(dir,'new-workspace','.harness');await cp(join(dir,'.harness'),moved,{recursive:true});
    await new NativeHarness(config,new AbortController().signal,usage,moved,hooks).run('讨论任务',{prompt:'新工程继续讨论'},tools);
    assert.equal(requests.length,3);assert.match(JSON.stringify(requests[2].messages),/正常讨论回复 2/);assert.equal(usage.calls,3);
    for(const request of requests){
      const internal=request.messages.filter((m:any)=>m.role==='system').map((m:any)=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
      assert.match(internal,/VideoForge 内部创作准则 v1/);
      assert.match(internal,/把审美写成能实现、能观察的设计/);
      assert.match(internal,/动作、音乐、音效、旁白和字幕共用时间表/);
      assert.match(internal,/讨论任务正常讨论/);
      assert.equal(internal.split('【VideoForge 内部创作准则 v1').length-1,1);
    }
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});

test('question remains open until a real answer arrives, then answer persists with a newer revision',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vf-question-'));const store=new DataStore(readConfig(dir));await store.init();
  try{
    const user=await store.register('question@example.com','password-12345','Question','kuma','192.0.2.111'),project=await store.createProject(user.id,'Question');
    const job=await store.enqueue(user.id,project.id,{prompt:'讨论品牌短片如何制作',duration:15,aspect:'16:9',style:'minimal'});
    const root=join(await store.projectDir(user.id,project.id),'renders',job.id,'workspace');await mkdir(root,{recursive:true});let replies:string[]=[];
    const harness=new CreativeHarness(store,{userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}},root,{emit:()=>{},progress:async()=>{},input:async()=>replies.splice(0)});
    let finished=false;const answer=harness.tools().find(t=>t.name==='ask_user')!.execute({question:'偏向哪种视觉风格？',options:['极简','鲜艳']}).then(value=>{finished=true;return value;});
    await new Promise(resolve=>setTimeout(resolve,40));assert.equal(finished,false);
    assert.equal((await store.loadProject(user.id,project.id)).messages.at(-1)?.question?.status,'open');
    replies.push('极简');assert.deepEqual(await answer,{answer:'极简'});
    const message=(await store.loadProject(user.id,project.id)).messages.at(-1)!;assert.equal(message.question?.answer,'极简');assert.equal(message.revision,2);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('public execution records remove credentials and private replay reasoning while preserving operation data',()=>{
  assert.deepEqual(publicToolData({command:'node run.js',apiKey:'key-value',reasoning_content:'private',replayState:{reasoning:'private'},stdout:'a secret-value b'},['secret-value']),{command:'node run.js',apiKey:'[密钥已隐藏]',stdout:'a [密钥已隐藏] b'});
});

test('trusted native DSH MCP plugin exposes its tools to the agent and records the actual invocation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vf-mcp-'));let invoked=false,modelCalls=0;const toolsObserved:string[]=[];
  const mcp=createServer(async(req,res)=>{
    if(req.method!=='POST'){res.statusCode=405;res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);
    if(request.id===undefined){res.statusCode=202;res.end();return;}
    let result:unknown={};
    if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'test-assets',version:'1'}};
    if(request.method==='tools/list')result={tools:[{name:'ping',description:'测试插件工具',inputSchema:{type:'object',properties:{}}}]};
    if(request.method==='tools/call'){invoked=true;result={content:[{type:'text',text:'actual-mcp-result'}]};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>mcp.once('listening',resolve));
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);toolsObserved.push(...request.tools.map((t:any)=>t.function.name));
    const name=modelCalls++===0?'mcp__assets__ping':'finish_response';
    res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'操作插件',tool_calls:[{index:0,id:'mcp-call-'+modelCalls,type:'function',function:{name,arguments:'{}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\ndata: [DONE]\n\n');
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>provider.once('listening',resolve));
  try{
    const config={...readConfig(),apiKey:'test-only',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port,nativePlugins:[{name:'@deepseek-ai/dsh-mcp-client',config:{transport:'streamable-http',serverName:'assets',url:'http://127.0.0.1:'+(mcp.address() as any).port,failOnStartupError:true}}]};
    const outcomes:string[]=[];
    await new NativeHarness(config,new AbortController().signal,{calls:0,promptTokens:0,completionTokens:0,totalTokens:0},join(dir,'.harness'),{message:async()=>{},input:async()=>[],checkpoint:async()=>{},state:async()=>({}),tool:async(name,status)=>{outcomes.push(name+':'+status);}}).run('测试插件',{prompt:'调用插件'},[{name:'finish_response',description:'完成',parameters:{type:'object',properties:{}},execute:async()=>({accepted:true})}]);
    assert.equal(invoked,true);assert.ok(toolsObserved.includes('mcp__assets__ping'));assert.ok(outcomes.includes('mcp__assets__ping:done'));
  }finally{await new Promise<void>(resolve=>provider.close(()=>resolve()));await new Promise<void>(resolve=>mcp.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});

test('native loop requests a stale plan update before continuing and preserves the verified updated status',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vf-plan-'));let worked=false,reminded=false,updated=false;const requests:any[]=[];
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);requests.push(request);
    const name=requests.length===1?'work':requests.length===2?'set_plan':'finish_response';

    const args=name==='set_plan'?{steps:[{title:'检查画面',status:'done'}]}:{};
    res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'plan-call-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\ndata: [DONE]\n\n');
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>provider.once('listening',resolve));
  try{
    const config={...readConfig(),apiKey:'test-only',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port};
    const hooks={message:async()=>{},input:async()=>[],checkpoint:async()=>{},state:async()=>({}),tool:async()=>{},planReminder:()=>{if(worked&&!reminded){reminded=true;return 'plan-update-required: 根据已验证的画面检查更新 set_plan';}return undefined;}};
    const tools=[{name:'work',description:'检查画面',parameters:{type:'object'},execute:async()=>{worked=true;return {verified:true};}},
      {name:'set_plan',description:'更新计划',parameters:{type:'object',properties:{steps:{type:'array',items:{type:'object'}}}},execute:async(args:any)=>{assert.equal(worked,true);assert.equal(args.steps[0].status,'done');updated=true;return {plan:args.steps};}},
      {name:'finish_response',description:'结束',parameters:{type:'object'},execute:async()=>({accepted:true})}];
    await new NativeHarness(config,new AbortController().signal,{calls:0,promptTokens:0,completionTokens:0,totalTokens:0},join(dir,'.harness'),hooks).run('检查画面后更新计划',{},tools);
    assert.equal(updated,true);assert.equal(requests.length,3);assert.match(JSON.stringify(requests[1].messages),/plan-update-required/);
  }finally{await new Promise<void>(resolve=>provider.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
