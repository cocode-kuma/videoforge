import {exportDimensions,type ExportResolution} from '../../shared/export-settings.js';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { AppError, type Storyboard } from '../../shared/contracts.js';
import { SkillLibrary } from './skills.js';
import { runProcess } from './process.js';

const require = createRequire(import.meta.url);
export const hyperframesCli = join(require.resolve('hyperframes/package.json'), '../bin/hyperframes.mjs');
export function canvasSize(aspect: string,resolution?:ExportResolution): [number,number] {
  if(resolution)return exportDimensions(aspect,resolution);
  return aspect === '9:16' ? [720,1280] : aspect === '1:1' ? [960,960] : [1280,720];
}
export function toSubComposition(html: string): string {
  if (/<template\b/i.test(html)) return html;
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (!body) throw new AppError(503, '镜头缺少完整 body');
  const resources = [...head.matchAll(/<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)>|<link\b[^>]*>/gi)].map(m => m[0]).join('\n');
  const contents = (resources + '\n' + body).replace(/<script\b[^>]*\bsrc=["'](?:\.\/)?gsap\.min\.js["'][^>]*>\s*<\/script>/gi, '');
  return `<!doctype html><html><body><template>${contents}</template></body></html>`;
}
export function createLedger(board: Storyboard) {
  let frames = 0;
  const seams = [];
  for (let i = 0; i < board.scenes.length - 1; i++) {
    frames += Math.round(board.scenes[i].duration * 30);
    seams.push({ id: `${board.scenes[i].id}→${board.scenes[i+1].id}`, cut: frames / 30,
      technique: 'cut-the-curve LEFT',
      exit: { selector: `#vf-wrap-${board.scenes[i].id}`, axis: 'x', dir: -1 },
      entry: { selector: `#vf-wrap-${board.scenes[i+1].id}`, axis: 'x', dir: -1 },
    });
  }
  return { fps: 30, seams };
}
export async function writeMaster(dir: string, board: Storyboard, aspect: string, duration: number, signal: AbortSignal, library: SkillLibrary,resolution?:ExportResolution) {
  const [width,height] = canvasSize(aspect,resolution);
  let startFrame = 0;
  const slots = board.scenes.map(scene => {
    const start = startFrame / 30;
    startFrame += Math.round(scene.duration * 30);
    return `<div id="vf-wrap-${scene.id}" class="vf-wrapper"><div id="vf-slot-${scene.id}" class="clip" data-composition-id="${scene.id}" data-composition-src="${scene.id}/composition.html" data-start="${start}" data-duration="${scene.duration}" data-track-index="0" data-width="${width}" data-height="${height}"></div></div>`;
  }).join('\n');
  const ledger = createLedger(board);
  await writeFile(join(dir,'ledger.json'), JSON.stringify(ledger,null,2));
  await copyFile(require.resolve('gsap/dist/gsap.min.js'), join(dir,'gsap.min.js'));
  await writeFile(join(dir,'hyperframes.json'), JSON.stringify({ name: 'cocode-videoforge-master' }));
  await writeFile(join(dir,'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><script src="gsap.min.js"></script><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${board.scenes[0].palette[0]}}#vf-master{position:relative;width:100%;height:100%;overflow:hidden}.vf-wrapper{position:absolute;inset:0}.vf-wrapper>.clip{position:absolute;inset:0}</style></head><body><div id="vf-master" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">${slots}</div><script>const tl=gsap.timeline({paused:true});
// <seams:auto>
// </seams:auto>
window.__timelines["main"]=tl;
</script></body></html>`);
  if (ledger.seams.length) {
    await runProcess(process.execPath,[join(library.root,'internal/motion-doctrine/scripts/seam-stamp.mjs'),'--ledger',join(dir,'ledger.json'),'--write',join(dir,'index.html')],dir,signal,30000);
  }
  return { ledger, width, height };
}
