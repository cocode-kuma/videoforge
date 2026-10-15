import {resolve,join} from 'node:path';
import {readFile,copyFile,writeFile} from 'node:fs/promises';
import {readConfig} from '../shared/config.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {CreativeRuntime,cleanExecutionEnv,type RenderSpec} from '../plugins/cocode-director/creative-runtime.js';
import {mixAudio,type AudioPlan} from '../plugins/cocode-director/audio.js';
import {parseCaptions,captionsAss} from '../plugins/cocode-director/captions.js';
import {runProcess} from '../plugins/cocode-director/process.js';

if(!process.argv[2])throw new Error('请提供已解压工程的绝对路径');
const root=resolve(process.argv[2]),workspace=new CreativeWorkspace(root),config=readConfig(),signal=new AbortController().signal;
const spec=JSON.parse((await workspace.read('project.json')).content) as RenderSpec;
const runtime=new CreativeRuntime(config,workspace,signal);await runtime.prepareLibraries();
await runtime.render(spec,'exports/final.mp4');
const audio=await workspace.read('audio-plan.json').then(r=>JSON.parse(r.content) as AudioPlan&{subtitles?:string}).catch(()=>({cues:[]} as AudioPlan&{subtitles?:string}));
await copyFile(await workspace.path('exports/final.mp4'),await workspace.path('final.mp4',true));
for(const cue of audio.cues)await workspace.path(cue.file);if(audio.music)await workspace.path(audio.music);
await mixAudio(root,audio,spec.duration,config,signal);
if(audio.subtitles){
  const cues=parseCaptions(await readFile(await workspace.path(audio.subtitles),'utf8'));
  await writeFile(await workspace.path('captions.ass',true),captionsAss(cues,spec.width,spec.height));
  await runProcess(config.ffmpeg,['-y','-hide_banner','-loglevel','error','-i',join(root,'final.mp4'),'-vf','ass=captions.ass','-c:v','libx264','-c:a','copy',join(root,'captioned.mp4')],root,signal,config.renderTimeout,undefined,cleanExecutionEnv());
  await copyFile(join(root,'captioned.mp4'),join(root,'final.mp4'));
}
await copyFile(join(root,'final.mp4'),join(root,'exports/final.mp4'));
console.log('工程已重新渲染：'+join(root,'exports/final.mp4'));
