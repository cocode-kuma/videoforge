import assert from "node:assert/strict";
import { test } from "node:test";
import { billingCatalog, calculateTokenCredits } from "../shared/billing.js";

test("billing estimate uses the normalized V1.5 formula", () => {
  assert.equal(calculateTokenCredits(20_000, 2.5), 50);
  assert.equal(calculateTokenCredits(100_000, 2.5), 250);
  assert.equal(billingCatalog.minimumCharge, 50);
});
