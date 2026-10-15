import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AppError,type AssetRecord} from '../../shared/contracts.js';
import type {Config} from '../../shared/config.js';
import {runProcess} from './process.js';
export type Caption={start:number;end:number;text:string};
function seconds(value:string){
  const m=value.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if(!m||Number(m[2])>59||Number(m[3])>59)throw new AppError(400,'字幕时间格式错误');
  return Number(m[1]??0)*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000;
}
export function parseCaptions(input:string):Caption[]{
  const blocks=input.replace(/^\uFEFF/,'').replace(/\r/g,'').trim().split(/\n\s*\n/);
  const result:Caption[]=[];
  for(const block of blocks){
    const lines=block.split('\n');if(/^WEBVTT|^NOTE(?:\s|$)|^STYLE$|^REGION$/.test(lines[0]))continue;
    const i=lines.findIndex(line=>line.includes('-->'));if(i<0)throw new AppError(400,'字幕缺少有效时间轴');
    const match=lines[i].match(/^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);if(!match)throw new AppError(400,'字幕时间轴格式错误');
    const start=seconds(match[1]),end=seconds(match[2]);
    const text=lines.slice(i+1).join('\n').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
    if(!text||text.length>240||text.split('\n').length>3||end<=start||end>3600||start<(result.at(-1)?.end??0)-0.001)throw new AppError(400,'字幕为空、过长、重叠或时间无效');
    result.push({start,end,text});if(result.length>2000)throw new AppError(400,'字幕条目过多');
  }
  if(!result.length)throw new AppError(400,'字幕文件没有可显示的条目');return result;
}
function assTime(value:number){const c=Math.round(value*100),h=Math.floor(c/360000),m=Math.floor(c/6000)%60,s=Math.floor(c/100)%60;return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;}
export function captionsAss(cues:Caption[],width:number,height:number){
  const font=Math.max(24,Math.round(height*0.043));
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,${font},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80101010,0,0,0,0,100,100,0,0,1,2,0,2,${Math.round(width*.08)},${Math.round(width*.08)},${Math.round(height*.07)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header+cues.map(cue=>`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text.replace(/\\/g,'\\\\').replace(/[{}]/g,'').replace(/\n/g,'\\N')}`).join('\n')+'\n';
}
export async function burnCaptions(dir:string,input:string,asset:AssetRecord,width:number,height:number,duration:number,config:Config,signal:AbortSignal){
  const extension=asset.name.match(/\.[A-Za-z0-9]+$/)?.[0]??'.bin';
  const cues=parseCaptions(await readFile(join(dir,'assets',asset.id+extension),'utf8'));
  if(cues.some(cue=>cue.end>duration+0.05))throw new AppError(400,'字幕时间超出视频时长');
  await writeFile(join(dir,'captions.ass'),captionsAss(cues,width,height));
  const output=join(dir,'captioned.mp4');
  await runProcess(config.ffmpeg,['-hide_banner','-loglevel','error','-y','-i',input,'-vf','ass=captions.ass','-map','0:v:0','-map','0:a?','-c:v','libx264','-crf','18','-preset','fast','-c:a','copy','-movflags','+faststart',output],dir,signal,config.renderTimeout);
  await writeFile(join(dir,'caption-report.json'),JSON.stringify({source:asset.id,cues,duration,width,height},null,2));
  return output;
}
