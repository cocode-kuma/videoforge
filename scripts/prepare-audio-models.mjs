import { mkdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
const dir = resolve('.runtime/tts');await mkdir(dir,{recursive:true});
const release = await (await fetch('https://api.github.com/repos/thewh1teagle/kokoro-onnx/releases/tags/model-files-v1.0')).json();
const records = [];
for (const name of ['kokoro-v1.0.int8.onnx','voices-v1.0.bin']) {
  const asset = release.assets?.find(a=>a.name===name);
  if (!asset) throw Error('Missing official model asset '+name);
  const target = join(dir,name);
  if ((await stat(target).catch(()=>null))?.size !== asset.size) {
    let completed=false;
    for(let attempt=0;attempt<5;attempt++) {
      try {
        console.log('Downloading '+name+' (attempt '+(attempt+1)+')');
        const res = await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(180000)});
        if(!res.ok||!res.body)throw Error('Model download failed '+res.status);
        await pipeline(Readable.fromWeb(res.body),createWriteStream(target+'.part'));
        if((await stat(target+'.part')).size!==asset.size)throw Error('Model size mismatch');
        await rename(target+'.part',target);completed=true;break;
      } catch(error) { console.log('Download retry: '+error.message);await rm(target+'.part',{force:true}); }
    }
    if(!completed)throw Error('Could not prepare '+name);
  }
  const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);
  records.push({name,source:asset.browser_download_url,bytes:asset.size,sha256:hash.digest('hex')});
}
await writeFile(join(dir,'manifest.json'),JSON.stringify({repository:'thewh1teagle/kokoro-onnx',release:'model-files-v1.0',quantization:'int8',files:records},null,2));
console.log('Local CPU speech model and voices ready');
