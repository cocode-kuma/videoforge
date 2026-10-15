import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readConfig} from '../shared/config.js';
import {synthesizeVoice,toSrt} from '../plugins/cocode-director/voice.js';
import {synthesizeMusic} from '../plugins/cocode-director/music.js';

test('ElevenLabs and MiniMax adapters decode actual audio, retain service timing, cache and reject provider errors',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vf-voice-'));await mkdir(join(root,'audio'),{recursive:true});
  const bytes=synthesizeMusic({bpm:120,notes:[{beat:0,length:1,midi:60,gain:.1,voice:'bell'}]},1);
  let elevenCalls=0,miniCalls=0;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);res.setHeader('Content-Type','application/json');
    if(req.url?.endsWith('/with-timestamps')){
      elevenCalls++;assert.equal(req.headers['xi-api-key'],'fixture-key');assert.equal(body.text,'你好。');
      res.end(JSON.stringify({audio_base64:bytes.toString('base64'),normalized_alignment:{characters:['你','好','。'],character_start_times_seconds:[.1,.3,.5],character_end_times_seconds:[.3,.5,.7]}}));
    }else{
      miniCalls++;assert.equal(req.headers.authorization,'Bearer fixture-key');assert.equal(body.subtitle_enable,true);assert.equal(body.output_format,'hex');
      res.end(JSON.stringify(body.text==='error'?{base_resp:{status_code:1001}}:{base_resp:{status_code:0},data:{audio:bytes.toString('hex')}}));
    }
  }).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const config={...readConfig(),elevenLabsApiKey:'fixture-key',elevenLabsVoice:'fixture-voice',elevenLabsBaseUrl:base,miniMaxApiKey:'fixture-key',miniMaxBaseUrl:base};
  const signal=new AbortController().signal;
  try {
    const a=await synthesizeVoice(config,root,signal,{text:'你好。',provider:'elevenlabs',output:'audio/eleven.wav'});
    assert.ok(Math.abs(a.duration-1)<.01);assert.equal(a.timing,'provider');assert.match(await readFile(join(root,a.subtitles!),'utf8'),/00:00:00,100 --> 00:00:00,700/);
    await synthesizeVoice(config,root,signal,{text:'你好。',provider:'elevenlabs',output:'audio/cached.wav'});assert.equal(elevenCalls,1);
    const b=await synthesizeVoice(config,root,signal,{text:'你好。',provider:'minimax',output:'audio/mini.wav'});
    assert.ok(Math.abs(b.duration-1)<.01);assert.equal(b.timing,'unavailable');assert.equal(b.subtitles,undefined);
    await assert.rejects(()=>synthesizeVoice(config,root,signal,{text:'error',provider:'minimax',output:'audio/error.wav'}),/有效音频/);assert.equal(miniCalls,2);
    assert.equal(toSrt([{text:'invalid',start:NaN,end:1}]),'');
  }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
