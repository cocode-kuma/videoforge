import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {readConfig} from '../shared/config.js';
import {OfficialSsoClient} from '../shared/official-sso.js';
import {Director} from '../plugins/cocode-director/index.js';
import {createApp} from '../plugins/cocode-studio-ui/index.js';
test('SSO accepts the actual website nullable avatar and VIP flags',async()=>{
 const server=createServer((_req,res)=>res.end(JSON.stringify({ok:true,user:{id:1,email:'test@example.com',nickname:'Test',avatar:null,is_vip:true}})));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('address');
 try{const c=new OfficialSsoClient({officialSsoIssuer:'http://127.0.0.1:'+a.port,officialQuotaTimeout:1000} as never);const u=await c.userInfo('test');assert.equal(u.avatar,null);assert.equal(u.is_vip,true)}finally{await new Promise<void>(r=>server.close(()=>r()))}
});
test('official-only mode uses PHP endpoint, central prices and balances without invitation/local-credit bypass',async()=>{
 let balance=100,allowed=true,cost=12;const requests:{action:string;body:any}[]=[];
 const remote=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);const url=new URL(req.url!,'http://localhost');assert.equal(url.pathname,'/api/quota.php');const action=url.searchParams.get('action')!;requests.push({action,body});assert.equal(req.headers.authorization,'Bearer test-key');let data:any={externalUserId:'42',label:'官网用户',plan:'free',availableUnits:balance,status:'active',accessAllowed:allowed,videoCosts:{'15':cost,'30':24,other:48},chatCost:0};if(action==='reserve'){balance-=body.units;data={reservationId:'r-'+requests.length,externalUserId:'42',availableUnits:balance,reservedUnits:body.units}}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))});
 await new Promise<void>(r=>remote.listen(0,'127.0.0.1',r));const a=remote.address();if(!a||typeof a==='string')throw Error('address');const root=await mkdtemp(join(tmpdir(),'unified-official-'));
 const store=new DataStore({...readConfig(root),officialAccountsOnly:true,officialQuotaApiUrl:'http://127.0.0.1:'+a.port+'/api/quota.php',officialQuotaApiKey:'test-key',initialCredits:99999});await store.init();
 const director=new Director(store);const app=createApp(store,director).listen(0,'127.0.0.1');await new Promise<void>(r=>app.once('listening',r));const aa=app.address();if(!aa||typeof aa==='string')throw Error('address');const origin='http://127.0.0.1:'+aa.port;
 try{
  const user=await store.loginOfficial({id:'42',email:'official@example.com',nickname:'官网用户'});await store.connectOfficialIdentity(user.id);assert.equal((await store.quota(user.id)).internalAvailableUnits,0);
  const p=await store.createProject(user.id,'积分任务');const brief={prompt:'测试',duration:15 as const,aspect:'16:9' as const,style:'cinematic' as const};const job=await store.enqueue(user.id,p.id,brief);assert.equal(job.quotaUnits,12);assert.equal(requests.find(x=>x.action==='reserve')?.body.units,12);await store.commitQuota(user.id,p.id,job.id);assert.equal(requests.filter(x=>x.action==='consume').length,1);await store.commitQuota(user.id,p.id,job.id);assert.equal(requests.filter(x=>x.action==='consume').length,1);
  const other=await store.createProject(user.id,'新任务');cost=7;const next=await store.enqueue(user.id,other.id,brief);assert.equal(next.quotaUnits,7);await store.releaseQuota(user.id,other.id,next.id);assert.equal(requests.filter(x=>x.action==='release').length,1);
  const blocked=await store.createProject(user.id,'受限任务');allowed=false;await assert.rejects(store.enqueue(user.id,blocked.id,brief),/VIP/);allowed=true;balance=0;await assert.rejects(store.enqueue(user.id,blocked.id,brief),/不足/);
  const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:store.config.origin,'X-Cocode-Request':'studio'},body:JSON.stringify({email:'official@example.com',password:'password-123'})});assert.equal(r.status,403);
  const providers=await (await fetch(origin+'/api/auth/providers')).json();assert.equal(providers.officialOnly,true);
 }finally{await director.dispose();await new Promise<void>(r=>app.close(()=>r()));await new Promise<void>(r=>remote.close(()=>r()));await rm(root,{recursive:true,force:true})}
});
