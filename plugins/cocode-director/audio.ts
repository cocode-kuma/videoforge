import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError, type AssetRecord, type Brief, type Storyboard } from '../../shared/contracts.js';
import type { Config } from '../../shared/config.js';
import { runProcess } from './process.js';
import { hyperframesCli } from './master.js';
import { synthesizeMusic } from './music.js';
import { existsSync } from 'node:fs';

export type AudioCue = { sceneId: string; start: number; duration: number; text: string; file: string };
export type AudioPlan = { cues: AudioCue[]; music?: string };
export async function probeDuration(path: string, dir: string, config: Config, signal: AbortSignal) {
  const output = JSON.parse(await runProcess(config.ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',path],dir,signal,30000));
  const duration = Number(output.format?.duration);
  if (!output.streams?.some((s: {codec_type:string})=>s.codec_type==='audio') || !Number.isFinite(duration) || duration <= 0) throw new AppError(503,'声音文件没有有效音轨');
  return duration;
}
export async function prepareAudio(dir: string, brief: Brief, board: Storyboard, assets: AssetRecord[], config: Config, signal: AbortSignal): Promise<AudioPlan> {
  const audioDir = join(dir,'audio'); await mkdir(audioDir,{recursive:true});
  const plan: AudioPlan = { cues: [] };
  const previous=await readFile(join(dir,'audio-plan.json'),'utf8').then(raw=>JSON.parse(raw) as AudioPlan).catch(()=>null);
  let start = 0;
  for (const scene of board.scenes) {
    if (brief.narrationEnabled && scene.narration.trim()) {
      const textFile = join(audioDir,scene.id+'.txt'), path = join(audioDir,scene.id+'.wav');
      const cached=previous?.cues.find(cue=>cue.sceneId===scene.id&&cue.text===scene.narration&&existsSync(join(dir,cue.file)));
      if(cached) {plan.cues.push({...cached,start});start+=scene.duration;continue;}
      await writeFile(textFile,scene.narration);
      const model = join(config.root,'.runtime/tts/kokoro-v1.0.int8.onnx');
      const voices = join(config.root,'.runtime/tts/voices-v1.0.bin');
      const python = process.env.HYPERFRAMES_PYTHON ?? join(config.root,process.platform === 'win32' ? '.venv-tts/Scripts/python.exe' : '.venv-tts/bin/python');
      if (config.ttsApiUrl) {
        const response=await fetch(config.ttsApiUrl,{method:'POST',headers:{'Content-Type':'application/json',...(config.ttsApiKey?{Authorization:`Bearer ${config.ttsApiKey}`}:{})},
          body:JSON.stringify({text:scene.narration,voice:config.ttsVoice,format:'wav'}),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
        if(!response.ok)throw new AppError(503,`配音服务返回 ${response.status}`);
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length>10*1024*1024||bytes.toString('ascii',0,4)!=='RIFF')throw new AppError(503,'配音服务没有返回有效 WAV');
        await writeFile(path,bytes);
      } else if (existsSync(model) && existsSync(voices) && existsSync(python)) {
        const request = join(audioDir,scene.id+'-request.json');
        await writeFile(request,JSON.stringify({model,voices,text:scene.narration,output:path}));
        await runProcess(python,[join(config.root,'scripts/local-tts.py'),request],dir,signal,config.renderTimeout);
      } else {
        await runProcess(process.execPath,[hyperframesCli,'tts','--text-file',textFile,'--output',path,'--voice','zf_xiaobei','--lang','zh','--speed','1','--json'],dir,signal,config.renderTimeout);
      }
      const duration = await probeDuration(path,dir,config,signal);
      plan.cues.push({sceneId:scene.id,start,duration,text:scene.narration,file:'audio/'+scene.id+'.wav'});
    }
    start += scene.duration;
  }
  if (brief.narrationEnabled && !plan.cues.length) throw new AppError(503,'启用配音但分镜没有旁白');
  if (brief.music === 'generated') {
    if (!board.musicScore) throw new AppError(503,'导演没有返回有效音乐事件表');
    await writeFile(join(audioDir,'music.wav'),synthesizeMusic(board.musicScore,brief.duration));
    plan.music = 'audio/music.wav';
  } else if (brief.music === 'uploaded') {
    const selected = assets.find(a=>a.kind==='audio');
    if (!selected) throw new AppError(400,'请先上传背景音乐');
    const extension = selected.name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '.bin';
    const source = join(dir,'assets',selected.id+extension);
    await copyFile(source,join(audioDir,'uploaded'+extension));
    plan.music = 'audio/uploaded'+extension;
  }
  await writeFile(join(dir,'audio-plan.json'),JSON.stringify(plan,null,2));
  return plan;
}
export function fitNarration(board: Storyboard, plan: AudioPlan, duration: number, maxSceneDuration=15) {
  const minimum = board.scenes.map(scene=>Math.max(60,Math.ceil(((plan.cues.find(c=>c.sceneId===scene.id)?.duration ?? 0)+0.25)*30)));
  if (minimum.some(n=>n>maxSceneDuration*30) || minimum.reduce((a,b)=>a+b,0)>duration*30) throw new AppError(503,'旁白超过视频可容纳时长，需要精简旁白');
  const counts = board.scenes.map((scene,i)=>Math.max(minimum[i],Math.round(scene.duration*30)));
  let excess = counts.reduce((a,b)=>a+b,0)-duration*30;
  while(excess>0) { for(let i=0;i<counts.length && excess>0;i++) if(counts[i]>minimum[i]) { counts[i]--; excess--; } }
  let remaining = duration*30-counts.reduce((a,b)=>a+b,0);
  while(remaining>0) { let added=false;for(let i=0;i<counts.length && remaining>0;i++) if(counts[i]<maxSceneDuration*30) { counts[i]++; remaining--;added=true; }if(!added)throw new AppError(503,'旁白时间规划无法覆盖目标片长'); }
  let start=0;
  board.scenes.forEach((scene,i)=>{scene.duration=counts[i]/30;const cue=plan.cues.find(c=>c.sceneId===scene.id);if(cue) cue.start=start;start+=scene.duration;});
}
export async function mixAudio(dir: string, plan: AudioPlan, duration: number, config: Config, signal: AbortSignal) {
  if (!plan.cues.length && !plan.music) return;
  for(const cue of plan.cues)if(cue.start+cue.duration>duration+0.01)throw new AppError(503,'旁白音轨超出视频时长，不能截断交付');
  const args = ['-hide_banner','-loglevel','error','-y','-i',join(dir,'final.mp4')];
  const filters: string[] = [];
  const inputs: string[] = [];
  plan.cues.forEach((cue,i)=>{
    args.push('-i',join(dir,cue.file));
    filters.push(`[${i+1}:a]aresample=48000,adelay=${Math.round(cue.start*1000)}:all=1,apad,atrim=duration=${duration}[voice${i}]`);
    inputs.push(`[voice${i}]`);
  });
  if (inputs.length) filters.push(`${inputs.join('')}amix=inputs=${inputs.length}:normalize=0[vo]`);
  if (plan.music) {
    const i = plan.cues.length+1;args.push('-stream_loop','-1','-i',join(dir,plan.music));
    const gain=inputs.length?0.25:1;
    filters.push(`[${i}:a]aresample=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS,loudnorm=I=-18:TP=-1.5:LRA=11,aresample=48000,volume=${gain},afade=t=in:d=0.3,afade=t=out:st=${Math.max(0,duration-0.5)}:d=0.5[bg]`);
    if (inputs.length) filters.push('[vo]asplit=2[vo-main][vo-side];[bg][vo-side]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=250[duck];[vo-main][duck]amix=inputs=2:normalize=0,alimiter=limit=0.95[mixed]');
    else filters.push('[bg]alimiter=limit=0.95[mixed]');
  } else filters.push('[vo]alimiter=limit=0.95[mixed]');
  args.push('-filter_complex',filters.join(';'),'-map','0:v:0','-map','[mixed]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',join(dir,'final-audio.mp4'));
  await runProcess(config.ffmpeg,args,dir,signal,config.renderTimeout);
  await probeDuration(join(dir,'final-audio.mp4'),dir,config,signal);
  await copyFile(join(dir,'final-audio.mp4'),join(dir,'final.mp4'));
}
