import {readFile,writeFile,cp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {CreativeRuntime,cleanExecutionEnv} from '../plugins/cocode-director/creative-runtime.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {readConfig} from '../shared/config.js';
import {runProcess} from '../plugins/cocode-director/process.js';
import {mixAudio} from '../plugins/cocode-director/audio.js';
const root=resolve('.test-artifacts/export-profile/workspace'),config=readConfig(),signal=new AbortController().signal;
const spec=JSON.parse(await readFile(join(root,'project.json'),'utf8'));
let equal=true,checked=0;
const runtime=new CreativeRuntime(config,new CreativeWorkspace(root),signal);
const profile=JSON.parse(await readFile(join(root,'.cache/browser-profile.json'),'utf8'));
const result=await runtime.render(spec,'exports/concurrency-full-validation.mp4',{benchmark:{...profile.strategy,onFrame:async(index:number,png:Buffer)=>{
 const frame=index-Math.round(7.5*spec.fps);
 if(frame>=0&&frame<8){const actual=await sharp(png).ensureAlpha().raw().toBuffer(),expected=await sharp(await readFile(join(root,'../frame-'+frame+'.png'))).ensureAlpha().raw().toBuffer();if(!actual.equals(expected))equal=false;checked++;}
}}});
await cp(join(root,'exports/concurrency-full-validation.mp4'),join(root,'final.mp4'));
if(process.argv[2]){
 const source=resolve(process.argv[2]);
 await cp(join(source,'audio'),join(root,'audio'),{recursive:true});
 const plan=JSON.parse(await readFile(join(source,'audio-plan.json'),'utf8'));
 await mixAudio(root,plan,spec.duration,config,signal);
}
const probe=JSON.parse(await runProcess(config.ffprobe,['-v','error','-count_frames','-show_entries','format=duration:stream=codec_type,width,height,nb_read_frames','-of','json',join(root,'final.mp4')],root,signal,120000,undefined,cleanExecutionEnv()));
const video=probe.streams.find((s:any)=>s.codec_type==='video');
if(!equal||checked!==8||Number(video?.nb_read_frames)!==Math.round(spec.duration*spec.fps)||video.width!==spec.width||video.height!==spec.height||Math.abs(Number(probe.format.duration)-spec.duration)>.05)throw Error('Full export validation failed');
await writeFile(join(root,'../concurrency-full-validation.json'),JSON.stringify({result,equal,checked,probe},null,2));
console.log(JSON.stringify({result,equal,checked,probe}));
