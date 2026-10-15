import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataStore } from "../plugins/cocode-data-store/index.js";
import { Director } from "../plugins/cocode-director/index.js";
import { createApp } from "../plugins/cocode-studio-ui/index.js";
import { readConfig } from "../shared/config.js";

test("SSO invite is required only when creating a new official account", async () => {
  const root = await mkdtemp(join(tmpdir(), "cocode-sso-invite-"));
  const identityServer = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/api/authorize-url.php")) {
      const url = new URL(req.url, "http://localhost");
      res.end(JSON.stringify({ ok: true, authorize_url: `https://kuma2.cn/authorize?state=${url.searchParams.get("state")}` }));
    } else if (req.url === "/api/token.php") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const code = new URLSearchParams(body).get("code");
        res.end(JSON.stringify({ ok: true, access_token: code }));
      });
    } else if (req.url === "/api/userinfo.php") {
      const code = req.headers.authorization?.replace("Bearer ", "");
      const profile = code === "uninvited"
        ? { id: 99, email: "new@example.com", nickname: "New" }
        : { id: 12, email: "existing@example.com", nickname: "Existing" };
      res.end(JSON.stringify({ ok: true, user: profile }));
    } else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => identityServer.listen(0, "127.0.0.1", resolve));
  const identityAddress = identityServer.address();
  if (!identityAddress || typeof identityAddress === "string") throw new Error("SSO mock failed to start");
  const store = new DataStore({
    ...readConfig(root),
    origin: "http://localhost:3088",
    officialSsoIssuer: `http://127.0.0.1:${identityAddress.port}`,
    officialSsoClientId: "capp_test",
    officialSsoClientSecret: "secret-test",
    officialSsoRedirectUri: "http://localhost:3088/api/auth/official/callback",
  });
  await store.init();
  const director = new Director(store);
  const appServer = createApp(store, director).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  const address = appServer.address();
  if (!address || typeof address === "string") throw new Error("app mock failed to start");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const begin = async (inviteCode: string) => {
      const response = await fetch(`${base}/api/auth/official/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: store.config.origin,
          "X-Cocode-Request": "studio",
        },
        body: JSON.stringify({ inviteCode }),
      });
      assert.equal(response.status, 200);
      const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]);
      const state = cookies.find((value) => value.startsWith("cocode_official_sso_state="))?.split("=")[1];
      assert.ok(state);
      return { state, cookie: cookies.join("; ") };
    };
    const finish = (state: string, cookie: string, code: string) =>
      fetch(`${base}/api/auth/official/callback?code=${code}&state=${state}`, {
        headers: { Cookie: cookie },
        redirect: "manual",
      });

    const first = await begin("kuma");
    const created = await finish(first.state, first.cookie, "existing");
    assert.equal(created.status, 302);
    assert.equal(created.headers.get("location"), "/studio?official=1");
    assert.ok(created.headers.getSetCookie().some((value) => value.startsWith("cocode_session=")));
    const accounts = JSON.parse(await readFile(join(root, "video_projects/users.json"), "utf8"));
    const createdAccount = accounts.users.find((user: { officialId?: string }) => user.officialId === "12");
    const workspace = accounts.workspaces.find((item: { ownerId: string }) => item.ownerId === createdAccount.id);
    assert.equal(accounts.quotaWallets[workspace.id].granted, 0);

    const existing = await begin("");
    const loggedIn = await finish(existing.state, existing.cookie, "existing");
    assert.equal(loggedIn.status, 302);
    assert.equal(loggedIn.headers.get("location"), "/studio?official=1");

    const missingInvite = await begin("");
    const denied = await finish(missingInvite.state, missingInvite.cookie, "uninvited");
    assert.equal(denied.status, 302);
    assert.equal(denied.headers.get("location"), "/login?official_error=invite");
  } finally {
    await director.dispose();
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
    await new Promise<void>((resolve) => identityServer.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
