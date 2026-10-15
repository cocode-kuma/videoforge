import { spawn } from "node:child_process";
import { AppError } from "../../shared/contracts.js";
import { existsSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';

/** Fixed executable + argument array. No shell and no model-supplied command. */
export function runProcess(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  timeout: number,
  onProgress?: (text: string) => void,
  environment?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: environment ?? processEnvironment(),
    });
    let output = "",
      stopped = false,
      killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else {
        const killGroup = (signal: NodeJS.Signals) => {
          if (!child.pid) return;
          try { process.kill(-child.pid, signal); }
          catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal); }
        };
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 3000);
      }
    };
    const timer = setTimeout(stop, timeout);
    signal.addEventListener("abort", stop, { once: true });
    const collect = (chunk: Buffer) => {
      const s = chunk.toString();
      // Large check reports contain per-frame findings; truncating them loses the
      // JSON header and turns genuine diagnostics into unusable repair prompts.
      output = (output + s).slice(-2 * 1024 * 1024);
      onProgress?.(s);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const clean = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
    };
    child.on("error", (e) => {
      clean();
      reject(
        new AppError(
          503,
          `无法启动视频引擎，请联系管理员检查安装 (${(e as NodeJS.ErrnoException).code ?? "启动失败"})`,
        ),
      );
    });
    child.on("close", (code) => {
      clean();
      if (stopped)
        reject(new AppError(503, "视频生成超时或服务已停止，请稍后重试"));
      else if (code !== 0)
        reject(
          Object.assign(
            new AppError(503, "视频渲染失败，请稍后重试或联系管理员"),
            { diagnostic: output },
          ),
        );
      else resolve(output);
    });
  });
}
export function processEnvironment(): NodeJS.ProcessEnv {
  const root = process.env.VIDEOFORGE_ROOT ?? process.cwd();
  const bin = resolve(root,'.runtime/bin');
  const python = resolve(root,process.platform === 'win32' ? '.venv-tts/Scripts/python.exe' : '.venv-tts/bin/python');
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  return { ...process.env, NO_COLOR: '1', CI: '1', HYPERFRAMES_NO_TELEMETRY: '1',
    ...(existsSync(join(bin,'ffmpeg.exe')) ? { PATH: bin + delimiter + process.env.PATH } : {}),
    ...(!process.env.HYPERFRAMES_PYTHON && existsSync(python) ? {HYPERFRAMES_PYTHON:python} : {}),
    ...(!process.env.PRODUCER_HEADLESS_SHELL_PATH && existsSync(edge) ? {PRODUCER_HEADLESS_SHELL_PATH:edge} : {}),
  };
}
