import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import type {Config} from '../../shared/config.js';
import {AppError} from '../../shared/contracts.js';
import {runProcess} from './process.js';
import {cleanExecutionEnv} from './creative-runtime.js';
import {safeFetch} from '../../shared/remote.js';

export type VoiceProvider='auto'|'gateway'|'kokoro'|'elevenlabs'|'edge'|'minimax';
export function voiceProviders(config:Config) {
  const local=existsSync(join(config.root,'.runtime/tts/kokoro-v1.0.int8.onnx'))&&existsSync(join(config.root,'.runtime/tts/voices-v1.0.bin'));
  return [{id:'gateway',configured:!!config.ttsApiUrl,voice:config.ttsVoice},{id:'kokoro',configured:local,voice:'zf_xiaobei'},
    {id:'elevenlabs',configured:!!(config.elevenLabsApiKey&&config.elevenLabsVoice),voice:config.elevenLabsVoice},
    {id:'minimax',configured:!!config.miniMaxApiKey,voice:config.miniMaxVoice},
    {id:'edge',configured:existsSync(join(config.root,'.runtime/python/edge-ready.json')),voice:'zh-CN-XiaoxiaoNeural'}];
}
function selected(config:Config,provider:VoiceProvider):Exclude<VoiceProvider,'auto'> {
  if(provider!=='auto')return provider;
  if(config.ttsProvider!=='auto')return config.ttsProvider as Exclude<VoiceProvider,'auto'>;
  const found=voiceProviders(config).find(p=>p.configured);if(!found)throw new AppError(503,'没有已就绪的配音服务');return found.id as Exclude<VoiceProvider,'auto'>;
}
async function checked(response:Response) {
  if(!response.ok)throw new AppError(503,'配音服务返回 '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<32||bytes.length>30*1024*1024)throw new AppError(503,'配音音频无效或超出大小限制');return bytes;
}
export async function synthesizeVoice(config:Config,dir:string,signal:AbortSignal,input:{text:string;provider?:VoiceProvider;voice?:string;output:string}) {
  const provider=selected(config,input.provider??'auto'),voice=input.voice||voiceProviders(config).find(p=>p.id===provider)?.voice||'';
  const hash=createHash('sha256').update(JSON.stringify({text:input.text,provider,voice,model:provider==='minimax'?config.miniMaxModel:provider==='elevenlabs'?config.elevenLabsModel:''})).digest('hex');
  const cache=join(dir,'audio/cache'),wav=join(cache,hash+'.wav'),subtitles=join(cache,hash+'.srt');await mkdir(cache,{recursive:true});
  if(!existsSync(wav)) {
    const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(120000)]),headers={'Content-Type':'application/json'};
    let source=join(cache,hash+'.mp3');
    if(provider==='gateway') {
      if(!config.ttsApiUrl)throw new AppError(503,'配音网关未配置');
      await writeFile(source,await checked(await fetch(config.ttsApiUrl,{method:'POST',headers:{...headers,...(config.ttsApiKey?{Authorization:'Bearer '+config.ttsApiKey}:{})},body:JSON.stringify({text:input.text,voice,format:'wav'}),signal:requestSignal})));
    } else if(provider==='elevenlabs') {
      if(!config.elevenLabsApiKey||!voice)throw new AppError(503,'ElevenLabs 凭证或 voice ID 未配置');
      const response=await fetch(config.elevenLabsBaseUrl.replace(/\/$/,'')+'/v1/text-to-speech/'+encodeURIComponent(voice)+'/with-timestamps',{
        method:'POST',headers:{...headers,'xi-api-key':config.elevenLabsApiKey},body:JSON.stringify({text:input.text,model_id:config.elevenLabsModel}),signal:requestSignal});
      if(!response.ok)throw new AppError(503,'ElevenLabs 配音返回 '+response.status);
      const data=await response.json() as any;if(!data.audio_base64)throw new AppError(503,'ElevenLabs 未返回音频');
      await writeFile(source,Buffer.from(data.audio_base64,'base64'));
      const a=data.normalized_alignment??data.alignment;
      if(a?.characters?.length) {
        const cues=[];let text='',start=0;
        for(let i=0;i<a.characters.length;i++){if(!text)start=a.character_start_times_seconds[i];text+=a.characters[i];if(/[。！？.!?\n]/.test(a.characters[i])||text.length>=20||i===a.characters.length-1){cues.push({text,start,end:a.character_end_times_seconds[i]});text='';}}
        await writeFile(subtitles,toSrt(cues));
      }
    } else if(provider==='minimax') {
      if(!config.miniMaxApiKey)throw new AppError(503,'MiniMax 凭证未配置');
      const response=await fetch(config.miniMaxBaseUrl.replace(/\/$/,'')+'/v1/t2a_v2',{
        method:'POST',headers:{...headers,Authorization:'Bearer '+config.miniMaxApiKey},signal:requestSignal,
        body:JSON.stringify({model:config.miniMaxModel,text:input.text,stream:false,output_format:'hex',subtitle_enable:true,
          voice_setting:{voice_id:voice,speed:1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}})});
      if(!response.ok)throw new AppError(503,'MiniMax 配音返回 '+response.status);
      const data=await response.json() as any;
      if(data.base_resp?.status_code!==0||!data.data?.audio||!/^(?:[a-f0-9]{2})+$/i.test(data.data.audio))throw new AppError(503,'MiniMax 未返回有效音频');
      await writeFile(source,Buffer.from(data.data.audio,'hex'));
      const subtitleUrl=data.data?.subtitle_file??data.subtitle_file;
      if(subtitleUrl) {
        const raw=(await safeFetch(subtitleUrl,{signal:requestSignal})).data.toString('utf8');
        try {const cues=JSON.parse(raw);if(Array.isArray(cues))await writeFile(subtitles,toSrt(cues.map((c:any)=>({text:c.text,start:c.time_begin/1000,end:c.time_end/1000}))));}catch{if(raw.includes('-->'))await writeFile(subtitles,raw);}
      }
    } else if(provider==='edge') {
      await runProcess(config.python,['-m','edge_tts','--text',input.text,'--voice',voice,'--write-media',source,'--write-subtitles',subtitles],dir,signal,120000,undefined,cleanExecutionEnv());
    } else {
      const request=join(cache,hash+'-request.json');source=wav;
      await writeFile(request,JSON.stringify({model:join(config.root,'.runtime/tts/kokoro-v1.0.int8.onnx'),voices:join(config.root,'.runtime/tts/voices-v1.0.bin'),text:input.text,output:wav}));
      await runProcess(config.python,[join(config.root,'scripts/local-tts.py'),request],dir,signal,config.renderTimeout,undefined,cleanExecutionEnv());
    }
    if(source!==wav)await runProcess(config.ffmpeg,['-y','-hide_banner','-loglevel','error','-i',source,'-ar','48000','-ac','1',wav],dir,signal,60000,undefined,cleanExecutionEnv());
  }
  const probe=JSON.parse(await runProcess(config.ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',wav],dir,signal,30000));
  const duration=Number(probe.format?.duration);if(!probe.streams?.some((s:any)=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0)throw new AppError(503,'配音文件没有有效音轨');
  await writeFile(join(dir,input.output),await readFile(wav));
  let subtitlePath:string|undefined;
  if(existsSync(subtitles)){subtitlePath=input.output.replace(/\.[^.]+$/,'.srt');await writeFile(join(dir,subtitlePath),await readFile(subtitles));}
  return {path:input.output,duration,provider,voice,subtitles:subtitlePath,timing:subtitlePath?'provider':'unavailable'};
}
function stamp(n:number){const ms=Math.max(0,Math.round(n*1000));return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(v=>String(v).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');}
export function toSrt(cues:{text:string;start:number;end:number}[]) {return cues.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start).map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.trim()}\n`).join('\n');}
