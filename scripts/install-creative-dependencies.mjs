import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),tar=require('tar');
const root=resolve('.runtime/npm');await mkdir(root,{recursive:true});
const meta=await fetch('https://registry.npmjs.org/npm/latest').then(r=>r.json());
const file=join(root,'npm.tgz');await writeFile(file,Buffer.from(await fetch(meta.dist.tarball).then(r=>r.arrayBuffer())));
await tar.x({file,cwd:root,strip:1});
const remotion=await fetch('https://registry.npmjs.org/remotion/latest').then(r=>r.json());
const args=['install','--save-exact','--no-audit','--no-fund','remotion@'+remotion.version,
  '@remotion/bundler@'+remotion.version,'@remotion/renderer@'+remotion.version,'@remotion/player@'+remotion.version,'three','@types/three','sharp'];
const child=spawn(process.execPath,[join(root,'bin/npm-cli.js'),...args],{stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
