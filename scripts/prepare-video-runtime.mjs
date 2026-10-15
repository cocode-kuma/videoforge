// Project-local Windows media binaries; never changes the system PATH.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const AdmZip = createRequire(require.resolve('hyperframes/package.json'))('adm-zip');
const root = resolve('.runtime/bin');
await mkdir(root,{recursive:true});
const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const response = await fetch(url);
if (!response.ok) throw Error(`FFmpeg download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const archive = new AdmZip(bytes);
for (const binary of ['ffmpeg.exe','ffprobe.exe']) {
  const entry = archive.getEntries().find(e=>e.entryName.endsWith('/bin/'+binary));
  if (!entry) throw Error('Missing '+binary);
  await writeFile(join(root,binary),entry.getData());
}
const licenses = archive.getEntries().filter(e => /\/(?:LICENSE|COPYING|README)[^/]*$/i.test(e.entryName));
for (const entry of licenses) await writeFile(join(root,entry.entryName.split('/').at(-1)),entry.getData());
await writeFile(join(root,'provenance.json'),JSON.stringify({source:url,archiveSha256:createHash('sha256').update(bytes).digest('hex'),downloadedAt:new Date().toISOString()},null,2));
console.log('Prepared project-local FFmpeg and FFprobe');
