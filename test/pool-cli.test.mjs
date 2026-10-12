import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fundAccount } from "@red-cup-engineering/energy-bank/transfer";
import { createLedger } from "@red-cup-engineering/energy-bank/ledger";
import { admitPoolMember } from "../scripts/admit-pool-member.mjs";
import { derivePoolBarrierSeriesFromRequest } from "../scripts/derive-pool-barrier-series.mjs";
import { frontPoolDrawFromStore } from "../scripts/front-pool-draw.mjs";
import { settlePoolDrawFromStore } from "../scripts/settle-pool-draw.mjs";
import { reconcilePoolBooksFromStore } from "../scripts/reconcile-pool-books.mjs";
import { poolStatus } from "../apps/pool-cli.mjs";
import { ledgerAccountPath } from "../src/pool.mjs";
import { readStore, writeStore } from "../src/store.mjs";

/** Three-member pool fixture: alice and bob carry a seeded matched-tally history (a real
 *  member's first-ever draw needs one; a brand-new member's cold-start line is a named gap,
 *  not this fixture's claim), carol carries a large history to isolate the barrier refusal
 *  from the credit-line check. */
function fixture(dir) {
  const statePath = join(dir, "pool.json");
  let result = admitPoolMember(statePath, dir, { poolId: "tiyospaye", settlementWindowDays: 7, creditWindowDays: 90, poolHiveAccount: "pool-hive", account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount" });
  assert.equal(result.admitted, true);
  result = admitPoolMember(statePath, dir, { account: "pool:account-bob", hiveAccount: "bob-hive", ledgerPath: "/bob.beancount" });
  assert.equal(result.admitted, true);
  result = admitPoolMember(statePath, dir, { account: "pool:account-carol", hiveAccount: "carol-hive", ledgerPath: "/carol.beancount" });
  assert.equal(result.admitted, true);

  const document = readStore(statePath, null);
  const seedTallies = [
    { drawId: "seed:alice:1", memberAccount: "pool:account-alice", amount: "20", releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched" },
    { drawId: "seed:alice:2", memberAccount: "pool:account-alice", amount: "20", releasedAt: "2026-08-10T00:00:00Z", admittedAt: "2026-08-15T00:00:00Z", status: "matched" },
    { drawId: "seed:alice:3", memberAccount: "pool:account-alice", amount: "20", releasedAt: "2026-08-20T00:00:00Z", admittedAt: "2026-08-25T00:00:00Z", status: "matched" },
    { drawId: "seed:bob:1", memberAccount: "pool:account-bob", amount: "10", releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched" },
    { drawId: "seed:bob:2", memberAccount: "pool:account-bob", amount: "10", releasedAt: "2026-08-10T00:00:00Z", admittedAt: "2026-08-15T00:00:00Z", status: "matched" },
    { drawId: "seed:carol:1", memberAccount: "pool:account-carol", amount: "30", releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched" },
    { drawId: "seed:carol:2", memberAccount: "pool:account-carol", amount: "30", releasedAt: "2026-08-10T00:00:00Z", admittedAt: "2026-08-15T00:00:00Z", status: "matched" },
    { drawId: "seed:carol:3", memberAccount: "pool:account-carol", amount: "30", releasedAt: "2026-08-20T00:00:00Z", admittedAt: "2026-08-25T00:00:00Z", status: "matched" },
    { drawId: "seed:carol:4", memberAccount: "pool:account-carol", amount: "30", releasedAt: "2026-08-28T00:00:00Z", admittedAt: "2026-08-30T00:00:00Z", status: "matched" },
  ];

  // Fixture seed capital, via energy-bank's own `fundAccount` directly rather than a member
  // sleeve's `contribute-to-pool` -- this is the pool's own opening balance (an external
  // source funding the pool), not a member funding it from an existing sleeve balance.
  const ledger = createLedger([]);
  fundAccount(ledger, "equity:seed-capital", document.pool.account, "200", "HBD", "seed-1", "2026-08-01");
  writeStore(statePath, { pool: { ...document.pool, ledger: { entries: ledger.all() } }, tallies: seedTallies, draws: [] });

  const barrierSeries = derivePoolBarrierSeriesFromRequest(
    {
      baseFloor: "20",
      leadDays: 10,
      obligations: [
        { memberAccount: "pool:account-alice", kind: "rent", dueDate: "2026-09-25", amount: "30" },
        { memberAccount: "pool:account-bob", kind: "rent", dueDate: "2026-09-25", amount: "30" },
        { memberAccount: "pool:account-carol", kind: "rent", dueDate: "2026-09-25", amount: "30" },
      ],
    },
    statePath,
  );
  return { statePath, barrierSeries };
}

test("Base-only membership is admitted but an HBD draw refuses before ledger mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-base-only-"));
  const statePath = join(dir, "pool.json");
  const admission = admitPoolMember(statePath, dir, {
    poolId: "tiyospaye",
    settlementWindowDays: 7,
    creditWindowDays: 90,
    account: "pool:account-base",
    settlementDestinations: [{ rail: "base", address: "0xabc" }],
    ledgerWitness: {
      kind: "content-addressed-postings",
      recordNi: "ni:///sha-256;abc",
      provider: "member-store",
      subject: "ledger:base",
    },
  });
  assert.equal(admission.admitted, true);
  const before = readFileSync(statePath, "utf8");
  const draw = frontPoolDrawFromStore(statePath, dir, {
    account: "pool:account-base",
    amount: "1",
    feeAvoided: "1",
    inflowDate: "2026-10-03",
    dueDate: "2026-10-03",
    requestedAt: "2026-10-02T23:00:00Z",
  });
  assert.equal(draw.admitted, false);
  assert.match(draw.reason, /no Hive settlement destination/);
  assert.equal(readFileSync(statePath, "utf8"), before);
});

test("dry paper cycle: fronted-and-settled, past-due mismatch, and a barrier refusal", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-dry-cycle-"));
  const { statePath } = fixture(dir);

  // 1. Alice draws against her seeded line (60), settles on time -- the tally matches.
  const aliceDraw = frontPoolDrawFromStore(statePath, dir, {
    account: "pool:account-alice",
    amount: "15",
    feeAvoided: "5",
    inflowDate: "2026-09-06",
    dueDate: "2026-09-06",
    requestedAt: "2026-09-01T12:00:00Z",
  });
  assert.equal(aliceDraw.admitted, true);
  assert.equal(aliceDraw.price, "5");
  assert.equal(aliceDraw.transferIntent.paper, true);
  assert.equal(aliceDraw.transferIntent.operation[1].to, "alice-hive");

  const aliceSettle = settlePoolDrawFromStore(statePath, dir, { drawId: aliceDraw.drawId, admittedAt: "2026-09-05T09:00:00Z" });
  assert.equal(aliceSettle.settled, true);
  assert.equal(aliceSettle.tally.status, "matched");

  // 2. Bob draws against his seeded line (20), never settles -- past due, a mismatch is held.
  const bobDraw = frontPoolDrawFromStore(statePath, dir, {
    account: "pool:account-bob",
    amount: "10",
    feeAvoided: "4",
    inflowDate: "2026-09-04",
    dueDate: "2026-09-04",
    requestedAt: "2026-09-01T12:00:00Z",
  });
  assert.equal(bobDraw.admitted, true);

  // 3. Carol's line (120) is ample, but the pool's balance would cross the barrier before her
  //    due date -- refused on the barrier, not the credit line.
  const carolDraw = frontPoolDrawFromStore(statePath, dir, {
    account: "pool:account-carol",
    amount: "100",
    feeAvoided: "6",
    inflowDate: "2026-09-20",
    dueDate: "2026-09-20",
    requestedAt: "2026-09-01T12:00:00Z",
  });
  assert.equal(carolDraw.admitted, false);
  assert.match(carolDraw.reason, /barrier/);

  // The FOUR verdict for bob's overdue draw: a mismatch held, never an eviction, and his line
  // recomputes to reflect it.
  const status = poolStatus(statePath, "2026-09-12T00:00:00Z");
  assert.equal(status.mismatches.length, 1);
  assert.equal(status.mismatches[0].verdict, "mismatch-held");
  assert.equal(status.mismatches[0].evictable, false);
  assert.equal(status.mismatches[0].memberAccount, "pool:account-bob");
  assert.equal(status.mismatches[0].recomputedLine.factor, 0);
  assert.deepEqual(status.members[0].settlementDestinations, [{ rail: "hive", account: "alice-hive" }]);
  assert.equal(Object.hasOwn(status.members[0], "hiveAccount"), false);
  assert.equal(JSON.stringify(status.members).includes("ledgerWitness"), false);

  // The two-witness reconciliation reading over alice's settled draw: her own declared ledger
  // agrees on the release, is missing the settlement posting (posted-only), and asserts one
  // posting the pool never recorded (asserted-only) -- unknown never folded into "agreed".
  const account = ledgerAccountPath("pool:account-alice");
  const memberLedgerPath = join(dir, "alice-ledger.json");
  writeFileSync(memberLedgerPath, JSON.stringify({
    postings: [
      { date: "2026-09-01", ref: aliceDraw.drawId, account, amount: "15", commodity: "HBD" },
      { date: "2026-09-12", ref: "alice-claims-a-refund", account, amount: "-2", commodity: "HBD" },
    ],
  }));
  const reconciliation = reconcilePoolBooksFromStore(statePath, memberLedgerPath, dir, "pool:account-alice", "2026-09-12T00:00:00Z");
  assert.equal(reconciliation.agreed.length, 1);
  assert.equal(reconciliation.postedOnly.length, 1); // the settlement posting, absent from alice's declared ledger
  assert.equal(reconciliation.assertedOnly.length, 1); // alice's claimed posting, absent from the pool's ledger
  assert.equal(reconciliation.mismatch.length, 0);

  console.log("DRY PAPER CYCLE OUTPUT:");
  console.log(JSON.stringify({ aliceDraw, aliceSettle, bobDraw, carolDraw, status, reconciliation }, null, 2));
});
