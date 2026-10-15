import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "../shared/contracts.js";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { readConfig } from "../shared/config.js";

const brief = {
  prompt: "制作一支邀请码活动测试短片",
  duration: 15 as const,
  aspect: "16:9" as const,
  style: "minimal" as const,
};

test("invite accounts share five successful videos by registration IP", async () => {
  const root = await mkdtemp(join(tmpdir(), "cocode-invite-promo-"));
  try {
    const store = new DataStore({
      ...readConfig(root),
      initialCredits: 20,
      inviteCode: "kuma",
      inviteFreeVideosPerIp: 5,
    });
    await store.init();
    await assert.rejects(
      store.register("bad@example.com", "password-12345", "Bad", "wrong", "192.0.2.1"),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );

    const a = await store.register("a@example.com", "password-12345", "A", " KUMA ", "::ffff:192.0.2.1");
    const b = await store.register("b@example.com", "password-12345", "B", "kuma", "192.0.2.1");
    const otherIp = await store.register("c@example.com", "password-12345", "C", "kuma", "192.0.2.2");
    const sameIpUsers = [a, b, ...await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        store.register(`same-ip-${i}@example.com`, "password-12345", "Same IP", "kuma", "192.0.2.1"),
      ),
    )];
    assert.equal((await store.quota(a.id)).internalAvailableUnits, 0);
    assert.deepEqual((await store.usage(a.id)).invitePromo, {
      limit: 5,
      completed: 0,
      reserved: 0,
      remaining: 5,
    });
    assert.equal((await store.usage(otherIp.id)).invitePromo?.remaining, 5);

    const projects = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        store.createProject(sameIpUsers[i].id, `同 IP 项目 ${i}`),
      ),
    );
    const submissions = await Promise.allSettled(
      projects.map((project, i) =>
        store.enqueue(sameIpUsers[i].id, project.id, brief),
      ),
    );
    const jobs = submissions.flatMap((result, i) =>
      result.status === "fulfilled"
        ? [{ userId: sameIpUsers[i].id, project: projects[i], job: result.value }]
        : [],
    );
    assert.equal(jobs.length, 5);
    assert.equal(submissions.filter((result) => result.status === "rejected").length, 1);
    assert.ok(jobs.every(({ job }) => job.quotaUnits === 0));
    const exhausted = submissions.find((result) => result.status === "rejected");
    assert.ok(exhausted?.status === "rejected");
    assert.ok(exhausted.reason instanceof AppError && exhausted.reason.status === 402);

    await store.commitQuota(jobs[0].userId, jobs[0].project.id, jobs[0].job.id);
    await store.updateProject(jobs[0].userId, jobs[0].project.id, (project) => {
      project.renders[0].status = "completed";
    });
    await store.releaseQuota(jobs[1].userId, jobs[1].project.id, jobs[1].job.id);
    await store.updateProject(jobs[1].userId, jobs[1].project.id, (project) => {
      project.renders[0].status = "failed";
    });
    const retry = await store.enqueue(jobs[1].userId, jobs[1].project.id, brief);
    assert.equal(retry.quotaUnits, 0);
    await store.commitQuota(jobs[1].userId, jobs[1].project.id, retry.id);
    await store.updateProject(jobs[1].userId, jobs[1].project.id, (project) => {
      project.renders.at(-1)!.status = "completed";
    });
    for (const { userId, project, job } of jobs.slice(2)) {
      await store.commitQuota(userId, project.id, job.id);
      await store.updateProject(userId, project.id, (data) => {
        data.renders[0].status = "completed";
      });
    }

    assert.deepEqual((await store.usage(sameIpUsers[1].id)).invitePromo, {
      limit: 5,
      completed: 5,
      reserved: 0,
      remaining: 0,
    });
    const sixthProject = await store.createProject(a.id, "第六个视频");
    await assert.rejects(
      store.enqueue(a.id, sixthProject.id, brief),
      (error: unknown) => error instanceof AppError && error.status === 402,
    );

    await assert.rejects(
      store.loginOfficial({ id: "new-official", email: "new@example.com" }),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
    const official = await store.loginOfficial(
      { id: "new-official", email: "new@example.com" },
      "kuma",
      "192.0.2.1",
    );
    assert.equal((await store.quota(official.id)).internalAvailableUnits, 0);
    const linkedExisting = await store.loginOfficial(
      { id: "official-a", email: "a@example.com" },
    );
    assert.equal(linkedExisting.id, a.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
