import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {renderFingerprint,cachedFileValid} from '../plugins/cocode-director/render-cache.js';
import {exportDimensions} from '../shared/export-settings.js';
import {createHash} from 'node:crypto';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {CreativeHarness} from '../plugins/cocode-director/harness.js';
import {readConfig} from '../shared/config.js';
import {mkdir} from 'node:fs/promises';
import {readAllSkills} from './skill-fixtures.js';

test('export fingerprint preserves picture cache for sound and documentation changes, invalidates on pixels or settings',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vf-export-'));const w=new CreativeWorkspace(root);
 try{
  await w.write('index.html','<canvas></canvas>');await w.write('src/main.js','render(t)');
  await w.write('runtime/library.js','library-v1');await w.write('audio-plan.json','{"music":"one.wav"}');
  const spec={width:1920,height:1080,fps:30};
  const picture=await renderFingerprint(w,spec,true),final=await renderFingerprint(w,spec);
  await w.write('audio-plan.json','{"music":"two.wav"}');
  assert.equal(await renderFingerprint(w,spec,true),picture);assert.notEqual(await renderFingerprint(w,spec),final);
  await w.write('工程说明.md','new documentation');await w.write('review.json','{"passed":true}');await w.write('exports/final.mp4','output');
  assert.equal(await renderFingerprint(w,spec,true),picture);
  assert.equal(await renderFingerprint(new CreativeWorkspace(root),spec,true),picture,'survives a fresh workspace instance');
  assert.notEqual(await renderFingerprint(w,{...spec,width:3840},true),picture);
  await w.write('runtime/library.js','library-v2');assert.notEqual(await renderFingerprint(w,spec,true),picture);
  await w.write('runtime/library.js','library-v1');await w.write('src/main.js','fetch("audio-plan.json");render(t)');
  const reactive=await renderFingerprint(w,spec,true);await w.write('audio-plan.json','different');assert.notEqual(await renderFingerprint(w,spec,true),reactive);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('cached exports reject missing, empty and altered files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vf-cache-')),w=new CreativeWorkspace(root);
 try{
  const hash=createHash('sha256').update('video').digest('hex'),file=join(root,'saved.mp4');
  assert.equal(await cachedFileValid(file,hash),false);await w.write('saved.mp4','video');assert.equal(await cachedFileValid(file,hash),true);
  await w.write('saved.mp4','altered');assert.equal(await cachedFileValid(file,hash),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('resolution maps preserve aspect ratio and 1080p default target',()=>{
 assert.deepEqual(exportDimensions('16:9','1080p'),[1920,1080]);assert.deepEqual(exportDimensions('9:16','4k'),[2160,3840]);assert.deepEqual(exportDimensions('1:1','720p'),[720,720]);
});

test('unchanged export is reused after a fresh harness instance without rendering again',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vf-reuse-')),store=new DataStore(readConfig(dir));await store.init();
 try{
  const user=await store.register('reuse@example.com','password-reuse','Reuse','kuma','192.0.2.102'),project=await store.createProject(user.id,'Reuse');
  const job=await store.enqueue(user.id,project.id,{prompt:'视频',duration:1,aspect:'16:9',style:'minimal'});
  const root=join(await store.projectDir(user.id,project.id),'renders',job.id,'workspace');await mkdir(root,{recursive:true});
  const scope={userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}};
  let renders=0;
  const make=()=>{const h=new CreativeHarness(store,scope,root,{emit:()=>{},progress:async()=>{},input:async()=>[]});h.runtime.prepareLibraries=async()=>{};h.runtime.render=async()=>{renders++;await h.workspace.write('exports/final.mp4','fixture video');return {path:'exports/final.mp4',duration:1,engine:'browser'};};return h;};
  const first=make();await first.workspace.write('index.html','<canvas/>');
  await readAllSkills(first);
  await first.tools().find(t=>t.name==='set_project')!.execute({engine:'browser',entry:'index.html',duration:1,width:320,height:180,fps:12});
  await first.tools().find(t=>t.name==='export_video')!.execute({});assert.equal(renders,1);
  const second=make();await readAllSkills(second);await second.tools().find(t=>t.name==='set_project')!.execute({engine:'browser',entry:'index.html',duration:1,width:320,height:180,fps:12});
  await second.workspace.write('工程说明.md','changed');await second.tools().find(t=>t.name==='export_video')!.execute({});assert.equal(renders,1);
  await second.workspace.write('index.html','<canvas>changed</canvas>');await second.tools().find(t=>t.name==='export_video')!.execute({});assert.equal(renders,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('passed review blocks unsolicited edits but a new user request permits changes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vf-no-rework-')),store=new DataStore(readConfig(dir));await store.init();
 try{
  const user=await store.register('rework@example.com','password-rework','Rework','kuma','192.0.2.103'),project=await store.createProject(user.id,'Rework');
  const job=await store.enqueue(user.id,project.id,{prompt:'视频',duration:1,aspect:'16:9',style:'minimal'});
  const root=join(await store.projectDir(user.id,project.id),'renders',job.id,'workspace');await mkdir(root,{recursive:true});
  const h=new CreativeHarness(store,{userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}},root,{emit:()=>{},progress:async()=>{},input:async()=>[]});
  const latest=(await store.loadProject(user.id,project.id)).messages.filter(m=>m.role==='user').at(-1);
  await readAllSkills(h);
  (h as any).reviewProof={passed:true,lastUser:latest?.id??''};
  await assert.rejects(()=>h.tools().find(t=>t.name==='write_file')!.execute({path:'src/main.js',content:'unasked polish'}),/请直接 submit_delivery/);
  await store.updateProject(user.id,project.id,p=>p.messages.push({id:'new-request',role:'user',text:'请修改',createdAt:new Date().toISOString()}));
  await h.tools().find(t=>t.name==='write_file')!.execute({path:'src/main.js',content:'requested change'});
  assert.equal((await h.workspace.read('src/main.js')).content,'requested change');
 }finally{await rm(dir,{recursive:true,force:true});}
});
