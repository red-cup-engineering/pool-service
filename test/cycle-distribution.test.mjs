import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitPoolMember } from "../scripts/admit-pool-member.mjs";
import { admitMemberEnterpriseFromStore } from "../scripts/admit-member-enterprise.mjs";
import { recordDistributionVoteFromStore } from "../scripts/record-distribution-vote.mjs";
import { tallyCycleVotesFromStore } from "../scripts/tally-cycle-votes.mjs";
import { deriveCycleSplitFromStore } from "../scripts/derive-cycle-split.mjs";
import { contestPoolReceiptFromStore } from "../scripts/contest-pool-receipt.mjs";
import { readStore, writeStore } from "../src/store.mjs";

/**
 * The gate's full paper cycle: three members (bob sponsored by alice), two member
 * enterprises, one cycle of 100 USDC directed yield, one vote, one contest -- reproducing the
 * economics specification's worked 20/30/50 split and the membership specification's 25/25
 * fixed-even/voted split of the distributable bucket.
 */
test("paper cycle: three members (one sponsored), two enterprises, one vote, one contest", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-cycle-"));
  const statePath = join(dir, "pool.json");

  // 1. Alice: the pool's own bootstrap admission, no admissionWitness.
  const alice = admitPoolMember(statePath, dir, {
    poolId: "tidepool-test", settlementWindowDays: 7, creditWindowDays: 90,
    account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount",
  });
  assert.equal(alice.admitted, true);
  assert.equal(alice.receipt, null); // no admittedAt supplied -- no receipt, per the additive design

  // 2. Carol: also admitted with no witness (two of three members need none).
  const carol = admitPoolMember(statePath, dir, { account: "pool:account-carol", hiveAccount: "carol-hive", ledgerPath: "/carol.beancount" });
  assert.equal(carol.admitted, true);

  // Seed alice's and carol's matched-tally history directly (fixture setup, never house
  // policy -- README's "cold-start gap, named plainly").
  const document = readStore(statePath, null);
  const seedTallies = [
    { drawId: "seed:alice:1", memberAccount: "pool:account-alice", amount: "20", releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched" },
    { drawId: "seed:alice:2", memberAccount: "pool:account-alice", amount: "20", releasedAt: "2026-08-10T00:00:00Z", admittedAt: "2026-08-15T00:00:00Z", status: "matched" },
    { drawId: "seed:carol:1", memberAccount: "pool:account-carol", amount: "15", releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched" },
    { drawId: "seed:carol:2", memberAccount: "pool:account-carol", amount: "15", releasedAt: "2026-08-10T00:00:00Z", admittedAt: "2026-08-15T00:00:00Z", status: "matched" },
  ];
  writeStore(statePath, { ...document, tallies: seedTallies });

  // 3. Bob: sponsored by alice (whose derived line, from her seeded tallies, is 2 x 20 = 40 at
  //    2026-08-20), pledged 10 -- within alice's line. The sponsor-vouch admission seeds bob's
  //    first tally itself (src/membership.mjs's sponsorSeedTally), so "the pledge becomes the
  //    new member's first line" with no separate credit-line mechanism.
  const bob = admitPoolMember(statePath, dir, {
    account: "pool:account-bob", hiveAccount: "bob-hive", ledgerPath: "/bob.beancount",
    admissionWitness: { kind: "sponsor-vouch", sponsorAccount: "pool:account-alice", pledgedAmount: "10" },
    admittedAt: "2026-08-20T00:00:00Z",
  });
  assert.equal(bob.admitted, true);
  assert.match(bob.receipt, /^ni:\/\/\//);

  // 4. Two member enterprises, the org's own first-roster seed (admitted outright).
  const ent1 = admitMemberEnterpriseFromStore(statePath, dir, { enterpriseId: "ent-1", offer: "a scored letter, priced plainly", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true, proposedAt: "2026-08-01T00:00:00Z" });
  assert.equal(ent1.admitted, true);
  const ent2 = admitMemberEnterpriseFromStore(statePath, dir, { enterpriseId: "ent-2", offer: "the basis book, priced plainly", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true, proposedAt: "2026-08-01T00:00:00Z" });
  assert.equal(ent2.admitted, true);

  // 5. One cycle's vote: all three members split their own weight evenly across both
  //    enterprises, so the voted portion divides evenly regardless of each member's own
  //    matched-tally weight.
  const matchedTallyAsOf = "2026-08-31T00:00:00Z";
  for (const memberAccount of ["pool:account-alice", "pool:account-carol", "pool:account-bob"]) {
    const vote = recordDistributionVoteFromStore(statePath, dir, {
      cycleId: "2026-09-cycle-1", memberAccount,
      allocations: [{ enterpriseId: "ent-1", weight: 1 }, { enterpriseId: "ent-2", weight: 1 }],
      matchedTallyAsOf, recordedAt: "2026-09-01T00:00:00Z",
    });
    assert.equal(vote.recorded, true, `${memberAccount}: ${vote.reason}`);
    assert.ok(vote.weight > 0);
  }

  // 6. Tally: quorum met (three nonzero-weight voters), shares split evenly.
  const tally = tallyCycleVotesFromStore(statePath, dir, { cycleId: "2026-09-cycle-1", closedAt: "2026-09-01T00:00:00Z" });
  assert.equal(tally.quorumMet, true);
  assert.equal(tally.voterCount, 3);
  assert.equal(tally.closedAt, "2026-09-01T00:00:00Z");
  assert.equal(tally.voteEvidence.voteCount, 3);
  assert.equal(tally.voteEvidence.excludedLateVoteCount, 0);
  assert.match(tally.voteEvidence.recordNi, /^ni:\/\/\/sha-256;/u);
  assert.equal(tally.shares["ent-1"], tally.shares["ent-2"]);

  // First close is append-only: the tally cannot be replaced by a later close.
  const tallyClosedState = readFileSync(statePath, "utf8");
  assert.throws(
    () => tallyCycleVotesFromStore(statePath, dir, { cycleId: "2026-09-cycle-1", closedAt: "2026-09-02T00:00:00Z" }),
    /already closed/u,
  );
  assert.equal(readFileSync(statePath, "utf8"), tallyClosedState);

  // Once closed, even a new eligible member vote is refused rather than mutating the tally.
  const lateVote = recordDistributionVoteFromStore(statePath, dir, {
    cycleId: "2026-09-cycle-1",
    memberAccount: "pool:account-alice",
    allocations: [{ enterpriseId: "ent-1", weight: 1 }],
    matchedTallyAsOf,
    recordedAt: "2026-09-01T01:00:00Z",
  });
  assert.equal(lateVote.recorded, false);
  assert.match(lateVote.reason, /already closed/u);

  // 7. Derive the cycle's split: the economics specification's worked 20/30/50, then the
  //    membership specification's 25/25 fixed-even/voted split, exact.
  const yieldReceipts = [
    { memberAccount: "pool:account-alice", amount: "40", commodity: "USDC", observedAt: "2026-09-01T00:00:00Z", txHash: "0xalice" },
    { memberAccount: "pool:account-bob", amount: "60", commodity: "USDC", observedAt: "2026-09-01T00:01:00Z", txHash: "0xbob" },
  ];
  const split = deriveCycleSplitFromStore(statePath, dir, {
    cycleId: "2026-09-cycle-1",
    directedYieldReceipts: yieldReceipts,
    totalYield: "100",
    commodity: "USDC",
    recordedAt: "2026-09-01T00:00:00Z",
  });
  assert.equal(split.totalYield, "100");
  assert.equal(split.reserve, "20");
  assert.equal(split.float, "30");
  assert.equal(split.distributable, "50");
  assert.equal(split.fixedPortion, "25");
  assert.equal(split.votedPortion, "25");
  assert.match(split.receipt, /^ni:\/\/\//);
  assert.match(split.yieldEvidence.recordNi, /^ni:\/\/\/sha-256;/u);
  assert.equal(split.yieldEvidence.receiptCount, 2);
  assert.equal(split.yieldEvidence.observedThrough, "2026-09-01T00:01:00Z");
  assert.deepEqual(split.perEnterprise, [
    { enterpriseId: "ent-1", fixed: "12.5", voted: "12.5", total: "25" },
    { enterpriseId: "ent-2", fixed: "12.5", voted: "12.5", total: "25" },
  ]);

  // 7a. Closing the same cycle again is refused before authoritative state can be replaced.
  const closedState = readFileSync(statePath, "utf8");
  assert.throws(
    () => deriveCycleSplitFromStore(statePath, dir, {
      cycleId: "2026-09-cycle-1", totalYield: "999", commodity: "USDC", recordedAt: "2026-09-01T01:00:00Z",
    }),
    /already closed/u,
  );
  assert.equal(readFileSync(statePath, "utf8"), closedState);

  // 8. One contest: bob (or the pool) disputes his own sponsor-seed tally's amount.
  const contest = contestPoolReceiptFromStore(statePath, dir, {
    ref: "sponsor-seed:pool:account-bob", contestedBy: "pool:account-bob",
    reason: "the pledged amount posted does not match what alice and I agreed", contestedAt: "2026-09-02T00:00:00Z",
  });
  assert.equal(contest.contested, true);
  assert.equal(contest.contest.status, "open");
  assert.match(contest.receipt, /^ni:\/\/\//);

  // A second contest on the same ref is refused, never a silent duplicate.
  const duplicateContest = contestPoolReceiptFromStore(statePath, dir, {
    ref: "sponsor-seed:pool:account-bob", contestedBy: "pool:account-alice", reason: "a second look", contestedAt: "2026-09-03T00:00:00Z",
  });
  assert.equal(duplicateContest.contested, false);

  console.log("PAPER CYCLE OUTPUT:");
  console.log(JSON.stringify({ alice, carol, bob, ent1, ent2, tally, split, contest }, null, 2));
});


test("derive-cycle-split: receipt evidence owns total yield and caller assertions may not override it", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-cycle-evidence-"));
  const statePath = join(dir, "pool.json");
  writeStore(statePath, {
    pool: { id: "evidence-test" },
    enterprises: [{ enterpriseId: "ent-1", status: "admitted" }],
    cycleTallies: [{ cycleId: "cycle-evidence", shares: { "ent-1": 1 }, quorumMet: true }],
  });
  const receipts = [
    { memberAccount: "pool:account-a", amount: "40", commodity: "USDC", observedAt: "2026-09-01T00:00:00Z", txHash: "0xa" },
    { memberAccount: "pool:account-b", amount: "60", commodity: "USDC", observedAt: "2026-09-01T00:01:00Z", txHash: "0xb" },
  ];
  assert.throws(() => deriveCycleSplitFromStore(statePath, dir, {
    cycleId: "cycle-evidence",
    directedYieldReceipts: receipts,
    totalYield: "999",
    commodity: "USDC",
    recordedAt: "2026-09-01T00:02:00Z",
  }), /does not match receipt-derived total/u);
  assert.equal(readStore(statePath, null).cycleSplits, undefined);

  const split = deriveCycleSplitFromStore(statePath, dir, {
    cycleId: "cycle-evidence",
    directedYieldReceipts: [...receipts].reverse(),
    recordedAt: "2026-09-01T00:03:00Z",
  });
  assert.equal(split.totalYield, "100");
  assert.equal(split.commodity, "USDC");
  assert.equal(split.yieldEvidence.receiptCount, 2);
});


test("derive-cycle-split: refuses before an authoritative tally exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-cycle-no-tally-"));
  const statePath = join(dir, "pool.json");
  writeStore(statePath, {
    pool: { id: "no-tally-test" },
    enterprises: [{ enterpriseId: "ent-1", status: "admitted" }],
    cycleTallies: [],
  });
  const receipts = [{
    memberAccount: "pool:account-a",
    amount: "100",
    commodity: "USDC",
    observedAt: "2026-09-01T00:00:00Z",
    txHash: "0xa",
  }];
  assert.throws(() => deriveCycleSplitFromStore(statePath, dir, {
    cycleId: "cycle-no-tally",
    directedYieldReceipts: receipts,
    recordedAt: "2026-09-01T00:01:00Z",
  }), /has no authoritative tally/u);
  assert.equal(readStore(statePath, null).cycleSplits, undefined);
});


test("cycle tally close excludes votes timestamped after closedAt and commits only included votes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-tally-window-"));
  const statePath = join(dir, "pool.json");
  writeStore(statePath, {
    pool: { id: "tally-window", settlementWindowDays: 7, creditWindowDays: 90 },
    votes: [
      { cycleId: "cycle-window", memberAccount: "pool:a", allocations: [{ enterpriseId: "ent-1", weight: 1 }], weight: 1, recordedAt: "2026-09-30T23:59:59Z" },
      { cycleId: "cycle-window", memberAccount: "pool:b", allocations: [{ enterpriseId: "ent-1", weight: 1 }], weight: 1, recordedAt: "2026-10-01T00:00:01Z" },
    ],
  });
  const tally = tallyCycleVotesFromStore(statePath, dir, {
    cycleId: "cycle-window",
    closedAt: "2026-10-01T00:00:00Z",
  });
  assert.equal(tally.voterCount, 1);
  assert.equal(tally.voteEvidence.voteCount, 1);
  assert.equal(tally.voteEvidence.excludedLateVoteCount, 1);
  assert.match(tally.voteEvidence.recordNi, /^ni:\/\/\/sha-256;/u);
});

test("cycle tally close refuses duplicate member votes in stored legacy/direct state", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-tally-duplicate-"));
  const statePath = join(dir, "pool.json");
  writeStore(statePath, {
    pool: { id: "tally-duplicate", settlementWindowDays: 7, creditWindowDays: 90 },
    votes: [
      { cycleId: "cycle-dup", memberAccount: "pool:a", allocations: [{ enterpriseId: "ent-1", weight: 1 }], weight: 1, recordedAt: "2026-09-01T00:00:00Z" },
      { cycleId: "cycle-dup", memberAccount: "pool:a", allocations: [{ enterpriseId: "ent-2", weight: 1 }], weight: 1, recordedAt: "2026-09-01T00:01:00Z" },
    ],
  });
  const before = readFileSync(statePath, "utf8");
  assert.throws(
    () => tallyCycleVotesFromStore(statePath, dir, { cycleId: "cycle-dup", closedAt: "2026-09-30T00:00:00Z" }),
    /duplicate votes/u,
  );
  assert.equal(readFileSync(statePath, "utf8"), before);
});
