import "dotenv/config";
import { mkdir, readFile, writeFile, open, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const brand = "cocode 酷码工作室 · Cocode Studio VideoForge";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
process.chdir(root);
process.env.VIDEOFORGE_ROOT = root;
process.env.DSH_HOME = resolve(root, ".dsh-videoforge");
process.env.DSH_DISABLE_PLUGIN_SCAN = "true";
process.env.DSH_TELEMETRY_DISABLED = "1";
const profile = join(process.env.DSH_HOME, "profiles/videoforge");
await mkdir(profile, { recursive: true });
await mkdir(join(root, "video_projects"), { recursive: true, mode: 0o700 });
const lock = join(root, "video_projects/.server.lock");
async function acquire() {
  try {
    const f = await open(lock, "wx", 0o600);
    await f.writeFile(String(process.pid));
    await f.close();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(await readFile(lock, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (err) {
      if (err.code === "EPERM") alive = true;
    }
    if (alive)
      throw new Error(
        `${brand} 已有进程在使用 video_projects；本地文件存储必须单实例运行。`,
      );
    await rm(lock, { force: true });
    return acquire();
  }
}
await acquire();
try {
  await import("./build.mjs");
  // Explicit empty bundle list prevents DSH's default base bundle and all presets.
  await writeFile(
    join(profile, "package.json"),
    JSON.stringify(
      {
        name: "cocode-videoforge-profile",
        private: true,
        type: "module",
        dependencies: {},
        dsh: { profile: { bundles: [] } },
      },
      null,
      2,
    ),
  );
  const patch = await readFile(join(root, "cordis.patch.yml"), "utf8");
  const names = ["cocode-data-store", "cocode-director", "cocode-studio-ui"];
  let resolvedPatch = patch;
  for (const name of names)
    resolvedPatch = resolvedPatch.replace(
      `name: '${name}'`,
      `name: '${new URL(`../plugins/${name}/lib/index.js`, import.meta.url).href}'`,
    );
  await writeFile(join(profile, "cordis.patch.yml"), resolvedPatch);
  await writeFile(
    join(process.env.DSH_HOME, "cordis.patch.yml"),
    "# " + brand + " — no home overlays\n[]\n",
  );
  const cli = join(
    require.resolve("@deepseek-ai/dsh/package.json"),
    "../lib/bin.js",
  );
  console.log(`[${brand}] 固定 profile: videoforge；加载 ${names.join(", ")}`);
  const child = spawn(process.execPath, [cli, "--profile", "videoforge"], {
    // Product .env is loaded above; pass it as the launch environment. DSH's
    // own .env loader rejects bootstrap-only names such as DEEPSEEK_BASE_URL.
    cwd: process.env.DSH_HOME,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} catch (e) {
  console.error(`[${brand}] ${e.message}`);
  process.exitCode = 1;
} finally {
  await rm(lock, { force: true });
}
