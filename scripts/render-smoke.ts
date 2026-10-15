import { mkdir, writeFile, mkdtemp, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { Director } from "../plugins/cocode-director/index.js";
import { composition } from "../plugins/cocode-director/composition.js";
import { readConfig } from "../shared/config.js";
import { fixtureBoard } from "../tests/fixtures.js";
import { randomUUID } from "node:crypto";
const root = await mkdtemp(join(tmpdir(), "vf-"));
await mkdir(root, { recursive: true });
const store = new DataStore({
  ...readConfig(root),
  root: process.cwd(),
  ffmpeg: readConfig().ffmpeg,
  ffprobe: readConfig().ffprobe,
  apiKey: "fixture-not-sent",
});
await store.init();
const user = await store.register(
  "smoke@example.com",
  "cocode-render-smoke",
  "渲染验证",
  "kuma",
  "127.0.0.1",
);
const p = await store.createProject(
  user.id,
  "cocode 酷码工作室 · Cocode Studio VideoForge 渲染验证",
);
const board = structuredClone(fixtureBoard);
board.scenes.forEach((s) => (s.duration = 7.5));
const job = await store.enqueue(user.id, p.id, {
  prompt: "渲染引擎本地端到端测试",
  duration: 15,
  aspect: "16:9",
  style: "minimal",
});
await store.updateProject(user.id, p.id, (p) => {
  p.storyboard = board;
});
const taskDir=join(await store.projectDir(user.id,p.id),'renders',job.id);await mkdir(taskDir,{recursive:true});
await writeFile(join(taskDir,'brief.json'),JSON.stringify({duration:15,aspect:'16:9'}));
await writeFile(join(taskDir,'storyboard.json'),JSON.stringify(board));
const director = new Director(store);
// This fixture is only a test input. Production always asks the configured model for unrestricted HTML.
director.generateSceneHtml = async (_s, scene, layout) =>
  composition(scene, "16:9", layout.duration);
const scope = {
  userId: user.id,
  projectId: p.id,
  jobId: job.id,
  signal: new AbortController().signal,
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
};
for (const scene of board.scenes) await director.renderScene(scope, scene.id);
const result = await director.assembleVideo(scope);
await mkdir(join(process.cwd(), ".test-artifacts"), { recursive: true });
await copyFile(
  await store.artifact(user.id, p.id, result.video),
  join(process.cwd(), ".test-artifacts/render-smoke.mp4"),
);
await writeFile(
  join(process.cwd(), ".test-artifacts/render-result.json"),
  JSON.stringify(
    { ...result, path: await store.artifact(user.id, p.id, result.video) },
    null,
    2,
  ),
);
console.log(
  "cocode 酷码工作室 · Cocode Studio VideoForge — 真实 Hyperframes + FFmpeg 渲染通过",
  result,
);
await director.dispose();
