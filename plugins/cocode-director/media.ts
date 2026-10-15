import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {AppError,type AssetRecord} from '../../shared/contracts.js';
import type {Config} from '../../shared/config.js';
import {safeFetch} from '../../shared/remote.js';
import {runProcess} from './process.js';
const require=createRequire(import.meta.url);
const hfRequire=createRequire(require.resolve('hyperframes/package.json'));
const sharp:typeof import('sharp').default=hfRequire('sharp');
export const generationRequestSchema=z.object({kind:z.enum(['image','video']),prompt:z.string().min(10).max(2500),
  purpose:z.string().min(1).max(300),duration:z.number().min(1).max(12).optional()});
type GeneratedResponse={id?:string;status?:'queued'|'processing'|'completed'|'failed';url?:string;b64_json?:string;mime?:string};

/** The configured media gateway supplies both image and video providers through one small contract. */
export async function generateAsset(config:Config,dir:string,signal:AbortSignal,input:unknown):Promise<AssetRecord> {
  const request=generationRequestSchema.parse(input);
  if(!config.mediaApiUrl||!config.mediaApiKey)throw new AppError(400,'尚未配置影像生成服务，请使用已有素材或明确采用图形表达');
  const gateway=config.mediaApiUrl.replace(/\/$/,'');
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${config.mediaApiKey}`};
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(240000)]);
  const response=await fetch(gateway,{method:'POST',headers,body:JSON.stringify(request),signal:deadline});
  if(!response.ok)throw new AppError(503,`影像生成服务返回 ${response.status}`);
  let result=await response.json() as GeneratedResponse;
  for(let poll=0;['queued','processing'].includes(result.status??'');poll++) {
    if(!result.id||poll>=45)throw new AppError(503,'影像生成任务超时或缺少任务编号');
    await delay(3000,undefined,{signal:deadline});
    const status=await fetch(gateway+'/'+encodeURIComponent(result.id),{headers,signal:deadline});
    if(!status.ok)throw new AppError(503,`影像任务查询返回 ${status.status}`);
    result=await status.json() as GeneratedResponse;
  }
  if(result.status==='failed')throw new AppError(503,'影像生成任务失败');
  const bytes=result.b64_json?Buffer.from(result.b64_json,'base64'):result.url?(await safeFetch(result.url,{signal:deadline,limit:100*1024*1024})).data:null;
  if(!bytes||bytes.length<32||bytes.length>100*1024*1024)throw new AppError(503,'影像生成服务没有返回有效素材');
  const id=randomUUID();await mkdir(join(dir,'assets'),{recursive:true});
  let file:string,mime:string;
  if(request.kind==='image') {
    const png=await sharp(bytes,{limitInputPixels:40_000_000}).resize(1920,1920,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
    file=`assets/${id}.png`;mime='image/png';await writeFile(join(dir,file),png);
  } else {
    if(bytes.toString('ascii',4,8)!=='ftyp')throw new AppError(503,'影像服务必须返回 MP4 视频');
    file=`assets/${id}.mp4`;mime='video/mp4';await writeFile(join(dir,file),bytes);
    const probe=JSON.parse(await runProcess(config.ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',join(dir,file)],dir,signal,30000));
    if(!probe.streams?.some((s:{codec_type:string})=>s.codec_type==='video')||!(Number(probe.format?.duration)>0&&Number(probe.format?.duration)<=15))throw new AppError(503,'生成影像缺少视频流或超出允许时长');
  }
  const stored=await readFile(join(dir,file));
  return {id,name:request.purpose,kind:request.kind,file,mime,bytes:stored.length,
    sha256:createHash('sha256').update(stored).digest('hex'),createdAt:new Date().toISOString()};
}

export async function imageFrames(dir:string,paths:{file:string;label:string}[],limit=6) {
  const frames=[];
  for(const item of paths.slice(0,limit)) {
    const png=await sharp(await readFile(join(dir,item.file)),{limitInputPixels:40_000_000})
      .resize(960,960,{fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer();
    frames.push({label:item.label,url:'data:image/jpeg;base64,'+png.toString('base64')});
  }
  return frames;
}
export async function assetPreviews(config:Config,dir:string,assets:AssetRecord[],signal:AbortSignal) {
  const paths:{file:string;label:string}[]=[];await mkdir(join(dir,'asset-previews'),{recursive:true});
  for(const asset of assets.filter(a=>a.kind==='image'||a.kind==='video').slice(0,4)) {
    if(asset.kind==='image')paths.push({file:asset.file,label:`素材 ${asset.file} (${asset.name})`});
    else for(const time of [0,Math.min(2,(asset.duration??4)/2)]) {
      const file=`asset-previews/${asset.id}-${time}.png`;
      await runProcess(config.ffmpeg,['-hide_banner','-loglevel','error','-y','-ss',String(time),'-i',join(dir,asset.file),'-frames:v','1','-vf','scale=960:-2',join(dir,file)],dir,signal,30000);
      paths.push({file,label:`视频素材 ${asset.file} 在 ${time}s`});
    }
  }
  return imageFrames(dir,paths);
}
/** Real audio measurements for music-to-video; no fabricated beats in the prompt. */
export async function analyzeAudio(config:Config,dir:string,asset:AssetRecord|undefined,duration:number,signal:AbortSignal) {
  if(!asset)return null;
  const file=join(dir,'audio-analysis.pcm');
  await runProcess(config.ffmpeg,['-hide_banner','-loglevel','error','-y','-i',join(dir,asset.file),'-t',String(duration),'-ac','1','-ar','8000','-f','s16le',file],dir,signal,30000);
  const pcm=await readFile(file);const energy:number[]=[];
  for(let offset=0;offset<pcm.length;offset+=800) {
    let sum=0,count=0;for(let i=offset;i+1<Math.min(offset+800,pcm.length);i+=2){const v=pcm.readInt16LE(i)/32768;sum+=v*v;count++;}
    energy.push(count?Math.sqrt(sum/count):0);
  }
  const peaks=energy.map((e,i)=>({at:i*0.05,energy:e})).filter((p,i)=>i>0&&p.energy>energy[i-1]*1.35&&p.energy>0.025)
    .sort((a,b)=>b.energy-a.energy).slice(0,64).sort((a,b)=>a.at-b.at);
  return {source:asset.file,method:'measured RMS onset candidates, not exact beats',onsets:peaks};
}
