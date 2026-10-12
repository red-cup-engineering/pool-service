import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDirectedYieldReceipts } from "../src/directed-yield-receipts.mjs";

const A = { memberAccount: "pool:a", amount: "40.00", commodity: "USDC", observedAt: "2026-10-01T00:00:00Z", txHash: "0xa" };
const B = { memberAccount: "pool:b", amount: "60", commodity: "USDC", observedAt: "2026-10-01T00:01:00Z", txHash: "0xb" };

test("directed-yield receipt evidence is order-independent and commits to the full normalized set", () => {
  const left = normalizeDirectedYieldReceipts([A, B]);
  const right = normalizeDirectedYieldReceipts([B, A]);
  assert.equal(left.totalYield, "100");
  assert.equal(left.commodity, "USDC");
  assert.equal(left.receiptCount, 2);
  assert.equal(left.observedThrough, "2026-10-01T00:01:00Z");
  assert.equal(left.evidenceNi, right.evidenceNi);
  assert.deepEqual(left.receipts, right.receipts);

  const sameTotalDifferentEvidence = normalizeDirectedYieldReceipts([
    { memberAccount: "pool:c", amount: "100", commodity: "USDC", observedAt: "2026-10-01T00:02:00Z", txHash: "0xc" },
  ]);
  assert.equal(sameTotalDifferentEvidence.totalYield, left.totalYield);
  assert.notEqual(sameTotalDifferentEvidence.evidenceNi, left.evidenceNi);
});

test("directed-yield receipt evidence refuses duplicates, nonpositive amounts, and mixed commodities", () => {
  assert.throws(() => normalizeDirectedYieldReceipts([A, A]), /duplicate receipt identity/u);
  assert.throws(() => normalizeDirectedYieldReceipts([{ ...A, amount: "0" }]), /amount must be positive/u);
  assert.throws(() => normalizeDirectedYieldReceipts([{ ...A, amount: "-1" }]), /amount must be positive/u);
  assert.throws(() => normalizeDirectedYieldReceipts([
    A,
    { ...B, commodity: "HBD" },
  ]), /does not match "USDC"/u);
});

test("directed-yield receipt evidence normalizes exact decimal spellings", () => {
  const evidence = normalizeDirectedYieldReceipts([
    { memberAccount: "pool:a", amount: "040.000", commodity: "USDC", observedAt: "2026-10-01T00:00:00Z", txHash: "0xa" },
    B,
  ]);
  assert.equal(evidence.totalYield, "100");
  assert.equal(evidence.receipts.find((receipt) => receipt.txHash === "0xa").amount, "40");
});


test("directed-yield receipt evidence chooses observedThrough by instant rather than timestamp spelling", () => {
  const evidence = normalizeDirectedYieldReceipts([
    { memberAccount: "pool:a", amount: "40", commodity: "USDC", observedAt: "2026-10-01T01:00:00+02:00", txHash: "0xa-time" },
    { memberAccount: "pool:b", amount: "60", commodity: "USDC", observedAt: "2026-10-01T00:30:00Z", txHash: "0xb-time" },
  ]);
  assert.equal(evidence.observedThrough, "2026-10-01T00:30:00Z");
});
