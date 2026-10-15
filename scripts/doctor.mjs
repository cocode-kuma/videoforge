import "dotenv/config";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const require = createRequire(import.meta.url);
console.log("cocode 酷码工作室 · Cocode Studio VideoForge — 环境诊断");
for (const [cmd, args] of [
  [process.execPath, ["--version"]],
  [process.env.FFMPEG_PATH || "ffmpeg", ["-version"]],
  [process.env.FFPROBE_PATH || "ffprobe", ["-version"]],
]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  console.log(
    `${cmd}: ${(r.stdout || r.stderr || r.error?.message || "").split("\n")[0]}`,
  );
  if (r.status !== 0) process.exitCode = 1;
}
try {
  const r = spawnSync(
    process.execPath,
    [
      join(
        require.resolve("hyperframes/package.json"),
        "../bin/hyperframes.mjs",
      ),
      "doctor",
    ],
    { stdio: "inherit", windowsHide: true },
  );
  if (r.status !== 0) process.exitCode = 1;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
console.log(
  "模型凭证: " +
    (process.env.DEEPSEEK_API_KEY
      ? "已配置环境变量（不会输出内容）"
      : "检查 .env 或 ~/.dsh/.credentials.yaml；未配置时不能生成视频"),
);
