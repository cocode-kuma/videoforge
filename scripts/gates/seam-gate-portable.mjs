// Portable launcher for the pinned upstream verifier. Numerical checks remain upstream-owned.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(require.resolve('hyperframes/package.json'), '../bin/hyperframes.mjs');
const sourcePath = 'internal/motion-doctrine/scripts/seam-gate.mjs';
const manifest = JSON.parse(await readFile(join(root,'vendor/hyperframes-skills/manifest.json'),'utf8'));
let source = await readFile(join(root,'vendor/hyperframes-skills',sourcePath),'utf8');
if (createHash('sha256').update(source).digest('hex') !== manifest.files.find(f=>f.path===sourcePath)?.sha256) throw Error('Upstream verifier hash mismatch');
const spawnPattern = /const child = spawn\("sh", \["-c", cmd\.replace\([\s\S]*?detached: true,\s*\}\);/;
if (!spawnPattern.test(source)) throw Error('Upstream launcher changed; review portable adaptation');
source = source.replace(spawnPattern, `const child = spawn(process.execPath, [${JSON.stringify(cli)}, 'preview', '--foreground', '--no-open', '--port', String(port)], { cwd: project, env, stdio: ['ignore','pipe','pipe'], detached: process.platform !== 'win32', windowsHide: true });`);
source = source.replace('import { spawn } from "node:child_process";', 'import { spawn, spawnSync } from "node:child_process";');
source = source.replaceAll('process.kill(-child.pid, "SIGTERM");', 'process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }) : process.kill(-child.pid, "SIGTERM");');
source = source.replaceAll('process.kill(-child.pid, "SIGKILL");', 'process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }) : process.kill(-child.pid, "SIGKILL");');
source = source.replace('stdio: ["ignore", "pipe", "pipe"], detached: true', 'stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true');
const browser = process.env.PRODUCER_HEADLESS_SHELL_PATH || process.env.CHROME_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium',
].find(p => existsSync(p));
const dir = await mkdtemp(join(tmpdir(),'vf-seam-'));
const script = join(dir,'seam-gate.mjs');
await writeFile(script,source);
try {
  const code = await new Promise((resolve,reject) => {
    const child = spawn(process.execPath,[script,...process.argv.slice(2)],{ stdio:'inherit', windowsHide:true, env:{...process.env,...(browser?{CHROME_PATH:browser}:{})} });
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>child.kill(signal));
    child.once('error',reject);child.once('close',resolve);
  });
  process.exitCode = code ?? 1;
} finally { await rm(dir,{recursive:true,force:true}); }
