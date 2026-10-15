import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),tar=require('tar'),AdmZip=require('adm-zip');
const root=resolve('.runtime');await mkdir(root,{recursive:true});
const run=(cmd,args)=>new Promise((yes,no)=>{const p=spawn(cmd,args,{stdio:'inherit',windowsHide:true});p.once('error',no);p.once('exit',c=>c===0?yes():no(new Error('Runtime setup exited '+c)));});
const requested=new Set(process.argv.slice(2));
if(!requested.size||requested.has('--skills')) {
  const response=await fetch('https://api.github.com/repos/remotion-dev/skills/commits/main',{headers:{'User-Agent':'VideoForge'}});if(!response.ok)throw new Error('Cannot locate Remotion skill revision');
  const commit=(await response.json()).sha,target=resolve('vendor/remotion-skills');await mkdir(target,{recursive:true});
  const archive=join(root,'remotion-skills.tgz');await writeFile(archive,Buffer.from(await fetch('https://codeload.github.com/remotion-dev/skills/tar.gz/'+commit).then(r=>r.arrayBuffer())));
  await tar.x({file:archive,cwd:target,strip:1});await writeFile(join(target,'source.json'),JSON.stringify({repository:'https://github.com/remotion-dev/skills',commit},null,2));
  console.log('Remotion skills pinned to '+commit);
}
if(!requested.size||requested.has('--python')) {
  const pythonRoot=join(root,'python'),python=join(pythonRoot,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!existsSync(python))await run(process.env.VIDEOFORGE_PYTHON||'python',['-m','venv',pythonRoot]);
  await run(python,['-m','pip','install','edge-tts','Pillow','numpy','soundfile']);
  await run(python,['-c','import edge_tts,PIL,numpy,soundfile; print("Python creative dependencies ready")']);
  await writeFile(join(pythonRoot,'edge-ready.json'),JSON.stringify({python,preparedAt:new Date().toISOString()}));
}
if(!requested.size||requested.has('--blender')) {
  if(process.platform!=='win32'){console.log('Set BLENDER_PATH to your installed Blender executable.');}
  else {
    let base='https://mirror.blender.org/release/Blender4.5/';
    let response=await fetch(base),index=await response.text();
    if(!response.ok||!index.includes('windows-x64.zip')){base='https://ftp.nluug.nl/pub/graphics/blender/release/Blender4.5/';response=await fetch(base);index=await response.text();}
    const versions=[...new Set(index.match(/blender-4\.5\.\d+-windows-x64\.zip/g)??[])].sort((a,b)=>Number(b.match(/4\.5\.(\d+)/)[1])-Number(a.match(/4\.5\.(\d+)/)[1]));
    if(!versions.length)throw new Error('Official Blender download not found');
    const file=join(root,versions[0]);if(!existsSync(file)){const response=await fetch(base+versions[0]);if(!response.ok)throw new Error('Blender download failed');await writeFile(file,Buffer.from(await response.arrayBuffer()));}
    const checksumName=versions[0].replace(/-windows-x64\.zip$/,'.sha256');
    const sums=await fetch(base+checksumName).then(r=>r.ok?r.text():'');
    const expected=sums.split('\n').find(line=>line.includes(versions[0]))?.match(/[a-f0-9]{64}/i)?.[0];
    if(!expected)throw new Error('Blender checksum unavailable');
    if(createHash('sha256').update(await readFile(file)).digest('hex')!==expected.toLowerCase())throw new Error('Blender checksum mismatch');
    const target=join(root,'blender');await mkdir(target,{recursive:true});new AdmZip(file).extractAllTo(target,true);
    const folder=(await readdir(target)).find(f=>existsSync(join(target,f,'blender.exe')));if(!folder)throw new Error('Blender executable missing');
    await writeFile(join(target,'runtime.json'),JSON.stringify({executable:join(target,folder,'blender.exe'),source:base+versions[0]},null,2));
    console.log('Blender ready: '+folder);
  }
}
