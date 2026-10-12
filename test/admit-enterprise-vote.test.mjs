import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitPoolMember } from "../scripts/admit-pool-member.mjs";
import { admitMemberEnterpriseFromStore } from "../scripts/admit-member-enterprise.mjs";
import { recordDistributionVoteFromStore } from "../scripts/record-distribution-vote.mjs";
import { admitEnterpriseVoteFromStore } from "../scripts/admit-enterprise-vote.mjs";
import { readStore, writeStore } from "../src/store.mjs";

function fixture(dir) {
  const statePath = join(dir, "pool.json");
  admitPoolMember(statePath, dir, { poolId: "t", settlementWindowDays: 7, creditWindowDays: 90, account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount" });
  admitPoolMember(statePath, dir, { account: "pool:account-bob", hiveAccount: "bob-hive", ledgerPath: "/bob.beancount" });
  admitPoolMember(statePath, dir, { account: "pool:account-carol", hiveAccount: "carol-hive", ledgerPath: "/carol.beancount" });
  const document = readStore(statePath, null);
  const tallies = ["alice", "bob", "carol"].map((name, i) => ({
    drawId: `seed:${name}`, memberAccount: `pool:account-${name}`, amount: "10",
    releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched",
  }));
  writeStore(statePath, { ...document, tallies });
  admitMemberEnterpriseFromStore(statePath, dir, { enterpriseId: "ent-0", offer: "seed enterprise", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true, proposedAt: "2026-08-01T00:00:00Z" });
  admitMemberEnterpriseFromStore(statePath, dir, { enterpriseId: "ent-new", offer: "a new candidate enterprise", reportingCommitment: "monthly", sponsorEnterprise: "ent-0", proposedAt: "2026-08-15T00:00:00Z" });
  return statePath;
}

test("admitEnterpriseVoteFromStore: a majority-support vote at quorum admits the pending enterprise", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-admit-vote-"));
  const statePath = fixture(dir);
  for (const memberAccount of ["pool:account-alice", "pool:account-bob", "pool:account-carol"]) {
    const vote = recordDistributionVoteFromStore(statePath, dir, {
      cycleId: "enterprise-admission:ent-new", memberAccount,
      allocations: [{ enterpriseId: "ent-new", weight: 1 }],
      matchedTallyAsOf: "2026-08-31T00:00:00Z", recordedAt: "2026-09-01T00:00:00Z",
    });
    assert.equal(vote.recorded, true);
  }
  const result = admitEnterpriseVoteFromStore(statePath, dir, { enterpriseId: "ent-new", admittedAt: "2026-09-02T00:00:00Z" });
  assert.equal(result.admitted, true, JSON.stringify(result));
  assert.match(result.receipt, /^ni:\/\/\//);
});

test("admitEnterpriseVoteFromStore: refuses below quorum", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-service-admit-vote-"));
  const statePath = fixture(dir);
  recordDistributionVoteFromStore(statePath, dir, {
    cycleId: "enterprise-admission:ent-new", memberAccount: "pool:account-alice",
    allocations: [{ enterpriseId: "ent-new", weight: 1 }],
    matchedTallyAsOf: "2026-08-31T00:00:00Z", recordedAt: "2026-09-01T00:00:00Z",
  });
  const result = admitEnterpriseVoteFromStore(statePath, dir, { enterpriseId: "ent-new", admittedAt: "2026-09-02T00:00:00Z" });
  assert.equal(result.admitted, false);
  assert.equal(result.tally.quorumMet, false);
});
