// cocode 酷码工作室 · Cocode Studio VideoForge: test the actual separately bundled plugins.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../plugins/cocode-data-store/lib/index.js";
import { Director } from "../plugins/cocode-director/lib/index.js";
import { createApp } from "../plugins/cocode-studio-ui/lib/index.js";
const root = await mkdtemp(join(tmpdir(), "vf-bundles-"));
const config = {
  root,
  dataRoot: join(root, "video_projects"),
  logsRoot: join(root, "logs"),
  origin: "http://localhost:3088",
  secure: false,
  trustProxy: 0,
  inviteCode: "kuma",
  inviteFreeVideosPerIp: 5,
  initialCredits: 20,
  apiKey: "",
  projectLimit: 100,
  dailyLimit: 20,
  queueLimit: 20,
  concurrency: 1,
};
const store = new DataStore(config);
await store.init();
const director = new Director(store),
  server = createApp(store, director).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
const request = (path, method = "GET", body, cookie = "") =>
  fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: config.origin,
      "X-Cocode-Request": "studio",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
try {
  const session = await request("/api/auth/session");
  assert.equal(session.status, 200);
  assert.equal(await session.json(), null);
  const anonymous = await request("/api/projects");
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "请先登录");
  const registration = await request("/api/auth/register", "POST", {
    name: "Bundle test",
    email: "bundles@example.com",
    password: "bundle-test-password",
    inviteCode: "kuma",
  });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get("set-cookie").split(";")[0];
  const duplicate = await request("/api/auth/register", "POST", {
    name: "Duplicate",
    email: "bundles@example.com",
    password: "bundle-test-password",
    inviteCode: "kuma",
  });
  assert.equal(duplicate.status, 409);
  const badLogin = await request("/api/auth/login", "POST", {
    email: "bundles@example.com",
    password: "incorrect-password",
  });
  assert.equal(badLogin.status, 401);
  const p = await (
    await request("/api/projects", "POST", { name: "Bundle project" }, cookie)
  ).json();
  const missing = await request(
    "/api/projects/00000000-0000-4000-8000-000000000000",
    "GET",
    undefined,
    cookie,
  );
  assert.equal(missing.status, 404);
  const generate = await request(
    `/api/projects/${p.id}/generate`,
    "POST",
    {
      prompt: "test render request",
      duration: 15,
      aspect: "16:9",
      style: "minimal",
    },
    cookie,
  );
  assert.equal(generate.status, 503);
  assert.match((await generate.json()).error, /尚未配置/);
  console.log(
    "cocode 酷码工作室 · Cocode Studio VideoForge — 独立打包插件回归通过：正常匿名状态 200；401/404/409/503 不再误报 500",
  );
} finally {
  await director.dispose();
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
}
