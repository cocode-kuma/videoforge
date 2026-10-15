import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { OfficialSsoClient } from "../shared/official-sso.js";
import { AppError } from "../shared/contracts.js";

test("official SSO client follows the documented authorization-code flow", async () => {
  let tokenBody = "";
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/authorize-url.php")) {
      const url = new URL(`http://localhost${req.url}`);
      assert.equal(url.searchParams.get("client_id"), "capp_test");
      assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3088/api/auth/official/callback");
      assert.equal(url.searchParams.get("state"), "state-test");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, authorize_url: "https://kuma2.cn/account/authorize?state=state-test" }));
      return;
    }
    if (req.url === "/api/token.php") {
      for await (const chunk of req) tokenBody += chunk;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, access_token: "access-test", token_type: "Bearer", expires_in: 600 }));
      return;
    }
    if (req.url === "/api/userinfo.php") {
      assert.equal(req.headers.authorization, "Bearer access-test");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, user: { id: 12, email: "user@example.com", nickname: "小码" } }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务未启动");
  try {
    const client = new OfficialSsoClient({
      officialSsoIssuer: `http://127.0.0.1:${address.port}`,
      officialSsoClientId: "capp_test",
      officialSsoClientSecret: "secret-test",
      officialSsoRedirectUri: "http://localhost:3088/api/auth/official/callback",
      officialQuotaTimeout: 1000,
    } as never);
    const url = await client.getAuthorizeUrl("state-test");
    assert.match(url, /authorize/);
    const token = await client.exchangeCode("code-test");
    assert.equal(token.access_token, "access-test");
    assert.match(tokenBody, /client_id=capp_test/);
    assert.match(tokenBody, /client_secret=secret-test/);
    const profile = await client.userInfo(token.access_token);
    assert.deepEqual(profile, { id: 12, email: "user@example.com", nickname: "小码" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("official SSO exposes only allowlisted provider error codes", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_grant", detail: "must-not-leak" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务未启动");
  try {
    const client = new OfficialSsoClient({
      officialSsoIssuer: `http://127.0.0.1:${address.port}`,
      officialSsoClientId: "capp_test",
      officialSsoClientSecret: "secret-test",
      officialSsoRedirectUri: "http://localhost:3088/api/auth/official/callback",
      officialQuotaTimeout: 1000,
    } as never);
    await assert.rejects(
      client.exchangeCode("code-test"),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.match(error.message, /400：invalid_grant/);
        assert.doesNotMatch(error.message, /must-not-leak|secret-test|code-test/);
        return true;
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
