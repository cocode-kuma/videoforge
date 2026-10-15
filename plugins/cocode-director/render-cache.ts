import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import type {CreativeWorkspace} from './workspace.js';

export const captureVersion='browser-png-v2';
export async function renderFingerprint(workspace:CreativeWorkspace,parameters:unknown,visual=false){
  const hash=createHash('sha256').update(JSON.stringify(parameters)).update(captureVersion);
  const files=(await workspace.files()).filter(f=>!/^((exports|previews|runtime)\/)/.test(f.path)&&
    !/^(final(?:-audio)?\.mp4|captioned\.mp4|review\.json|delivery\.json|captions\.ass|audio-analysis\.pcm|build-manifest\.json)$/.test(f.path));
  const code=await Promise.all(files.filter(f=>/\.(html|css|[cm]?js|tsx?|jsx|glsl|py)$/.test(f.path)).map(f=>readFile(workspace.root+'/'+f.path,'utf8')));
  const references=code.join('\n');
  for(const file of files.sort((a,b)=>a.path.localeCompare(b.path))){
    if(file.path.endsWith('.md')&&!references.includes(file.path))continue;
    if(visual&&(file.path==='audio-plan.json'||/\.(mp3|wav|ogg|m4a|srt|vtt|ass)$/.test(file.path))&&!references.includes(file.path))continue;
    hash.update(file.path);hash.update(await readFile(await workspace.path(file.path)));
  }
  // Runtime libraries are excluded from authoring files but affect pixels.
  for(const file of (await workspace.files('runtime').catch(()=>[])).sort((a,b)=>a.path.localeCompare(b.path))){hash.update(file.path);hash.update(await readFile(await workspace.path(file.path)));}
  return hash.digest('hex');
}
export async function cachedFileValid(path:string,expected:string){
  try{if(!(await stat(path)).size)return false;return createHash('sha256').update(await readFile(path)).digest('hex')===expected;}catch{return false;}
}
