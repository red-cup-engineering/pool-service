import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPool,
  admitMember,
  derivePoolBarrierSeries,
  barrierAt,
  deriveMemberCreditLine,
  frontPoolDraw,
  settlePoolDraw,
  verdictForOverdueDraw,
  reconcilePoolBooks,
  ledgerAccountPath,
} from "../src/pool.mjs";

test("createPool refuses a non-positive settlement window", () => {
  assert.throws(() => createPool({ id: "t", settlementWindowDays: 0 }), TypeError);
});

test("admitMember refuses a duplicate account", () => {
  const pool = createPool({ id: "t", settlementWindowDays: 7 });
  const first = admitMember(pool, { account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount" });
  assert.equal(first.admitted, true);
  const second = admitMember(first.pool, { account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount" });
  assert.equal(second.admitted, false);
});

test("derivePoolBarrierSeries rises where obligations cluster and falls back after", () => {
  const series = derivePoolBarrierSeries({
    baseFloor: "20",
    leadDays: 10,
    obligations: [
      { memberAccount: "a", kind: "rent", dueDate: "2026-09-25", amount: "30" },
      { memberAccount: "b", kind: "rent", dueDate: "2026-09-25", amount: "30" },
      { memberAccount: "c", kind: "rent", dueDate: "2026-09-25", amount: "30" },
    ],
  });
  assert.equal(barrierAt(series, "2026-09-01", "20"), "20");
  assert.equal(barrierAt(series, "2026-09-20", "20"), "110");
  assert.equal(barrierAt(series, "2026-09-30", "20"), "20");
});

test("deriveMemberCreditLine: limit is matched pairs times median, zero factor on a stale half-tally", () => {
  const tallies = [
    { drawId: "d1", memberAccount: "m", amount: "20", releasedAt: "2026-08-01", admittedAt: "2026-08-05", status: "matched" },
    { drawId: "d2", memberAccount: "m", amount: "20", releasedAt: "2026-08-10", admittedAt: "2026-08-15", status: "matched" },
    { drawId: "d3", memberAccount: "m", amount: "20", releasedAt: "2026-08-20", admittedAt: "2026-08-25", status: "matched" },
  ];
  const fresh = deriveMemberCreditLine({ tallies, memberAccount: "m", settlementWindowDays: 7, creditWindowDays: 90, now: "2026-09-01T00:00:00Z" });
  assert.equal(fresh.limit, "60");
  assert.equal(fresh.factor, 1);

  const withStale = [...tallies, { drawId: "d4", memberAccount: "m", amount: "50", releasedAt: "2026-08-01", admittedAt: null, status: "open" }];
  const stale = deriveMemberCreditLine({ tallies: withStale, memberAccount: "m", settlementWindowDays: 7, creditWindowDays: 90, now: "2026-09-01T00:00:00Z" });
  assert.equal(stale.factor, 0);
  assert.equal(stale.limit, "0");
});

test("frontPoolDraw refuses an unknown fee, an over-limit draw, and a barrier crossing", () => {
  const pool = { ...createPool({ id: "t", settlementWindowDays: 7 }), barrierSeries: [{ date: "2026-09-01", amount: "50" }] };
  const standing = { limit: "20" };
  const base = { pool, standing, memberAccount: "m", inflowDate: "2026-09-02", dueDate: "2026-09-02", poolBalance: "100", requestedAt: "2026-09-01T00:00:00Z" };

  assert.equal(frontPoolDraw({ ...base, amount: "10", feeAvoided: null }).admitted, false);
  assert.equal(frontPoolDraw({ ...base, amount: "30", feeAvoided: "5" }).admitted, false);

  const barrierCase = frontPoolDraw({ ...base, amount: "10", feeAvoided: "5", poolBalance: "55" });
  assert.equal(barrierCase.admitted, false);
  assert.match(barrierCase.reason, /barrier/);

  const ok = frontPoolDraw({ ...base, amount: "10", feeAvoided: "5" });
  assert.equal(ok.admitted, true);
  assert.equal(ok.price, "5");
});

test("verdictForOverdueDraw holds a mismatch, never an eviction", () => {
  const pool = createPool({ id: "t", settlementWindowDays: 7, creditWindowDays: 90 });
  const draw = { drawId: "d1", memberAccount: "m", amount: "10", releasedAt: "2026-08-01T00:00:00Z" };
  const tallies = [{ drawId: "d1", memberAccount: "m", amount: "10", releasedAt: "2026-08-01T00:00:00Z", admittedAt: null, status: "open" }];
  const verdict = verdictForOverdueDraw({ draw, pool, tallies, now: "2026-09-01T00:00:00Z" });
  assert.equal(verdict.verdict, "mismatch-held");
  assert.equal(verdict.evictable, false);
  assert.equal(verdict.recomputedLine.factor, 0);
});

test("reconcilePoolBooks names agreed, mismatch, posted-only, and asserted-only -- unknown never zero", () => {
  const account = ledgerAccountPath("pool:account-alice");
  const poolPostings = [
    { date: "2026-09-01", ref: "r1", account, amount: "15", commodity: "HBD" },
    { date: "2026-09-06", ref: "r2", account, amount: "-20", commodity: "HBD" },
  ];
  const memberPostings = [
    { date: "2026-09-01", ref: "r1", account, amount: "15", commodity: "HBD" }, // agreed
    { date: "2026-09-06", ref: "r2", account, amount: "-19", commodity: "HBD" }, // mismatch
    { date: "2026-09-10", ref: "r3", account, amount: "-1", commodity: "HBD" }, // asserted-only
  ];
  const verdict = reconcilePoolBooks({ poolPostings, memberPostings, memberAccount: account });
  assert.equal(verdict.agreed.length, 1);
  assert.equal(verdict.mismatch.length, 1);
  assert.equal(verdict.postedOnly.length, 0);
  assert.equal(verdict.assertedOnly.length, 1);
});
