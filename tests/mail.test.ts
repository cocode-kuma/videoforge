import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { MailRelayClient } from "../shared/mail.js";

test("mail relay sends the documented JSON payload without exposing the key", async () => {
  let authorization = "";
  let payload: Record<string, unknown> | undefined;
  const server = createServer(async (req, res) => {
    authorization = String(req.headers.authorization);
    let body = "";
    for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mail-test" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务未启动");
  try {
    const client = new MailRelayClient({
      mailApiUrl: `http://127.0.0.1:${address.port}/api/v1/messages`,
      mailApiKey: "secret-test-key",
      mailFrom: "cocodekuma@gmail.com",
      mailTimeout: 1000,
    } as never);
    const result = await client.send({
      to: ["user@example.com"],
      subject: "测试通知",
      text: "测试正文",
      replyTo: "reply@example.com",
    });
    assert.equal(result.accepted, true);
    assert.equal(authorization, "Bearer secret-test-key");
    assert.deepEqual(payload, {
      from: "reply@example.com",
      to: ["user@example.com"],
      subject: "测试通知",
      text: "测试正文",
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
