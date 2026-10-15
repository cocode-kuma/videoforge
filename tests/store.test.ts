import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { readConfig } from "../shared/config.js";
const brief = {
  prompt: "制作一支科技产品宣传短片",
  duration: 15 as const,
  aspect: "16:9" as const,
  style: "cinematic" as const,
};
test("tenant isolation, password hashing, sessions, concurrency and persisted quota", async () => {
  const root = await mkdtemp(join(tmpdir(), "cocode-store-"));
  try {
    const store = new DataStore({ ...readConfig(root), dailyLimit: 1, initialCredits: 1, inviteFreeVideosPerIp: 0 });
    await store.init();
    const a = await store.register("one@example.com", "password-12345", "One", "kuma", "192.0.2.1"),
      b = await store.register("two@example.com", "password-56789", "Two", "kuma", "192.0.2.2");
    // Simulate an account created before the invite campaign: it retains its
    // historical local wallet and is not subject to the new invite pool.
    const accountsPath = join(root, "video_projects/users.json");
    const accounts = JSON.parse(await readFile(accountsPath, "utf8"));
    delete accounts.users.find((user: { id: string }) => user.id === a.id).inviteIpHash;
    const workspace = accounts.workspaces.find((item: { ownerId: string }) => item.ownerId === a.id);
    accounts.quotaWallets[workspace.id] = { granted: 1, consumed: 0, reserved: 0 };
    await writeFile(accountsPath, JSON.stringify(accounts));
    const raw = await readFile(accountsPath, "utf8");
    assert.ok(!raw.includes("password-12345"));
    assert.ok(!("hash" in a));
    await assert.rejects(
      store.register("ONE@example.com", "password-12345", "Duplicate", "kuma", "192.0.2.1"),
    );
    await assert.rejects(store.login("one@example.com", "wrong-password"));
    assert.equal(
      (await store.login("one@example.com", "password-12345")).id,
      a.id,
    );
    const token = await store.newSession(a.id);
    assert.equal((await store.authenticate(token)).id, a.id);
    assert.ok(
      !(
        await readFile(join(root, "video_projects/users.json"), "utf8")
      ).includes(token),
    );
    await store.logout(token);
    await assert.rejects(store.authenticate(token));
    const p = await store.createProject(a.id, "Secret");
    for (const action of [
      () => store.loadProject(b.id, p.id),
      () => store.saveProject(b.id, p.id, p),
      () => store.deleteProject(b.id, p.id),
      () => store.projectDir(b.id, p.id),
      () => store.loadProject(a.id, "../../users.json"),
      () => store.createProject(randomUUID(), "bad"),
    ])
      await assert.rejects(action());
    assert.equal((await store.listProjects(b.id)).length, 0);
    await assert.rejects(store.artifact(a.id, p.id, "../../users.json"));
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.updateProject(a.id, p.id, (p) =>
          p.messages.push({
            id: String(i),
            role: "user",
            text: "hello",
            createdAt: new Date().toISOString(),
          }),
        ),
      ),
    );
    assert.equal((await store.loadProject(a.id, p.id)).messages.length, 8);
    const results = await Promise.allSettled([
      store.enqueue(a.id, p.id, brief),
      store.enqueue(a.id, p.id, brief),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(store.deleteProject(a.id, p.id));
    const recovered = new DataStore({ ...readConfig(root), dailyLimit: 1, initialCredits: 1, inviteFreeVideosPerIp: 0 });
    await recovered.init();
    assert.equal(
      (await recovered.loadProject(a.id, p.id)).renders[0].status,
      "failed",
    );
    await recovered.deleteProject(a.id, p.id);
    const next = await recovered.createProject(a.id, "new");
    const nextJob = await recovered.enqueue(a.id, next.id, brief);
    assert.equal((await recovered.usage(a.id)).availableUnits, 0);
    await recovered.releaseQuota(a.id, next.id, nextJob.id);
    assert.equal((await recovered.usage(a.id)).availableUnits, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
