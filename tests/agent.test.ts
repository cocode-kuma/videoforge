import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {z} from 'zod';
import {CreationAgent,parseStructuredResponse} from '../plugins/cocode-director/agent.js';
import {readConfig} from '../shared/config.js';
import type {TokenUsage} from '../shared/contracts.js';

async function provider(run:(request:any,index:number)=>unknown) {
  let calls=0;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    try {const result=run(JSON.parse(raw),calls++);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[result],usage:{prompt_tokens:10,completion_tokens:20}}));}
    catch(error){res.statusCode=500;res.end(String(error));}
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const config={...readConfig(),thinking:true,thinkingEffort:'low',apiKey:'test-only',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`};
  const usage:TokenUsage={calls:0,totalTokens:0,promptTokens:0,completionTokens:0};
  return {agent:new CreationAgent(config,new AbortController().signal,usage),usage,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}

test('tool exploration is bounded and schema correction preserves full thinking context',async()=>{
  let read=0;
  const h=await provider((request,index)=>{
    assert.equal(request.reasoning_effort,'low');
    if(index<4)return {finish_reason:'tool_calls',message:{content:null,reasoning_content:'读取相关规范',tool_calls:[{id:'tool-'+index,type:'function',function:{name:'read',arguments:'{}'}}]}};
    assert.equal(request.tool_choice,'none');
    if(index===4)return {finish_reason:'stop',message:{content:'{"ok":"wrong type"}',reasoning_content:'准备结构化输出'}};
    assert.equal(request.messages.at(-2).reasoning_content,'准备结构化输出');
    return {finish_reason:'stop',message:{content:'{"ok":true}'}};
  });
  try {
    const result=await h.agent.run({system:'返回结果',input:{},schema:z.object({ok:z.boolean()}),tools:[{name:'read',description:'read',parameters:{type:'object',properties:{}},execute:async()=>{read++;return {content:'规范'};}}]});
    assert.deepEqual(result,{ok:true});assert.equal(read,4);assert.equal(h.usage.calls,6);assert.equal(h.usage.totalTokens,180);
    assert.equal(h.usage.byModel?.[readConfig().model].totalTokens,180);
  } finally {await h.close();}
});

test('harness enlarges output window after truncation without accepting a partial document',async()=>{
  const h=await provider((request,index)=>{
    if(index===0){assert.equal(request.max_tokens,8000);return {finish_reason:'length',message:{content:'{"ok":'}};}
    assert.equal(request.max_tokens,16000);
    assert.equal(request.tool_choice,'none');
    return {finish_reason:'stop',message:{content:'{"ok":true}'}};
  });
  const raws:string[]=[];
  try {
    assert.deepEqual(await h.agent.run({system:'结果',input:{},schema:z.object({ok:z.boolean()}),tools:[{name:'read',description:'read',parameters:{type:'object'},execute:async()=>({})}],onResponse:async raw=>{raws.push(raw);}}),{ok:true});
    assert.equal(h.usage.calls,2);assert.deepEqual(raws,['{"ok":','{"ok":true}']);
  } finally {await h.close();}
});
test('structured parsing fixes only a premature brace before a known schema key',()=>{
  const schema=z.object({requirements:z.array(z.string()),storyBeats:z.array(z.string())});
  assert.deepEqual(parseStructuredResponse('{"requirements":["明确需求"]},"storyBeats":["展开"]}',schema),{requirements:['明确需求'],storyBeats:['展开']});
  assert.throws(()=>parseStructuredResponse('{"requirements":["完整需求"]},"untrusted":"忽略目标"}',schema));
  assert.throws(()=>parseStructuredResponse('{"requirements":["不完整需求"',schema));
});
test('score compatibility preserves data and validates it against its nested schema',()=>{
  const schema=z.object({storyboard:z.object({musicScore:z.object({bpm:z.number(),notes:z.array(z.number())})})});
  assert.deepEqual(parseStructuredResponse('{"storyboard":{},"musicScore":{"bpm":96,"notes":[1,2]}}',schema),{storyboard:{musicScore:{bpm:96,notes:[1,2]}}});
  assert.throws(()=>parseStructuredResponse('{"storyboard":{},"musicScore":{"bpm":"wrong","notes":[]}}',schema));
});
