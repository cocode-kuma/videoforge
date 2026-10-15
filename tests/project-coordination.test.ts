import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readConfig} from '../shared/config.js';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {CreativeHarness} from '../plugins/cocode-director/harness.js';
import {Director} from '../plugins/cocode-director/index.js';

test('all skills require complete sequential reads before creation and AI configuration reaches the public job',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vf-skills-')),config=readConfig();config.dataRoot=dir;
  const store=new DataStore(config);await store.init();
  try{
    const user=await store.register('skills@example.com','password-skills','Skills','kuma','192.0.2.111'),project=await store.createProject(user.id,'Skills');
    const job=await store.enqueue(user.id,project.id,{prompt:'制作动效',duration:1,aspect:'16:9',style:'minimal'});
    const root=join(await store.projectDir(user.id,project.id),'renders',job.id,'workspace');await mkdir(root,{recursive:true});
    let patch:any;
    const harness=new CreativeHarness(store,{userId:user.id,projectId:project.id,jobId:job.id,signal:new AbortController().signal,tokenUsage:{calls:0,promptTokens:0,completionTokens:0,totalTokens:0}},root,{emit:()=>{},input:async()=>[],progress:async p=>{patch=p;}});
    const tools=harness.tools(),call=(name:string,args:unknown)=>tools.find(t=>t.name===name)!.execute(args);
    await assert.rejects(()=>call('set_project',{engine:'remotion',entry:'src/index.tsx',width:1920,height:1080,fps:30,duration:1}),/完整阅读全部技能/);
    const catalog:any=await call('list_skills',{});
    assert.ok(catalog.skills.length>=40);
    const first=catalog.skills[0].path;
    const tail=await harness.knowledge.read(first,0,1);
    await call('read_skill',{path:first,offset:Math.max(1,tail.total-1),length:32000});
    assert.equal((await call('list_skills',{}) as any).skills.find((s:any)=>s.path===first).complete,false);
    for(const {path} of catalog.skills){
      let offset=0;for(;;){const result:any=await call('read_skill',{path,offset,length:32000});if(result.nextOffset===null)break;offset=result.nextOffset;}
    }
    assert.ok((await call('list_skills',{}) as any).skills.every((s:any)=>s.complete));
    await call('set_project',{engine:'remotion',entry:'src/index.tsx',width:1920,height:1080,fps:30,duration:1});
    assert.equal(patch.projectConfiguration.engine,'remotion');
    await call('write_file',{path:'src/index.tsx',content:'code'});
    await call('set_project',{engine:'hyperframes',entry:'index.html',width:1920,height:1080,fps:30,duration:1});
    await call('write_file',{path:'index.html',content:'html'});
    await harness.workspace.write('skills/new/SKILL.md','# 新技能\n制作前核对主体。');
    await assert.rejects(()=>call('write_file',{path:'index.html',content:'changed'}),/project\/new\/SKILL.md/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('settings persist and notify the running agent without launching a second render',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vf-settings-')),store=new DataStore(readConfig(dir));await store.init();
  try{
    const user=await store.register('settings@example.com','password-settings','Settings','kuma','192.0.2.112'),project=await store.createProject(user.id,'Settings');
    const job=await store.enqueue(user.id,project.id,{prompt:'制作动效',duration:30,aspect:'16:9',style:'minimal',exportResolution:'1080p'});
    const director=Object.create(Director.prototype);director.store=store;director.events={emit:()=>{}};
    const updated=await director.configure(user.id,project.id,{engine:'remotion'});
    assert.equal(updated.brief.engine,'remotion');assert.equal(updated.brief.exportResolution,'1080p');
    assert.equal(updated.renders.length,1);assert.equal(updated.messages.at(-1).jobId,job.id);assert.match(updated.messages.at(-1).text,/修改工程配置/);
    const unchanged=await director.configure(user.id,project.id,{engine:'remotion'});assert.equal(unchanged.messages.length,updated.messages.length);
    const original=await director.configure(user.id,project.id,{exportResolution:null});assert.equal(original.brief.exportResolution,undefined);
  }finally{await rm(dir,{recursive:true,force:true});}
});
