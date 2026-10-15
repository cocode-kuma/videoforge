import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { parse } from "yaml";
const expected = ["cocode-data-store", "cocode-director", "cocode-studio-ui"];
export function validatePatch(content) {
  const rows = parse(content);
  assert.deepEqual(
    rows.flatMap((r) => r.insert ?? []).map((r) => r.name),
    expected,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].insert.length, 3);
  for (const r of rows[0].insert) {
    assert.equal(r.name, r.id);
    assert.deepEqual(Object.keys(r).sort(), ["id", "name"]);
  }
}
validatePatch(await readFile("cordis.patch.yml", "utf8"));
// Self-tests ensure the gate rejects extra built-in tools, missing rows, and config injection.
assert.throws(() =>
  validatePatch(
    '- insert:\n    - id: bash\n      name: "@deepseek-ai/dsh-tool-bash"\n',
  ),
);
assert.throws(() => validatePatch("[]"));
assert.throws(() =>
  validatePatch(
    ((awaitable) => awaitable)(
      `- insert:\n${expected.map((n) => `    - id: ${n}\n      name: ${n}\n      config: { unsafe: true }`).join("\n")}`,
    ),
  ),
);
for (const name of expected) {
  const p = JSON.parse(await readFile(`plugins/${name}/package.json`, "utf8"));
  assert.equal(p.name, name);
  assert.equal(p.main, "./lib/index.js");
}
console.log(
  "cocode 酷码工作室 · Cocode Studio VideoForge — 固定配置门禁及 3 个反例测试通过",
);
