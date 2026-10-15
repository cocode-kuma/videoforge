import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {readConfig} from '../shared/config.js';
import {withRenderSlot} from '../plugins/cocode-director/render-slots.js';

test('one user can run independent conversations, with duplicate work rejected only in its own conversation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vf-chats-'));
  try{
    const store=new DataStore({...readConfig(root),initialCredits:100,inviteFreeVideosPerIp:5});await store.init();
    const user=await store.register('chats@example.com','password-12345','Chats','kuma','192.0.2.109');
    const a=await store.createProject(user.id,'Conversation A'),b=await store.createProject(user.id,'Conversation B');
    const brief={prompt:'制作有明确主体的品牌片',duration:15 as const,aspect:'16:9' as const,style:'minimal' as const};
    const first=await store.enqueue(user.id,a.id,brief),second=await store.enqueue(user.id,b.id,brief);
    assert.notEqual(first.id,second.id);
    await assert.rejects(()=>store.enqueue(user.id,a.id,brief),/当前对话正在执行/);
    assert.equal((await store.loadProject(user.id,b.id)).renders[0].status,'queued');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('render capacity queues heavy work without blocking other conversations and canceled waiting work never runs',async()=>{
  const controller=new AbortController(),waiting=new AbortController(),third=new AbortController();let release!:()=>void,runs=0;
  const active=withRenderSlot('test-pool',1,controller.signal,()=>new Promise<void>(resolve=>{release=resolve;}));
  const canceled=withRenderSlot('test-pool',1,waiting.signal,async()=>{runs+=100;});
  const next=withRenderSlot('test-pool',1,third.signal,async()=>{runs++;});
  waiting.abort(new Error('stopped'));await assert.rejects(canceled,/stopped/);assert.equal(runs,0);
  release();await Promise.all([active,next]);assert.equal(runs,1);
});
