import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPool,
  admitMember,
  migrateLegacyMember,
  migrateLegacyPoolMembership,
  reconcilePoolBooks,
  ledgerAccountPath,
} from "../src/pool.mjs";
import {
  recordNiForBytes,
  resolveLedgerWitness,
} from "../src/ledger-witness.mjs";
import { writeStore } from "../src/store.mjs";
import { reconcilePoolBooksFromStore } from "../scripts/reconcile-pool-books.mjs";

const MEMBER_ACCOUNT = "pool:account-alice";
const POSTINGS = Object.freeze([
  Object.freeze({
    date: "2026-10-02",
    ref: "r1",
    account: ledgerAccountPath(MEMBER_ACCOUNT),
    amount: "12",
    commodity: "HBD",
  }),
]);
const BYTES = JSON.stringify({ postings: POSTINGS });
const RECORD_NI = recordNiForBytes(BYTES);
const WITNESS = Object.freeze({
  kind: "content-addressed-postings",
  recordNi: RECORD_NI,
  provider: "member-provider-a",
  subject: "ledger:alice",
});

test("membership v2 admits a Base-only member without inventing a Hive identity", () => {
  const pool = createPool({ id: "t", settlementWindowDays: 7 });
  const result = admitMember(pool, {
    account: "pool:account-alice",
    settlementDestinations: [{ rail: "base", address: "0xabc" }],
    ledgerWitness: WITNESS,
  });
  assert.equal(result.admitted, true);
  assert.deepEqual(result.pool.members[0].settlementDestinations, [{ rail: "base", address: "0xabc" }]);
  assert.equal(Object.hasOwn(result.pool.members[0], "hiveAccount"), false);
  assert.equal(Object.hasOwn(result.pool.members[0], "ledgerPath"), false);
});

test("membership v2 keeps Hive-only and Base+Hive settlement resources", () => {
  const pool = createPool({ id: "t", settlementWindowDays: 7 });
  const hive = admitMember(pool, {
    account: "pool:account-hive",
    settlementDestinations: [{ rail: "hive", account: "alice" }],
    ledgerWitness: WITNESS,
  });
  assert.equal(hive.admitted, true);
  assert.deepEqual(hive.pool.members[0].settlementDestinations, [{ rail: "hive", account: "alice" }]);

  const dual = admitMember(hive.pool, {
    account: "pool:account-dual",
    settlementDestinations: [
      { rail: "base", address: "0xdef" },
      { rail: "hive", account: "bob" },
    ],
    ledgerWitness: { ...WITNESS, subject: "ledger:bob" },
  });
  assert.equal(dual.admitted, true);
  assert.equal(dual.pool.members[1].settlementDestinations.length, 2);
});

test("two content providers yielding identical canonical postings produce identical reconciliation", () => {
  const witnessA = { ...WITNESS, provider: "provider-a" };
  const witnessB = { ...WITNESS, provider: "provider-b" };
  const a = resolveLedgerWitness(witnessA, { fetchContentAddressed: () => BYTES });
  const b = resolveLedgerWitness(witnessB, { fetchContentAddressed: () => BYTES });
  assert.equal(a.resolved, true);
  assert.equal(b.resolved, true);
  const verdictA = reconcilePoolBooks({ poolPostings: POSTINGS, memberPostings: a.postings });
  const verdictB = reconcilePoolBooks({ poolPostings: POSTINGS, memberPostings: b.postings });
  assert.deepEqual(verdictA, verdictB);
  assert.equal(verdictA.agreed.length, 1);
});

test("persisted v2 witness resolves into the existing reconciliation algebra", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-membership-v2-reconcile-"));
  const statePath = join(dir, "pool.json");
  const admitted = admitMember(createPool({ id: "t", settlementWindowDays: 7 }), {
    account: MEMBER_ACCOUNT,
    settlementDestinations: [{ rail: "base", address: "0xabc" }],
    ledgerWitness: WITNESS,
  });
  assert.equal(admitted.admitted, true);
  writeStore(statePath, {
    pool: admitted.pool,
    tallies: [],
    draws: [{
      drawId: "r1",
      memberAccount: MEMBER_ACCOUNT,
      amount: "12",
      requestedAt: "2026-10-02T12:00:00Z",
      status: "fronted",
    }],
  });

  const result = reconcilePoolBooksFromStore(
    statePath,
    null,
    dir,
    MEMBER_ACCOUNT,
    "2026-10-02T13:00:00Z",
    { fetchContentAddressed: () => BYTES },
  );
  assert.equal(result.reconciled, true);
  assert.equal(result.agreed.length, 1);
  assert.equal(result.mismatch.length, 0);
  assert.equal(result.postedOnly.length, 0);
  assert.equal(result.assertedOnly.length, 0);
  assert.match(result.receipt, /^ni:\/\/\//u);
});

test("content-addressed witness refuses an NI mismatch before producing postings", () => {
  const result = resolveLedgerWitness(
    { ...WITNESS, recordNi: "ni:///sha-256;definitely-not-the-record" },
    { fetchContentAddressed: () => BYTES },
  );
  assert.equal(result.resolved, false);
  assert.equal(result.state, "refused");
  assert.match(result.reason, /recordNi mismatch/);
  assert.equal(Object.hasOwn(result, "postings"), false);
});

test("missing witness content is unavailable, never an empty ledger", () => {
  const result = resolveLedgerWitness(WITNESS, { fetchContentAddressed: () => null });
  assert.equal(result.resolved, false);
  assert.equal(result.state, "unavailable");
  assert.equal(Object.hasOwn(result, "postings"), false);
});

test("legacy 0.5.0 member identity migrates deterministically without a placeholder rail", () => {
  const legacy = {
    account: "pool:account-alice",
    hiveAccount: "alice-hive",
    baseAddress: "0xabc",
    ledgerPath: "/alice.json",
  };
  const first = migrateLegacyMember(legacy);
  const second = migrateLegacyMember(legacy);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    account: "pool:account-alice",
    settlementDestinations: [
      { rail: "hive", account: "alice-hive" },
      { rail: "base", address: "0xabc" },
    ],
    ledgerWitness: { kind: "local-file", path: "/alice.json" },
  });
});

test("pool membership migration preserves non-membership state", () => {
  const legacyPool = {
    ...createPool({ id: "t", settlementWindowDays: 7 }),
    members: [{ account: "pool:account-alice", hiveAccount: "alice-hive", baseAddress: null, ledgerPath: "/alice.json" }],
    barrierSeries: [{ date: "2026-10-01", amount: "50" }],
    tallies: [{ drawId: "d1", status: "matched" }],
  };
  const migrated = migrateLegacyPoolMembership(legacyPool);
  assert.deepEqual(migrated.barrierSeries, legacyPool.barrierSeries);
  assert.deepEqual(migrated.tallies, legacyPool.tallies);
  assert.deepEqual(migrated.members[0].settlementDestinations, [{ rail: "hive", account: "alice-hive" }]);
});
