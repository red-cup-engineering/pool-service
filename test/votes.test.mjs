import { test } from "node:test";
import assert from "node:assert/strict";
import { castDistributionVote, tallyCycleVotes, enterpriseAdmissionCycleId } from "../src/votes.mjs";

const TALLIES = [
  { drawId: "d1", memberAccount: "pool:account-alice", amount: "10", releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched" },
  { drawId: "d2", memberAccount: "pool:account-alice", amount: "10", releasedAt: "2026-08-10T00:00:00Z", admittedAt: "2026-08-15T00:00:00Z", status: "matched" },
  { drawId: "d3", memberAccount: "pool:account-alice", amount: "10", releasedAt: "2026-08-20T00:00:00Z", admittedAt: "2026-08-25T00:00:00Z", status: "matched" },
];

test("castDistributionVote: weight is the voter's matched-tally count as of matchedTallyAsOf", () => {
  const result = castDistributionVote({
    votes: [], tallies: TALLIES, settlementWindowDays: 7, creditWindowDays: 90,
    cycleId: "cycle-1", memberAccount: "pool:account-alice", allocations: [{ enterpriseId: "ent-1", weight: 1 }],
    matchedTallyAsOf: "2026-08-31T00:00:00Z", recordedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.recorded, true);
  assert.equal(result.weight, 3);
});

test("castDistributionVote: refuses a voter with zero matched-tally weight", () => {
  const result = castDistributionVote({
    votes: [], tallies: [], settlementWindowDays: 7, creditWindowDays: 90,
    cycleId: "cycle-1", memberAccount: "pool:account-bob", allocations: [{ enterpriseId: "ent-1", weight: 1 }],
    matchedTallyAsOf: "2026-08-31T00:00:00Z", recordedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(result.recorded, false);
  assert.match(result.reason, /zero matched-tally weight/);
});

test("castDistributionVote: refuses a duplicate vote for the same member and cycle", () => {
  const first = castDistributionVote({
    votes: [], tallies: TALLIES, settlementWindowDays: 7, creditWindowDays: 90,
    cycleId: "cycle-1", memberAccount: "pool:account-alice", allocations: [{ enterpriseId: "ent-1", weight: 1 }],
    matchedTallyAsOf: "2026-08-31T00:00:00Z", recordedAt: "2026-09-05T00:00:00Z",
  });
  const second = castDistributionVote({
    votes: first.votes, tallies: TALLIES, settlementWindowDays: 7, creditWindowDays: 90,
    cycleId: "cycle-1", memberAccount: "pool:account-alice", allocations: [{ enterpriseId: "ent-2", weight: 1 }],
    matchedTallyAsOf: "2026-08-31T00:00:00Z", recordedAt: "2026-09-06T00:00:00Z",
  });
  assert.equal(second.recorded, false);
  assert.match(second.reason, /already voted/);
});

test("tallyCycleVotes: below three nonzero-weight voters, quorum is not met and shares stay empty", () => {
  const votes = [
    { cycleId: "cycle-1", memberAccount: "pool:account-alice", allocations: [{ enterpriseId: "ent-1", weight: 1 }], weight: 3, recordedAt: "2026-09-05T00:00:00Z" },
    { cycleId: "cycle-1", memberAccount: "pool:account-bob", allocations: [{ enterpriseId: "ent-1", weight: 1 }], weight: 2, recordedAt: "2026-09-05T00:00:00Z" },
  ];
  const tally = tallyCycleVotes(votes, "cycle-1");
  assert.equal(tally.quorumMet, false);
  assert.equal(tally.voterCount, 2);
  assert.deepEqual(tally.shares, {});
});

test("tallyCycleVotes: at quorum, sums each voter's weight into their allocated enterprises", () => {
  const votes = [
    { cycleId: "cycle-1", memberAccount: "pool:account-alice", allocations: [{ enterpriseId: "ent-1", weight: 1 }], weight: 3, recordedAt: "2026-09-05T00:00:00Z" },
    { cycleId: "cycle-1", memberAccount: "pool:account-bob", allocations: [{ enterpriseId: "ent-1", weight: 1 }], weight: 2, recordedAt: "2026-09-05T00:00:00Z" },
    { cycleId: "cycle-1", memberAccount: "pool:account-carol", allocations: [{ enterpriseId: "ent-2", weight: 1 }], weight: 2, recordedAt: "2026-09-05T00:00:00Z" },
  ];
  const tally = tallyCycleVotes(votes, "cycle-1");
  assert.equal(tally.quorumMet, true);
  assert.equal(tally.voterCount, 3);
  assert.equal(tally.totalWeight, 7);
  assert.deepEqual(tally.shares, { "ent-1": 5, "ent-2": 2 });
});

test("enterpriseAdmissionCycleId: the reserved cycle id an enterprise's admission proposal votes under", () => {
  assert.equal(enterpriseAdmissionCycleId("ent-1"), "enterprise-admission:ent-1");
});
