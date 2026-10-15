import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { Director } from "../plugins/cocode-director/index.js";
import { readConfig } from "../shared/config.js";
import { fixtureBoard } from "./fixtures.js";
test("only three video tools; queue isolation, completion and failure persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "cocode-director-"));
  const store = new DataStore({
    ...readConfig(root),creationMode:"pipeline",
    apiKey: "test-only",
    concurrency: 1,
  });
  await store.init();
  const director = new Director(store);
  try {
    assert.deepEqual(
      [...director.tools.keys()],
      ["generate_storyboard", "render_scene", "assemble_video"],
    );
    const user = await store.register(
        "director@example.com",
        "password-12345",
        "Director",
        "kuma",
        "192.0.2.20",
      ),
      p = await store.createProject(user.id, "Film");
    const observed: string[] = [];
    director.generateWholeFilm = async (s) => {
      observed.push(s.userId);
      await store.updateProject(s.userId, s.projectId, (p) => {
        p.storyboard = fixtureBoard;
      });
      return fixtureBoard;
    };
    director.renderScene = async (_s, id) => {
      observed.push(id);
      return { sceneId: id, file: "fixture" };
    };
    director.assembleVideo = async () => ({
      video: "renders/fixture/final.mp4",
      duration: 15,
    });
    const job = await director.submit(user.id, p.id, {
      prompt: "测试完整的导演工作流程",
      duration: 15,
      aspect: "16:9",
      style: "minimal",
    });
    for (let i = 0; i < 100; i++) {
      if (
        (await store.loadProject(user.id, p.id)).renders.at(-1)!.status ===
        "completed"
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(
      (await store.loadProject(user.id, p.id)).renders.at(-1)!.status,
      "completed",
      await readFile(
        join(store.config.logsRoot, `${new Date().toISOString().slice(0, 10)}.jsonl`),
        "utf8",
      ).catch(() => "No director diagnostic log"),
    );
    assert.deepEqual(observed, [user.id]);
    director.assembleVideo = async () => {
      throw new Error("test rendering failure");
    };
    await director.submit(user.id, p.id, {
      prompt: "测试渲染失败提示是否持久化",
      duration: 15,
      aspect: "16:9",
      style: "minimal",
    });
    for (let i = 0; i < 100; i++) {
      if (
        (await store.loadProject(user.id, p.id)).renders.at(-1)!.status ===
        "failed"
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(
      (await store.loadProject(user.id, p.id)).renders.at(-1)!.status,
      "failed",
    );
  } finally {
    await director.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
