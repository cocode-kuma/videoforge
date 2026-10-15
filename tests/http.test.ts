import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { Director } from "../plugins/cocode-director/index.js";
import {
  createApp,
  isRequestOriginAllowed,
} from "../plugins/cocode-studio-ui/index.js";
import { readConfig } from "../shared/config.js";

test("CSRF origin validation supports only local development aliases", () => {
  assert.equal(
    isRequestOriginAllowed(
      "http://127.0.0.1:3088",
      "http://localhost:3088",
      true,
    ),
    true,
  );
  assert.equal(
    isRequestOriginAllowed(
      "http://localhost:3089",
      "http://localhost:3088",
      true,
    ),
    false,
  );
  assert.equal(
    isRequestOriginAllowed(
      "http://localhost.attacker.example:3088",
      "http://localhost:3088",
      true,
    ),
    false,
  );
  assert.equal(
    isRequestOriginAllowed(
      "http://127.0.0.1:3088",
      "http://localhost:3088",
      false,
    ),
    false,
  );
});

test("HTTP auth, CSRF, IDOR, routes and private byte-range playback", async () => {
  const root = await mkdtemp(join(tmpdir(), "cocode-http-"));
  const store = new DataStore({
    ...readConfig(root),
    origin: "http://localhost:3088",
    apiKey: "",
  });
  await store.init();
  const director = new Director(store),
    server = createApp(store, director).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  store.config.origin = `http://localhost:${(server.address() as { port: number }).port}`;
  const request = (path: string, method = "GET", body?: unknown, cookie = "") =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: store.config.origin,
        "X-Cocode-Request": "studio",
        Cookie: cookie,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const canonicalPage = await fetch(base + "/", {
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    assert.equal(canonicalPage.status, 302);
    assert.equal(canonicalPage.headers.get("location"), store.config.origin + "/");
    const invalidCallback = await fetch(
      base + "/api/auth/official/callback?code=unused&state=missing",
      { redirect: "manual" },
    );
    assert.equal(invalidCallback.status, 302);
    assert.equal(
      invalidCallback.headers.get("location"),
      "/login?official_error=state",
    );
    assert.equal((await request("/api/projects")).status, 401);
    const csrf = await fetch(base + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "csrf@example.com",
        name: "bad",
        password: "long-password",
      }),
    });
    assert.equal(csrf.status, 403);
    const invalidInvite = await request("/api/auth/register", "POST", {
      email: "invalid@example.com",
      name: "Invalid",
      password: "long-password-invalid",
      inviteCode: "wrong",
    });
    assert.equal(invalidInvite.status, 403);
    const reg = await request("/api/auth/register", "POST", {
        email: "a@example.com",
        name: "A",
        password: "long-password-A",
        inviteCode: "kuma",
    });
    assert.equal(reg.status, 201);
    const cookie = reg.headers.get("set-cookie")!.split(";")[0],
      a = await reg.json();
    assert.ok(reg.headers.get("set-cookie")!.includes("HttpOnly"));
    const regB = await request("/api/auth/register", "POST", {
        email: "b@example.com",
        name: "B",
        password: "long-password-B",
        inviteCode: "kuma",
      }),
      cookieB = regB.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await (await request("/api/usage", "GET", undefined, cookie)).json()).internalAvailableUnits, 0);
    assert.equal((await (await request("/api/usage", "GET", undefined, cookie)).json()).invitePromo.remaining, 5);
    assert.equal((await (await request("/api/usage", "GET", undefined, cookieB)).json()).invitePromo.remaining, 5);
    const p = await (
      await request("/api/projects", "POST", { name: "private" }, cookie)
    ).json();
    for (const method of ["GET", "PATCH", "DELETE"])
      assert.equal(
        (
          await request(
            "/api/projects/" + p.id,
            method,
            method === "PATCH" ? { name: "stolen" } : undefined,
            cookieB,
          )
        ).status,
        404,
      );
    const gen = await request(
      `/api/projects/${p.id}/generate`,
      "POST",
      {
        prompt: "make a video",
        duration: 15,
        aspect: "16:9",
        style: "minimal",
      },
      cookie,
    );
    assert.equal(gen.status, 503);
    for (const route of [
      "/plugins",
      "/settings",
      "/marketplace",
      "/api/settings",
      "/api/plugins",
    ])
      assert.equal(
        (await request(route, "GET", undefined, cookie)).status,
        404,
      );
    const jobId = randomUUID(),
      dir = join(await store.projectDir(a.id, p.id), "renders", jobId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "final.mp4"), Buffer.alloc(4096, 42));
    await mkdir(join(dir,'workspace/.harness'),{recursive:true});
    await writeFile(join(dir,'workspace/art.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(dir,'workspace/.harness/checkpoint.json'),'private context');
    await store.updateProject(a.id, p.id, (p) =>
      p.renders.push({
        id: jobId,
        status: "completed",
        generationMode:'harness',
        progress: 100,
        message: "ready",
        createdAt: new Date().toISOString(),
        video: `renders/${jobId}/final.mp4`,
      }),
    );
    const videoPath = `/api/projects/${p.id}/video/${jobId}`;
    assert.equal((await request(videoPath)).status, 401);
    assert.equal(
      (await request(videoPath, "GET", undefined, cookieB)).status,
      404,
    );
    const range = await fetch(base + videoPath, {
      headers: { Cookie: cookie, Range: "bytes=0-99" },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    const artifactPath=`/api/projects/${p.id}/jobs/${jobId}/artifact?path=`;
    assert.equal((await request(artifactPath+'art.svg','GET',undefined,cookieB)).status,404);
    assert.equal((await request(artifactPath+'.harness/checkpoint.json','GET',undefined,cookie)).status,404);
    assert.equal((await request(artifactPath+'../final.mp4','GET',undefined,cookie)).status,404);
    const svg=await request(artifactPath+'art.svg','GET',undefined,cookie);assert.equal(svg.status,200);assert.ok(svg.headers.get('content-security-policy')?.includes('sandbox'));await svg.text();
    const source=await request(`/api/projects/${p.id}/jobs/${jobId}/source`,'GET',undefined,cookie);assert.equal(source.status,200);assert.ok((await source.arrayBuffer()).byteLength>0);
    await request("/api/auth/logout", "POST", {}, cookie);
    assert.equal(
      (await request("/api/auth/me", "GET", undefined, cookie)).status,
      401,
    );
  } finally {
    await director.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
