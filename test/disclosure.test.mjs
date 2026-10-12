import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveCycleDisclosure } from "../src/disclosure.mjs";
import { publishCycleDisclosureFromStore } from "../scripts/publish-cycle-disclosure.mjs";
import { writeStore } from "../src/store.mjs";

const SPLIT = Object.freeze({
  cycleId: "2026-09-cycle-1", commodity: "USDC", totalYield: "100", reserve: "20", float: "30", distributable: "50",
  fixedPortion: "25", votedPortion: "25", quorumMet: true, voteMode: "weighted",
  perEnterprise: [
    { enterpriseId: "ent-1", fixed: "12.5", voted: "12.5", total: "25" },
    { enterpriseId: "ent-2", fixed: "12.5", voted: "12.5", total: "25" },
  ],
});
const ENTERPRISES = [
  { enterpriseId: "ent-1", offer: "a scored letter, priced plainly", reportingCommitment: "monthly", sponsorEnterprise: null, status: "admitted", admittedAt: "2026-08-01T00:00:00Z", retiredAt: null, retiredReason: null },
  { enterpriseId: "ent-2", offer: "the basis book, priced plainly", reportingCommitment: "monthly", sponsorEnterprise: null, status: "admitted", admittedAt: "2026-08-01T00:00:00Z", retiredAt: null, retiredReason: null },
];
const BARRIER_SERIES = [{ date: "2026-09-01", amount: "50" }];
const FALSIFIERS = ["Yield below operating cost.", "Participation falls below quorum for more than half of a rolling twelve-cycle window."];

test("deriveCycleDisclosure: the public view carries no per-member data and matches the split's ratio and totals", () => {
  const disclosure = deriveCycleDisclosure({ cycleId: "2026-09-cycle-1", barrierSeries: BARRIER_SERIES, split: SPLIT, enterprises: ENTERPRISES, falsifiers: FALSIFIERS, publishedAt: "2026-09-05T00:00:00Z" });
  assert.equal(disclosure.type, "PoolCycleDisclosure");
  assert.deepEqual(disclosure.public.roster, [{ enterpriseId: "ent-1", offer: "a scored letter, priced plainly" }, { enterpriseId: "ent-2", offer: "the basis book, priced plainly" }]);
  assert.equal(disclosure.public.cycle.totalYield, "100");
  assert.equal(disclosure.public.cycle.quorumMet, true);
  assert.equal(disclosure.public.cycle.voteMode, "weighted");
  assert.deepEqual(disclosure.public.cycle.splitRatioPercent, { reserve: 20, float: 30, distributable: 50 });
  assert.deepEqual(disclosure.public.cycle.perEnterpriseTotals, [{ enterpriseId: "ent-1", total: "25" }, { enterpriseId: "ent-2", total: "25" }]);
  assert.deepEqual(disclosure.public.falsifiers, FALSIFIERS);
  assert.equal(JSON.stringify(disclosure.public).includes("account"), false); // no per-member account ever reaches the public view
  for (const privateField of ["ledgerWitness", "recordNi", "settlementDestinations", "baseAddress", "hiveAccount", "ledgerPath"]) {
    assert.equal(JSON.stringify(disclosure.public).includes(privateField), false);
  }

  assert.deepEqual(disclosure.members.barrierSeries, BARRIER_SERIES);
  assert.equal(disclosure.members.split.cycleId, "2026-09-cycle-1");
  assert.equal(disclosure.members.enterprises.length, 2);
});

test("publish-cycle-disclosure: writes one dated JSON record and a receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-disclosure-"));
  const statePath = join(dir, "pool.json");
  writeStore(statePath, { pool: { id: "t", barrierSeries: BARRIER_SERIES }, tallies: [], draws: [], enterprises: ENTERPRISES, votes: [], contests: [], cycleSplits: [SPLIT] });

  const recordPath = join(dir, "2026-09-05-pool-cycle-disclosure-2026-09-cycle-1.json");
  const result = publishCycleDisclosureFromStore(statePath, dir, { cycleId: "2026-09-cycle-1", falsifiers: FALSIFIERS, publishedAt: "2026-09-05T00:00:00Z" }, { recordPath });
  assert.equal(result.published, true);
  assert.match(result.receipt, /^ni:\/\/\//);

  const written = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(written.type, "PoolCycleDisclosure");
  assert.equal(written.cycleId, "2026-09-cycle-1");
  assert.equal(written.public.roster.length, 2);

  const originalRecord = readFileSync(recordPath, "utf8");
  const laterRecordPath = join(dir, "2026-09-06-pool-cycle-disclosure-2026-09-cycle-1.json");
  assert.throws(
    () => publishCycleDisclosureFromStore(
      statePath,
      dir,
      { cycleId: "2026-09-cycle-1", falsifiers: ["changed"], publishedAt: "2026-09-06T00:00:00Z" },
      { recordPath: laterRecordPath },
    ),
    /already has a published disclosure/u,
  );
  assert.equal(readFileSync(recordPath, "utf8"), originalRecord);
  assert.equal(existsSync(laterRecordPath), false);
});

test("publish-cycle-disclosure: throws when no cycle-split document exists for the cycle", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-disclosure-missing-"));
  const statePath = join(dir, "pool.json");
  writeStore(statePath, { pool: { id: "t" }, cycleSplits: [] });
  assert.throws(() => publishCycleDisclosureFromStore(statePath, dir, { cycleId: "nope", falsifiers: [], publishedAt: "2026-09-05T00:00:00Z" }), /no cycle-split document/);
});
