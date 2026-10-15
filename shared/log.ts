import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND } from "./contracts.js";
export async function log(
  root: string,
  event: string,
  details: Record<string, unknown> = {},
) {
  const entry = JSON.stringify({
    time: new Date().toISOString(),
    brand: BRAND,
    event,
    ...details,
  });
  console.log(`[${BRAND}] ${event}`);
  await mkdir(root, { recursive: true });
  await appendFile(
    join(root, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    entry + "\n",
    { mode: 0o600 },
  );
}
