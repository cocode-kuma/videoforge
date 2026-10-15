import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {generateAsset} from '../plugins/cocode-director/media.js';
import {prepareAudio,fitNarration} from '../plugins/cocode-director/audio.js';
import {synthesizeMusic} from '../plugins/cocode-director/music.js';
import {readConfig} from '../shared/config.js';
import {creationBoard} from './creation-fixtures.js';

test('configured media gateway freezes a real image with content hash and rejects missing providers',async()=>{
  const image=await sharp({create:{width:100,height:60,channels:3,background:'#123456'}}).png().toBuffer();
  let request:any;
  const server=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer media-test');let raw='';for await(const chunk of req)raw+=chunk;request=JSON.parse(raw);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'completed',b64_json:image.toString('base64')}));
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const dir=await mkdtemp(join(tmpdir(),'vf-media-'));
  const config={...readConfig(),mediaApiUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,mediaApiKey:'media-test'};
  try {
    const asset=await generateAsset(config,dir,new AbortController().signal,{kind:'image',prompt:'原创青绿色星球与清晰轨道构图',purpose:'星球主体'});
    assert.equal(request.kind,'image');assert.equal(asset.kind,'image');assert.equal(asset.sha256.length,64);
    assert.equal((await readFile(join(dir,asset.file))).toString('ascii',1,4),'PNG');
    await assert.rejects(generateAsset({...config,mediaApiUrl:''},dir,new AbortController().signal,{kind:'video',prompt:'沿山水空间持续前进的原创短影像',purpose:'空间运动'}),/尚未配置/);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});

test('narration gateway creates measured audio and reuses unchanged voice during repairs',async()=>{
  const wav=synthesizeMusic({bpm:120,notes:[{beat:0,length:4,midi:60,gain:.2,voice:'soft'}]},2);
  let calls=0;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    assert.equal(JSON.parse(raw).text,'让想象成为作品');calls++;
    res.setHeader('Content-Type','audio/wav');res.end(wav);
  }).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const dir=await mkdtemp(join(tmpdir(),'vf-voice-'));
  const config={...readConfig(),ttsApiUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,ttsApiKey:''};
  const board=structuredClone(creationBoard);board.scenes=board.scenes.slice(0,1);board.scenes[0].duration=5;board.scenes[0].narration='让想象成为作品';
  const brief={prompt:'测试真实旁白音轨',duration:5,aspect:'16:9' as const,style:'minimal' as const,narrationEnabled:true,music:'none' as const};
  try {
    const plan=await prepareAudio(dir,brief,board,[],config,new AbortController().signal);
    assert.ok(Math.abs(plan.cues[0].duration-2)<.01);
    fitNarration(board,plan,5,60);
    const repeated=await prepareAudio(dir,brief,board,[],config,new AbortController().signal);
    assert.equal(calls,1);assert.equal(repeated.cues[0].duration,plan.cues[0].duration);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});

test('richer music voices remain deterministic and produce audible WAV samples',()=>{
  const notes=(['bass','pad','bell','kick','snare','hat'] as const).map((voice,i)=>({voice,beat:i,length:1,midi:60,gain:.1}));
  const score={bpm:120,notes};const first=synthesizeMusic(score,4);
  assert.deepEqual(first,synthesizeMusic(score,4));
  assert.ok(first.subarray(44).some(value=>value!==0));
});
