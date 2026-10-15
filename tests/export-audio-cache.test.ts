import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readConfig} from '../shared/config.js';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {CreativeHarness} from '../plugins/cocode-director/harness.js';
import {runProcess} from '../plugins/cocode-director/process.js';
import {cleanExecutionEnv} from '../plugins/cocode-director/creative-runtime.js';
import {readAllSkills} from './skill-fixtures.js';

test('changing narration timing reuses picture while exporting valid audio and video',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vf-audio-cache-')),runtime=readConfig();
 const store=new DataStore({...runtime,dataRoot:join(dir,'projects'),logsRoot:join(dir,'logs')});await store.init();
 const signal=new AbortController().signal;let captures=0;const updates:any[]=[];
 try{
  const user=await store.register('audio-cache@example.com','password-audio','Audio','kuma','192.0.2.104'),project=await store.createProject(user.id,'Audio');
  const job=await store.enqueue(user.id,project.id,{prompt:'带配音视频',duration:1,aspect:'16:9',style:'minimal',narrationEnabled:true});
  const root=join(await store.projectDir(user.id,project.id),'renders',job.id,'workspace');await mkdir(join(root,'audio'),{recursive:true});
  const h=new CreativeHarness(store,{userId:user.id,projectId:project.id,jobId:job.id,signal,tokenUsage:{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}},root,{emit:()=>{},progress:async p=>{updates.push(p);},input:async()=>[]});
  h.runtime.prepareLibraries=async()=>{};
  await readAllSkills(h);
  h.runtime.render=async()=>{captures++;await mkdir(join(root,'exports'),{recursive:true});await runProcess(runtime.ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:r=12:d=1','-c:v','libx264','-pix_fmt','yuv420p',join(root,'exports/final.mp4')],root,signal,30000,undefined,cleanExecutionEnv());return {path:'exports/final.mp4',duration:1,engine:'browser'};};
  await h.workspace.write('index.html','<canvas/>');await h.tools().find(t=>t.name==='set_project')!.execute({engine:'browser',entry:'index.html',duration:1,width:320,height:180,fps:12});
  await runProcess(runtime.ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=0.4',join(root,'audio/voice.wav')],root,signal,30000,undefined,cleanExecutionEnv());
  const plan={cues:[{file:'audio/voice.wav',sceneId:'one',start:0,duration:.4}]};await h.workspace.write('audio-plan.json',JSON.stringify(plan));
  await h.tools().find(t=>t.name==='export_video')!.execute({});
  plan.cues[0].start=.2;await h.workspace.write('audio-plan.json',JSON.stringify(plan));
  await h.tools().find(t=>t.name==='export_video')!.execute({});
  assert.equal(captures,1);assert.ok(updates.some(p=>p.exportCache?.image&&!p.exportCache.final));
  const probe=JSON.parse(await runProcess(runtime.ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',join(root,'exports/final.mp4')],root,signal,30000));
  assert.ok(probe.streams.some((s:any)=>s.codec_type==='audio'));assert.ok(probe.streams.some((s:any)=>s.codec_type==='video'&&s.width===320&&s.height===180));assert.ok(Math.abs(Number(probe.format.duration)-1)<.05);
 }finally{await rm(dir,{recursive:true,force:true});}
});

