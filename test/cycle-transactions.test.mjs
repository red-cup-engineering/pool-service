import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSetOfPoolCycleTransactions } from "../src/cycle-transactions.mjs";
import { deriveSetOfPoolCycleTransactionsFromStore } from "../scripts/derive-set-of-pool-cycle-transactions.mjs";
import { normalizeDirectedYieldReceipts } from "../src/directed-yield-receipts.mjs";
import { writeStore } from "../src/store.mjs";

const RECEIPTS = [
  { memberAccount: "pool:account-org", amount: "100", commodity: "USDC", observedAt: "2026-09-01T00:00:00Z", txHash: "0xabc" },
];
const RECEIPT_EVIDENCE = normalizeDirectedYieldReceipts(RECEIPTS);

const SPLIT = Object.freeze({
  cycleId: "2026-09-cycle-1", commodity: "USDC", totalYield: "100", reserve: "20", float: "30", distributable: "50",
  fixedPortion: "25", votedPortion: "25",
  yieldEvidence: Object.freeze({
    recordNi: RECEIPT_EVIDENCE.evidenceNi,
    receiptCount: RECEIPT_EVIDENCE.receiptCount,
    observedThrough: RECEIPT_EVIDENCE.observedThrough,
  }),
  perEnterprise: [
    { enterpriseId: "ent-1", fixed: "12.5", voted: "12.5", total: "25" },
    { enterpriseId: "ent-2", fixed: "12.5", voted: "12.5", total: "25" },
  ],
});

test("deriveSetOfPoolCycleTransactions: books the receipt, the float designation, and one distribution per enterprise", () => {
  const result = deriveSetOfPoolCycleTransactions({
    split: SPLIT, directedYieldReceipts: RECEIPTS, receivedAt: "2026-09-01T00:00:00Z", distributedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.derived, true);
  assert.equal(result.transactionCount, 4); // receipt + designation + 2 enterprise distributions
  const kinds = result.transactions.map((t) => t.kind);
  assert.deepEqual(kinds, ["directed-yield-receipt", "float-designation", "enterprise-distribution", "enterprise-distribution"]);

  const receipt = result.transactions[0];
  assert.match(receipt.directive, /Assets:Digital-Assets:EVM:Base:Pool:Barrier-Reserve\s+20 USDC/);
  assert.match(receipt.directive, /Assets:Digital-Assets:EVM:Base:Pool:Float\s+30 USDC/);
  assert.match(receipt.directive, /Assets:Digital-Assets:EVM:Base:Pool:Distributable-Pending\s+50 USDC/);
  assert.match(receipt.directive, /Income:Pool:Directed-Yield\s+-100 USDC/);

  const designation = result.transactions[1];
  assert.match(designation.directive, /Equity:Pool:Designated-Reserves\s+30 USDC/);
  assert.match(designation.directive, /Liabilities:Pool:Member-Float\s+-30 USDC/);

  const ent1 = result.transactions.find((t) => t.kind === "enterprise-distribution" && t.enterpriseId === "ent-1");
  assert.match(ent1.directive, /Expenses:Pool:Enterprise-Distributions:Ent-1\s+25 USDC/);
  assert.match(ent1.directive, /Assets:Digital-Assets:EVM:Base:Pool:Distributable-Pending\s+-25 USDC/);

  assert.ok(result.accountsToOpen.some((a) => a.account === "Income:Pool:Directed-Yield"));
  assert.ok(result.accountsToOpen.some((a) => a.account === "Expenses:Pool:Enterprise-Distributions:Ent-2"));
});

test("deriveSetOfPoolCycleTransactions: books draw fee income when settled draws are named", () => {
  const result = deriveSetOfPoolCycleTransactions({
    split: SPLIT, directedYieldReceipts: RECEIPTS, receivedAt: "2026-09-01T00:00:00Z", distributedAt: "2026-09-05T00:00:00Z",
    drawFees: [{ drawId: "draw:1", memberAccount: "pool:account-alice", amount: "2", commodity: "HBD", settledAt: "2026-09-03T00:00:00Z" }],
  });
  const fee = result.transactions.find((t) => t.kind === "draw-fee-income");
  assert.ok(fee);
  assert.match(fee.directive, /Assets:Digital-Assets:Hive:Custody:Pool\s+2 HBD/);
  assert.match(fee.directive, /Income:Pool:Draw-Fee\s+-2 HBD/);
});

test("deriveSetOfPoolCycleTransactions: refuses when receipts do not sum to the split's totalYield", () => {
  const result = deriveSetOfPoolCycleTransactions({
    split: SPLIT, directedYieldReceipts: [{ memberAccount: "pool:account-org", amount: "99", commodity: "USDC", observedAt: "2026-09-01T00:00:00Z" }],
    receivedAt: "2026-09-01T00:00:00Z", distributedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.derived, false);
  assert.match(result.reason, /does not (equal split\.totalYield|match split\.yieldEvidence)/);
});

test("deriveSetOfPoolCycleTransactions: openAccounts already-open are not re-opened", () => {
  const result = deriveSetOfPoolCycleTransactions({
    split: SPLIT, directedYieldReceipts: RECEIPTS, receivedAt: "2026-09-01T00:00:00Z", distributedAt: "2026-09-05T00:00:00Z",
    openAccounts: ["Income:Pool:Directed-Yield"],
  });
  assert.equal(result.accountsToOpen.some((a) => a.account === "Income:Pool:Directed-Yield"), false);
});


test("deriveSetOfPoolCycleTransactionsFromStore: refuses booking the same cycle twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-cycle-booking-"));
  const statePath = join(dir, "pool.json");
  const sidecarPath = join(dir, "cycle.beancount");
  writeStore(statePath, { pool: { id: "t" }, cycleSplits: [SPLIT] });
  const request = {
    cycleId: SPLIT.cycleId,
    directedYieldReceipts: RECEIPTS,
    receivedAt: "2026-09-01T00:00:00Z",
    distributedAt: "2026-09-05T00:00:00Z",
    recordedAt: "2026-09-05T00:01:00Z",
  };
  const first = deriveSetOfPoolCycleTransactionsFromStore(statePath, dir, request, { sidecarPath });
  assert.equal(first.booked, true);
  const second = deriveSetOfPoolCycleTransactionsFromStore(statePath, dir, request, { sidecarPath });
  assert.equal(second.booked, false);
  assert.match(second.reason, /already booked/);
});


test("deriveSetOfPoolCycleTransactions: refuses a different receipt set even when the total is equal", () => {
  const result = deriveSetOfPoolCycleTransactions({
    split: SPLIT,
    directedYieldReceipts: [
      { memberAccount: "pool:account-other", amount: "100", commodity: "USDC", observedAt: "2026-09-01T00:00:00Z", txHash: "0xdef" },
    ],
    receivedAt: "2026-09-01T00:00:00Z",
    distributedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.derived, false);
  assert.match(result.reason, /does not match split\.yieldEvidence\.recordNi/u);
});

test("deriveSetOfPoolCycleTransactions: refuses assertion-only legacy split without receipt evidence", () => {
  const { yieldEvidence, ...legacySplit } = SPLIT;
  const result = deriveSetOfPoolCycleTransactions({
    split: legacySplit,
    directedYieldReceipts: RECEIPTS,
    receivedAt: "2026-09-01T00:00:00Z",
    distributedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.derived, false);
  assert.match(result.reason, /no directed-yield receipt evidence identity/u);
});


test("deriveSetOfPoolCycleTransactions: canonical receipt order makes booking output order-independent", () => {
  const receipts = [
    { memberAccount: "pool:b", amount: "60", commodity: "USDC", observedAt: "2026-09-01T00:01:00Z", txHash: "0xb" },
    { memberAccount: "pool:a", amount: "40", commodity: "USDC", observedAt: "2026-09-01T00:00:00Z", txHash: "0xa" },
  ];
  const evidence = normalizeDirectedYieldReceipts(receipts);
  const split = {
    ...SPLIT,
    yieldEvidence: {
      recordNi: evidence.evidenceNi,
      receiptCount: evidence.receiptCount,
      observedThrough: evidence.observedThrough,
    },
  };
  const forward = deriveSetOfPoolCycleTransactions({
    split,
    directedYieldReceipts: receipts,
    receivedAt: "2026-09-01T00:02:00Z",
    distributedAt: "2026-09-05T00:00:00Z",
  });
  const reverse = deriveSetOfPoolCycleTransactions({
    split,
    directedYieldReceipts: [...receipts].reverse(),
    receivedAt: "2026-09-01T00:02:00Z",
    distributedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(forward.derived, true);
  assert.equal(reverse.derived, true);
  assert.deepEqual(forward, reverse);
  assert.match(forward.transactions[0].directive, /receipts: "0xa,0xb"/u);
});
