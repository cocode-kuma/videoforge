import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AdmZip = createRequire(require.resolve('hyperframes/package.json'))('adm-zip');

const revision = '2dd708e0a214fa4b8bffadc6a13c7ff55ef954a2';
const root = resolve('vendor/hyperframes-skills');
const repository = 'heygen-com/hyperframes';
async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  return res;
}
const archive = new AdmZip(Buffer.from(await (await get(`https://codeload.github.com/${repository}/zip/${revision}`)).arrayBuffer()));
const internal = ['motion-doctrine', 'cut-the-curve', 'oversized-cursor', 'seam-craft'];
const files = archive.getEntries().filter(x => !x.isDirectory).map(entry => ({
  path: entry.entryName.split('/').slice(1).join('/'), entry,
})).filter(x => (
  x.path.startsWith('skills/') || internal.some(n => x.path.startsWith(`.claude/skills/${n}/`)) ||
  /^LICENSE[^/]*$/.test(x.path)
));
const manifest = { repository, revision, engineVersion: '0.8.29', files: [] };
for (let offset = 0; offset < files.length; offset += 8) {
  await Promise.all(files.slice(offset, offset + 8).map(async x => {
    const path = x.path.replace('.claude/skills/', 'internal/');
    if (path.split('/').some(p => p === '..' || p === '.')) throw new Error('Unsafe archive entry');
    const data = x.entry.getData();
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), data);
    manifest.files.push({ path, source: x.path, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length });
  }));
}
manifest.files.sort((a,b) => a.path.localeCompare(b.path));
await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Vendored ${manifest.files.length} HyperFrames files at ${revision}`);
