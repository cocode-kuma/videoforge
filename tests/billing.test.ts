import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billingCatalog,
  calculateTokenCredits,
  resolveModelCoefficient,
} from "../shared/billing.js";

test("V1.5 billing catalog and token formula", () => {
  assert.equal(billingCatalog.version, "V1.5");
  assert.equal(
    billingCatalog.packages.find((p) => p.name === "pro")?.credits,
    80_000,
  );
  assert.equal(resolveModelCoefficient("ds4.1flash"), 2.5);
  assert.equal(resolveModelCoefficient("kimi 2.8"), 20);
  assert.equal(resolveModelCoefficient("kimi k3"), null);
  assert.equal(calculateTokenCredits(1000, 2.5), 50);
  assert.equal(calculateTokenCredits(25_000, 2.5), 63);
  assert.equal(calculateTokenCredits(0, 20), 0);
});
