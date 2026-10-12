import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fundAccount } from "@red-cup-engineering/energy-bank/transfer";
import { createLedger } from "@red-cup-engineering/energy-bank/ledger";
import { admitPoolMember } from "../scripts/admit-pool-member.mjs";
import { contributeToPoolFromStore } from "../scripts/contribute-to-pool.mjs";
import { ledgerAccountPath } from "../src/pool.mjs";
import { readStore, writeStore } from "../src/store.mjs";

function fixture(dir) {
  const statePath = join(dir, "pool.json");
  const result = admitPoolMember(statePath, dir, { poolId: "test-pool", settlementWindowDays: 7, account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount" });
  assert.equal(result.admitted, true);
  const document = readStore(statePath, null);

  // Alice's own sleeve already holds 50 HBD, funded from outside the pool -- the balance a
  // contribution draws down.
  const ledger = createLedger([]);
  fundAccount(ledger, "equity:seed-capital", "pool:account-alice", "50", "HBD", "seed-alice-1", "2026-09-01");
  writeStore(statePath, { pool: { ...document.pool, ledger: { entries: ledger.all() } }, tallies: [], draws: [] });
  return statePath;
}

test("contributeToPoolFromStore: posts a balanced HBD transfer from the member's sleeve into the pool account", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-contribute-"));
  const statePath = fixture(dir);

  const result = contributeToPoolFromStore(statePath, dir, {
    account: "pool:account-alice",
    amount: "20",
    commodity: "HBD",
    sourceSleeve: "pool:account-alice",
    contributedAt: "2026-09-05T12:00:00Z",
  });

  assert.equal(result.admitted, true);
  assert.equal(result.posting.account, "pool:account-alice");
  assert.equal(result.posting.amount, "20");
  assert.equal(result.posting.commodity, "HBD");
  assert.match(result.receipt, /^ni:\/\/\//);

  const { pool } = readStore(statePath, null);
  const balances = createLedger(pool.ledger.entries).audit().balances;
  assert.equal(balances[ledgerAccountPath("pool:account-alice")]?.HBD, "30");
  assert.equal(balances[ledgerAccountPath(pool.account)]?.HBD, "20");
});

test("contributeToPoolFromStore: the account path is derived from HBD, never the liabilities:energy default", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-contribute-"));
  const statePath = fixture(dir);

  contributeToPoolFromStore(statePath, dir, {
    account: "pool:account-alice",
    amount: "5",
    commodity: "HBD",
    sourceSleeve: "pool:account-alice",
    contributedAt: "2026-09-05T12:00:00Z",
  });

  const { pool } = readStore(statePath, null);
  const balances = createLedger(pool.ledger.entries).audit().balances;
  assert.equal(balances["liabilities:hbd:pool:account-alice"] !== undefined, true);
  assert.equal(balances["liabilities:energy:pool:account-alice"], undefined);
});

test("contributeToPoolFromStore: refuses (as data) a contributor who is not an admitted member", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-contribute-"));
  const statePath = fixture(dir);

  const result = contributeToPoolFromStore(statePath, dir, {
    account: "pool:account-not-a-member",
    amount: "5",
    commodity: "HBD",
    sourceSleeve: "pool:account-not-a-member",
    contributedAt: "2026-09-05T12:00:00Z",
  });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /not an admitted member/);
});

test("contributeToPoolFromStore: refuses (as data, never thrown) an over-drawn sleeve", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-contribute-"));
  const statePath = fixture(dir);

  const result = contributeToPoolFromStore(statePath, dir, {
    account: "pool:account-alice",
    amount: "999",
    commodity: "HBD",
    sourceSleeve: "pool:account-alice",
    contributedAt: "2026-09-05T12:00:00Z",
  });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /cannot send/);
});
