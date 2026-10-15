import {build} from 'esbuild';
import {readdir,mkdir} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {spawn} from 'node:child_process';
// Compile TS with the same bundler used by the shipped plugins; no OS-account lookup required.
const requested=process.argv.slice(2);
const files=requested.length?requested:(await readdir('tests')).filter(name=>name.endsWith('.test.ts')).map(name=>'tests/'+name);
const output=resolve('.test-artifacts/tests');await mkdir(output,{recursive:true});
const entries=files.map(file=>resolve(file));
await build({entryPoints:entries,outdir:output,bundle:true,platform:'node',format:'esm',packages:'external',target:'node22',logLevel:'silent'});
const child=spawn(process.execPath,['--test','--test-concurrency=2',...files.map(file=>resolve(output,basename(file).replace(/\.ts$/,'.js')))],
  {stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
