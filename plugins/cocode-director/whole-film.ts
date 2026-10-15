import {AppError,type Brief,type Storyboard} from '../../shared/contracts.js';
import {canvasSize} from './master.js';
import {validateHtmlSyntax} from './validate.js';

/** Validate the model's full document; do not add a template or rewrite its motion. */
export async function validateWholeFilm(html:string,board:Storyboard,brief:Brief){
  await validateHtmlSyntax(html);
  const [width,height]=canvasSize(brief.aspect,brief.exportResolution);
  const roots=[...html.matchAll(/<[a-z][^>]*\bdata-composition-id\s*=\s*(["'])(.*?)\1[^>]*>/gi)];
  if(roots.length!==1||roots[0][2]!=='main')throw new AppError(503,'全片必须只有一个 main 合成根');
  const root=roots[0][0];
  const attribute=(name:string)=>root.match(new RegExp('\\b'+name+'\\s*=\\s*(["\'])(.*?)\\1','i'))?.[2];
  for(const [key,expected] of Object.entries({'data-width':width,'data-height':height,'data-start':0,'data-duration':brief.duration})){
    const actual=attribute(key);
    if(actual===undefined||Number(actual)!==expected)throw new AppError(503,`全片 ${key} 与创作参数不一致`);
  }
  if(!html.includes('__timelines')||/\bdata-composition-src\s*=/i.test(html))throw new AppError(503,'全片缺少时间线注册，或仍使用分镜子合成');
  if(Math.abs(board.scenes.reduce((sum,scene)=>sum+scene.duration,0)-brief.duration)>1/30)throw new AppError(503,'全片节拍时长与视频总时长不一致');
  if(brief.music==='generated'&&!board.musicScore)throw new AppError(503,'全片响应缺少音乐事件表');
}
