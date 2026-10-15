import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { readConfig } from "../shared/config.js";

test("official quota binding, sync, remote reservation and release", async () => {
  let syncCount = 0;
  let reserveCount = 0;
  let consumeCount = 0;
  let releaseCount = 0;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    assert.equal(req.headers.authorization, "Bearer official-test-key");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/quota/bind") {
      assert.deepEqual(input, {
        accountRef: "research@example.com",
        bindingCode: "bind-1234",
      });
      res.end(
        JSON.stringify({
          externalUserId: "official-user-1",
          label: "科研账号",
          plan: "pro",
          availableUnits: 500,
          expiresAt: "2026-12-31T00:00:00.000Z",
          status: "active",
        }),
      );
      return;
    }
    if (req.url === "/v1/quota/sync") {
      assert.deepEqual(input, { externalUserId: "official-user-1" });
      syncCount++;
      res.end(
        JSON.stringify({
          externalUserId: "official-user-1",
          label: "科研账号",
          plan: "max",
          availableUnits: 420,
          expiresAt: "2026-12-31T00:00:00.000Z",
          status: "active",
        }),
      );
      return;
    }
    if (req.url === "/v1/quota/reserve") {
      assert.equal(input.externalUserId, "official-user-1");
      assert.equal(input.units, 2);
      assert.match(input.idempotencyKey, /^reserve:/);
      reserveCount++;
      res.end(
        JSON.stringify({
          reservationId: `remote-${reserveCount}`,
          externalUserId: "official-user-1",
          reservedUnits: 2,
          availableUnits: 418,
        }),
      );
      return;
    }
    assert.ok(
      req.url === "/v1/quota/consume" || req.url === "/v1/quota/release",
    );
    assert.equal(input.externalUserId, "official-user-1");
    assert.match(input.reservationId, /^remote-/);
    if (req.url === "/v1/quota/consume") consumeCount++;
    else releaseCount++;
    res.end(
      JSON.stringify({
        externalUserId: "official-user-1",
        label: "科研账号",
        plan: "max",
        availableUnits: 418,
        expiresAt: "2026-12-31T00:00:00.000Z",
        status: "active",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务未启动");
  const root = await mkdtemp(join(tmpdir(), "cocode-official-quota-"));
  try {
    const store = new DataStore({
      ...readConfig(root),
      initialCredits: 1,
      inviteFreeVideosPerIp: 5,
      officialQuotaApiUrl: `http://127.0.0.1:${address.port}`,
      officialQuotaApiKey: "official-test-key",
    });
    await store.init();
    const user = await store.register(
      "research@example.com",
      "password-12345",
      "Research",
      "kuma",
      "192.0.2.30",
    );
    const bound = await store.bindOfficial(
      user.id,
      "research@example.com",
      "bind-1234",
    );
    assert.equal(bound.official.connected, true);
    assert.equal(bound.official.availableUnits, 500);
    assert.equal(bound.internalAvailableUnits, 0);
    assert.equal(bound.availableUnits, 500);

    const synced = await store.syncOfficial(user.id);
    assert.equal(syncCount, 1);
    assert.equal(synced.official.plan, "max");
    assert.equal(synced.official.availableUnits, 420);

    for (let i = 0; i < 5; i++) {
      const freeProject = await store.createProject(user.id, `免费视频 ${i + 1}`);
      const freeJob = await store.enqueue(user.id, freeProject.id, {
        prompt: `制作第 ${i + 1} 支免费视频`,
        duration: 15,
        aspect: "16:9",
        style: "cinematic",
      });
      assert.equal(freeJob.quotaUnits, 0);
      await store.commitQuota(user.id, freeProject.id, freeJob.id);
      await store.updateProject(user.id, freeProject.id, (project) => {
        project.renders[0].status = "completed";
      });
    }
    assert.equal((await store.usage(user.id)).invitePromo?.completed, 5);
    assert.equal((await store.usage(user.id)).official.availableUnits, 420);

    const project = await store.createProject(user.id, "官网额度测试");
    const job = await store.enqueue(user.id, project.id, {
      prompt: "制作一支测试短片",
      duration: 30,
      aspect: "16:9",
      style: "cinematic",
    });
    assert.equal(job.quotaUnits, 2);
    assert.equal((await store.usage(user.id)).official.availableUnits, 418);
    await store.commitQuota(user.id, project.id, job.id);
    assert.equal(consumeCount, 1);
    await store.updateProject(user.id, project.id, (p) => {
      p.renders[0].status = "completed";
    });
    const nextProject = await store.createProject(user.id, "官网释放测试");
    const nextJob = await store.enqueue(user.id, nextProject.id, {
      prompt: "制作另一支测试短片",
      duration: 30,
      aspect: "16:9",
      style: "cinematic",
    });
    await store.releaseQuota(user.id, nextProject.id, nextJob.id);
    assert.equal(releaseCount, 1);
    assert.equal(reserveCount, 2);

    const disconnected = await store.disconnectOfficial(user.id);
    assert.equal(disconnected.official.connected, false);
    assert.equal(disconnected.official.availableUnits, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
