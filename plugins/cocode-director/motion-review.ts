import {readFile,rm} from 'node:fs/promises';
import sharp,{type OverlayOptions} from 'sharp';
import type {Config} from '../../shared/config.js';
import {CreativeWorkspace} from './workspace.js';
import {runProcess} from './process.js';
import {cleanExecutionEnv,type RenderSpec} from './creative-runtime.js';

export function frameDifferenceClues(bytes:Buffer,fps:number,pixels=160*90){
  const frames=Math.floor(bytes.length/pixels),differences:number[]=[];
  let run=0,longestRun=0,runStart=0,longestStart=0;
  for(let f=1;f<frames;f++){
    let sum=0;for(let p=0;p<pixels;p++)sum+=Math.abs(bytes[f*pixels+p]-bytes[(f-1)*pixels+p]);
    const difference=sum/pixels;differences.push(difference);
    if(difference<.5){if(!run)runStart=f-1;run++;if(run>longestRun){longestRun=run;longestStart=runStart;}}else run=0;
  }
  return {frames,fps,meanDifference:differences.length?differences.reduce((a,b)=>a+b,0)/differences.length:0,
    nearStaticRatio:differences.length?differences.filter(d=>d<.5).length/differences.length:0,
    longestNearStatic:{start:longestStart/fps,duration:longestRun/fps},
    method:'所有解码帧缩为 160×90 灰度，计算相邻帧平均绝对差；低于 0.5 为近静止线索，单位为 0–255 灰度值。',
    interpretation:'仅作为线索：结合连续抽帧、动画源码、叙事与用户要求判断有意停留或失效动画。禁止用阈值机械判失败，禁止靠抖动或闪烁提高帧差。'};
}

export async function motionReview(config:Config,workspace:CreativeWorkspace,path:string,spec:RenderSpec,signal:AbortSignal){
  const input=await workspace.path(path),root=workspace.root;
  const probe=JSON.parse(await runProcess(config.ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type,avg_frame_rate','-of','json',input],root,signal,30000,undefined,cleanExecutionEnv()));
  const stream=probe.streams?.find((s:any)=>s.codec_type==='video');
  if(!stream)throw Error('动态检查需要包含视频轨的真实影片');
  const [numerator,denominator]=String(stream.avg_frame_rate).split('/').map(Number),rate=numerator/denominator;
  const duration=Number(probe.format?.duration)>0?Number(probe.format.duration):spec.duration;
  const fps=Number.isFinite(rate)&&rate>0?rate:spec.fps;
  const raw=await workspace.path('previews/motion-review.gray',true);
  try{
    await runProcess(config.ffmpeg,['-y','-hide_banner','-loglevel','error','-i',input,'-an','-vf','scale=160:90,format=gray','-fps_mode','passthrough','-f','rawvideo',raw],root,signal,config.renderTimeout,undefined,cleanExecutionEnv());
    const clues=frameDifferenceClues(await readFile(raw),fps);
    const picks:{file:string;label:string}[]=[];
    const starts=[0,Math.max(0,duration/2-.5),Math.max(0,duration-1)];
    for(let window=0;window<starts.length;window++){
      const start=starts[window],pattern=await workspace.path(`previews/motion-${window}-%02d.png`,true);
      await runProcess(config.ffmpeg,['-y','-hide_banner','-loglevel','error','-ss',String(start),'-i',input,'-an','-vf','fps=8,scale=480:-1,tpad=stop_mode=clone:stop_duration=1','-frames:v','8',pattern],root,signal,60000,undefined,cleanExecutionEnv());
      const layers:OverlayOptions[]=[];
      for(let i=0;i<8;i++){
        const frame=await workspace.path(`previews/motion-${window}-${String(i+1).padStart(2,'0')}.png`);
        const image=await sharp(frame).resize(320,180,{fit:'contain',background:'#10141b'}).png().toBuffer();
        const left=(i%2)*320,top=Math.floor(i/2)*204;
        layers.push({input:image,left,top});
        layers.push({input:Buffer.from(`<svg width="320" height="24"><text x="10" y="17" fill="white" font-size="13">${Math.min(Math.max(0,duration-1/fps),start+i/8).toFixed(3)} s</text></svg>`),left,top:top+180});
      }
      const file=`previews/motion-contact-${window}.png`;
      await sharp({create:{width:640,height:816,channels:3,background:'#10141b'}}).composite(layers).png().toFile(await workspace.path(file,true));
      picks.push({file,label:`连续抽帧 ${start.toFixed(2)}–${Math.min(duration,start+.875).toFixed(2)} 秒；从左到右、从上到下，每格间隔 0.125 秒；不足一秒的短片尾部为辅助重复帧；黑色格间隔与时间标签不是成片内容`});
    }
    return {clues,picks};
  }finally{await rm(raw,{force:true});}
}
