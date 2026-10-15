import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readConfig} from '../shared/config.js';
import {briefSchema} from '../shared/contracts.js';
import {polishPrompt} from '../plugins/cocode-director/prompt-polish.js';

test('separate AI polishing reads tutorial, proposes automatic specs, preserves manual specs and accounts usage',async()=>{
  const requests:any[]=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);requests.push(request);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({prompt:'制作手机端缓存科普，保留 https://example.com 和 assets/cache.svg 的真实素材。',specs:{duration:18,aspect:'9:16',exportResolution:'720p',exportFps:24,style:'minimal',engine:'browser'}})},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:50,total_tokens:250}}));
  }).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  try {
    const config={...readConfig(),baseUrl:'http://127.0.0.1:'+(server.address() as {port:number}).port,apiKey:'test-only'};
    const brief=briefSchema.parse({prompt:'做手机端缓存科普 https://example.com assets/cache.svg',specMode:'auto'});
    const auto=await polishPrompt(config,brief,new AbortController().signal);
    assert.equal(auto.brief.duration,18);assert.equal(auto.brief.aspect,'9:16');assert.equal(auto.brief.exportFps,24);assert.equal(auto.usage.totalTokens,250);
    assert.ok(auto.sources.some(s=>s.path==='creative/tutorial/video-creation.md'));
    const input=JSON.parse(requests[0].messages[1].content);
    assert.ok(input.references.some((s:any)=>s.content.includes('提示词技巧十')));
    assert.ok(auto.brief.prompt.includes('assets/cache.svg'));
    const manual=await polishPrompt(config,{...brief,specMode:'manual',duration:45,aspect:'16:9',exportResolution:'4k',exportFps:60},new AbortController().signal);
    assert.equal(manual.brief.duration,45);assert.equal(manual.brief.exportResolution,'4k');assert.equal(manual.brief.exportFps,60);
    assert.equal(requests.length,2);assert.ok(!requests[0].tools);
    await assert.rejects(()=>polishPrompt({...config,apiKey:''},brief,new AbortController().signal),/尚未配置/);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
