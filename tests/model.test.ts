import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { Director } from "../plugins/cocode-director/index.js";
import { readConfig } from "../shared/config.js";
import { fixtureBoard } from "./fixtures.js";
test("model protocol uses fixed server model and preserves freely generated HTML", async () => {
  const requests: Record<string, unknown>[] = [];
  const html =
    '<!doctype html><html><body><div data-composition-id="s1"><canvas id="world"></canvas></div><script>window.__timelines={};window.myOriginalEffect=()=>fetch("https://example.com/asset.json");</script></body></html>';
  const provider = createServer(async (req, res) => {
    assert.equal(req.url, "/chat/completions");
    assert.equal(req.headers.authorization, "Bearer private-test-key");
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: requests.length === 1
                ? JSON.stringify(fixtureBoard)
                : `下面是镜头 HTML：\n\n\`\`\`html\n${html}\n\`\`\``,
            },
          },
        ],
      }),
    );
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => provider.once("listening", r));
  const root = await mkdtemp(join(tmpdir(), "vf-model-"));
  const store = new DataStore({
    ...readConfig(root),
    apiKey: "private-test-key",
    model: "fixed-server-model",
    baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
  });
  try {
    await store.init();
    const user = await store.register(
      "model@example.com",
      "test-password-12345",
      "Model",
      "kuma",
      "192.0.2.10",
    );
    const p = await store.createProject(user.id, "Model contract");
    const job = await store.enqueue(user.id, p.id, {
      prompt: "实现自由的 Canvas 运镜画面",
      duration: 15,
      aspect: "16:9",
      style: "cinematic",
    });
    const director = new Director(store),
      scope = {
        userId: user.id,
        projectId: p.id,
        jobId: job.id,
        signal: new AbortController().signal,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
      };
    const board = await director.generateStoryboard(scope);
    assert.equal(
      board.scenes.reduce((n, s) => n + s.duration, 0),
      15,
    );
    assert.equal(
      await director.generateSceneHtml(scope, board.scenes[0], {
        width: 1280,
        height: 720,
        duration: 7.9,
        style: board.visualStyle,
      }),
      html,
    );
    assert.deepEqual(
      requests.map((r) => r.model),
      ["fixed-server-model", "fixed-server-model"],
    );
    assert.deepEqual(requests.map((r) => r.thinking), [
      { type: "disabled" },
      { type: "disabled" },
    ]);
    assert.ok(JSON.stringify(requests).includes("自由使用 HTML"));
    assert.ok(JSON.stringify(requests).includes("绝不可动画 letterSpacing"));
    assert.ok(!JSON.stringify(requests).includes("private-test-key"));
    const once=new Director(store,{oneShot:true});
    const before=requests.length;
    await assert.rejects(once.generateStoryboard(scope),/分镜格式异常/);
    assert.equal(requests.length-before,1,'one-shot invalid storyboard must not trigger a second model call');
    let sceneCalls=0;
    once.generateSceneHtml=async()=>{sceneCalls++;return '<html><body><script>const = ;</script></body></html>';};
    await assert.rejects(once.renderScene(scope,board.scenes[0].id),/语法错误/);
    assert.equal(sceneCalls,1,'one-shot invalid scene must not trigger model repair');
    await once.dispose();
    await director.dispose();
  } finally {
    await new Promise<void>((r) => provider.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
