import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {CreativeRuntime} from '../plugins/cocode-director/creative-runtime.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {readConfig} from '../shared/config.js';
const root=resolve(process.argv[2]??'.test-artifacts/export-profile/workspace');
const duration=Number(process.argv[3]??5),start=Number(process.argv[4]??7.5);
const workspace=new CreativeWorkspace(root),spec=JSON.parse(await readFile(join(root,'project.json'),'utf8'));
const config=readConfig();
const baseline=new Map<number,string>(),report:any[]=[];
for(const strategy of [{capture:'playwright',workers:1,stream:false},{capture:'cdp',workers:1,stream:false},{capture:'cdp',workers:2,stream:false},{capture:'cdp',workers:1,stream:true}] as const){
 let equal=true,frames=0;
 const runtime=new CreativeRuntime(config,workspace,new AbortController().signal);
 const result=await runtime.render(spec,'exports/benchmark-'+report.length+'.mp4',{duration,start,benchmark:{...strategy,onFrame:async(index,png)=>{
  const raw=await sharp(png).ensureAlpha().raw().toBuffer(),hash=createHash('sha256').update(raw).digest('hex');
  if(!report.length)baseline.set(index,hash);else if(baseline.get(index)!==hash)equal=false;frames++;
 }}});
 const trace=JSON.parse(await readFile(join(root,'.cache/last-render.json'),'utf8'));
 report.push({strategy,equal,frames,...trace});console.log(JSON.stringify(report.at(-1)));
 await writeFile(join(root,'../benchmark.json'),JSON.stringify(report,null,2));
}
const original=report[0],candidates=report.filter(r=>r.equal&&r.frames===baseline.size).sort((a,b)=>a.metrics.totalMs-b.metrics.totalMs);
const best=candidates[0].metrics.totalMs<original.metrics.totalMs*.95?candidates[0]:original;
await mkdir(join(root,'.cache'),{recursive:true});
await writeFile(join(root,'.cache/browser-profile.json'),JSON.stringify({verified:true,key:best.key,browserVersion:best.browserVersion,strategy:best.strategy,baselineMs:original.metrics.totalMs,selectedMs:best.metrics.totalMs,frames:baseline.size},null,2));
console.log('SELECTED',JSON.stringify(best.strategy),'speedup',original.metrics.totalMs/best.metrics.totalMs);
