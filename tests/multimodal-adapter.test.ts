import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {MultimodalAdapter,multimodalMessages} from '../plugins/cocode-director/multimodal-adapter.js';
import {readConfig} from '../shared/config.js';

test('tool-returned images reach the API as real user image blocks after tool results',()=>{
  const wire=multimodalMessages({messages:[{role:'user',content:[{type:'tool-result',toolCallId:'call1',content:[{type:'text',text:'检查结果'},{type:'image',mediaType:'image/png',data:'YWJj'}]}]}]} as any);
  assert.equal(wire[0].role,'tool');assert.equal(wire[1].role,'user');assert.equal(wire[1].content[1].image_url.url,'data:image/png;base64,YWJj');
});
test('multimodal streaming carries text, tools and disjoint usage without dropping image evidence',async()=>{
  let request:any;
  const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;request=JSON.parse(raw);res.setHeader('Content-Type','text/event-stream');
    for(const data of [{choices:[{delta:{content:'看到了图片'}}]},{choices:[{delta:{tool_calls:[{index:0,id:'c1',function:{name:'finish_response',arguments:'{"summary":"完成"}'}}]},finish_reason:'tool_calls'}]},{choices:[],usage:{prompt_tokens:20,completion_tokens:10,prompt_tokens_details:{cached_tokens:5}}}])res.write('data: '+JSON.stringify(data)+'\n\n');res.end('data: [DONE]\n\n');
  }).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try{
    const config={...readConfig(),model:'qwen3.8-flash',apiKey:'test-only',baseUrl:'http://127.0.0.1:'+(server.address() as any).port};
    const adapter=new MultimodalAdapter({options:()=>({} as any),resolveApiKey:async()=>config.apiKey,resolveUserId:()=>('test' as any)},config);
    const chunks=[];for await(const c of adapter.stream({model:config.model,messages:[{role:'user',content:[{type:'image',mediaType:'image/png',data:'YWJj'}]}]} as any))chunks.push(c);
    assert.equal(request.messages[0].content[1].type,'image_url');assert.equal(request.enable_thinking,config.thinking);
    assert.ok(chunks.some(c=>c.type==='text-delta'));assert.ok(chunks.some(c=>c.type==='tool-call-delta'));assert.deepEqual(chunks.find(c=>c.type==='usage'),{type:'usage',usage:{inputTokens:15,outputTokens:10,cacheReadTokens:5}});
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
