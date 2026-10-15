// cocode 酷码工作室 · Cocode Studio VideoForge
// Preserve official upstream archives byte-for-byte; never patch DSH core.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'vendor/dsh');
const version = '0.1.0-rc.6';
const commit = '15148dbd9a1d1f1ef1a26e5749b32af0cd663935';
const repository = 'https://github.com/deepseek-ai/deepseek-harness';
async function download(url) {
  // curl honors the host's proxy settings on Windows as well as Linux.
  const { stdout } = await promisify(execFile)(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--fail', '--location', '--silent', '--show-error', '--connect-timeout', '20',
    '--max-time', '1800', '--retry', '2', '--user-agent', 'cocode-videoforge-source-delivery', url,
  ], {
    encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true,
  });
  return stdout;
}
const metadataUrl = `https://registry.npmjs.org/@deepseek-ai%2Fdsh/${version}`;
const metadata = JSON.parse((await download(metadataUrl)).toString());
await mkdir(destination, { recursive: true });
const sources = [
  { file: `deepseek-harness-${version}-source.tar.gz`, url: `https://api.github.com/repos/deepseek-ai/deepseek-harness/tarball/${commit}`, kind: 'upstream-release-source' },
  { file: `dsh-${version}.tgz`, url: metadata.dist.tarball, kind: 'official-npm-cli', integrity: metadata.dist.integrity },
];
const artifacts = [];
for (const source of sources) {
  console.log(`cocode 酷码工作室 · Cocode Studio VideoForge — downloading ${source.file}`);
  const existing = resolve(destination, source.file);
  const bytes = source.kind === 'upstream-release-source' && (await import('node:fs')).existsSync(existing)
    ? await (await import('node:fs/promises')).readFile(existing)
    : await download(source.url);
  if (source.integrity) {
    const actual = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (actual !== source.integrity) throw new Error('Official npm integrity mismatch');
  }
  await writeFile(resolve(destination, source.file), bytes);
  artifacts.push({ ...source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const list = (await promisify(execFile)('tar', ['-tzf', resolve(destination, `deepseek-harness-${version}-source.tar.gz`)], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })).stdout;
const rootEntry = list.split(/\r?\n/).find((line) => /\/apps\/cli\/package\.json$/.test(line));
if (!rootEntry) throw new Error('Upstream DSH source archive is missing apps/cli/package.json');
const manifest = JSON.parse((await promisify(execFile)('tar', ['-xOzf', resolve(destination, `deepseek-harness-${version}-source.tar.gz`), rootEntry], { encoding: 'utf8' })).stdout);
if (manifest.version !== version) throw new Error('Upstream release version mismatch');
const rootDir = rootEntry.slice(0, rootEntry.indexOf('/apps/cli/package.json'));
for (const [entry, output] of [[`${rootDir}/LICENSE`, 'LICENSE.deepseek-harness'], [`${rootDir}/THIRD_PARTY_NOTICES.md`, 'THIRD_PARTY_NOTICES.deepseek-harness.md']]) {
  const text = (await promisify(execFile)('tar', ['-xOzf', resolve(destination, `deepseek-harness-${version}-source.tar.gz`), entry], { encoding: 'utf8' })).stdout;
  await writeFile(resolve(destination, output), text);
  artifacts.push({ file: output, kind: 'license-or-notices', bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
}
await writeFile(resolve(destination, 'provenance.json'), JSON.stringify({
  product: 'cocode 酷码工作室 · Cocode Studio VideoForge',
  repository, version, releaseCommit: commit,
  releaseCommitUrl: `${repository}/commit/${commit}`,
  releaseManifestUrl: `https://github.com/deepseek-ai/deepseek-harness/blob/${commit}/apps/cli/package.json`, metadataUrl, fetchedAt: new Date().toISOString(),
  note: 'npm metadata has no gitHead. Source is the official release(dsh): 0.1.0-rc.6 commit, verified by apps/cli/package.json. The npm artifact is independently verified by published SHA-512; this is not a reproducible-build attestation.',
  artifacts,
}, null, 2) + '\n');
console.log('cocode 酷码工作室 · Cocode Studio VideoForge — DSH archives verified');
