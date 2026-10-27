import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { admitPoolMember } from "../scripts/admit-pool-member.mjs";
import { admitMemberEnterpriseFromStore } from "../scripts/admit-member-enterprise.mjs";
import { admitEnterpriseVoteFromStore } from "../scripts/admit-enterprise-vote.mjs";
import { recordDistributionVoteFromStore } from "../scripts/record-distribution-vote.mjs";
import { tallyCycleVotesFromStore } from "../scripts/tally-cycle-votes.mjs";
import { deriveCycleSplitFromStore } from "../scripts/derive-cycle-split.mjs";
import { reconcilePoolBooksFromStore } from "../scripts/reconcile-pool-books.mjs";
import { publishCycleDisclosureFromStore } from "../scripts/publish-cycle-disclosure.mjs";
import { enterpriseAdmissionCycleId } from "../src/votes.mjs";
import { HBD, ledgerAccountPath, settlePoolDraw } from "../src/pool.mjs";
import { recordNiForBytes } from "../src/ledger-witness.mjs";
import { readStore, writeStore } from "../src/store.mjs";

const ALICE = "pool:account-alice";
const BOB = "pool:account-bob";
const CAROL = "pool:account-carol";
const SEED = "enterprise-seed";
const CANDIDATE = "enterprise-candidate";

function niReceipt(value) {
  assert.match(value, /^ni:\/\/\/sha-256;/u);
}

test("bounded Tidepool acceptance loop produces admission, vote, cycle, reconciliation, and public receipts from one store", () => {
  const dir = mkdtempSync(join(tmpdir(), "tidepool-acceptance-loop-"));
  const statePath = join(dir, "pool.json");

  const drawId = "draw:tidepool-acceptance:alice:1";
  const alicePath = ledgerAccountPath(ALICE);
  const aliceWitnessPostings = [
    { date: "2026-09-01", ref: drawId, account: alicePath, amount: "10", commodity: HBD },
    { date: "2026-09-02", ref: `${drawId}:settle`, account: alicePath, amount: "-11", commodity: HBD },
  ];
  const aliceWitnessText = JSON.stringify({ postings: aliceWitnessPostings });
  const emptyWitnessText = JSON.stringify({ postings: [] });

  const admissions = [
    {
      account: ALICE,
      address: "0xalice",
      witness: {
        kind: "content-addressed-postings",
        recordNi: recordNiForBytes(aliceWitnessText),
        provider: "member-controlled-fixture",
        subject: "ledger:alice",
      },
      admittedAt: "2026-09-03T00:00:00Z",
    },
    {
      account: BOB,
      address: "0xbob",
      witness: {
        kind: "content-addressed-postings",
        recordNi: recordNiForBytes(emptyWitnessText),
        provider: "member-controlled-fixture",
        subject: "ledger:bob",
      },
      admittedAt: "2026-09-03T00:01:00Z",
    },
    {
      account: CAROL,
      address: "0xcarol",
      witness: {
        kind: "content-addressed-postings",
        recordNi: recordNiForBytes(emptyWitnessText),
        provider: "member-controlled-fixture",
        subject: "ledger:carol",
      },
      admittedAt: "2026-09-03T00:02:00Z",
    },
  ];

  for (const [index, member] of admissions.entries()) {
    const result = admitPoolMember(statePath, dir, {
      ...(index === 0 ? { poolId: "tidepool-acceptance", settlementWindowDays: 7, creditWindowDays: 90 } : {}),
      account: member.account,
      settlementDestinations: [{ rail: "base", address: member.address }],
      ledgerWitness: member.witness,
      admittedAt: member.admittedAt,
    });
    assert.equal(result.admitted, true);
    niReceipt(result.receipt);
  }

  // Seed matched-tally history through the same pure settlement constructor the effectful
  // settlement operation uses. Alice's tally corresponds to a persisted draw so the later
  // two-witness reconciliation has two real pool-side facts to compare.
  const aliceTally = settlePoolDraw({
    drawId,
    memberAccount: ALICE,
    amount: "10",
    releasedAt: "2026-09-01T00:00:00Z",
    admittedAt: "2026-09-02T00:00:00Z",
  });
  const bobTally = settlePoolDraw({
    drawId: "draw:tidepool-acceptance:bob:1",
    memberAccount: BOB,
    amount: "8",
    releasedAt: "2026-09-01T00:00:00Z",
    admittedAt: "2026-09-02T00:00:00Z",
  });
  const carolTally = settlePoolDraw({
    drawId: "draw:tidepool-acceptance:carol:1",
    memberAccount: CAROL,
    amount: "6",
    releasedAt: "2026-09-01T00:00:00Z",
    admittedAt: "2026-09-02T00:00:00Z",
  });
  const seeded = readStore(statePath, null);
  writeStore(statePath, {
    ...seeded,
    tallies: [aliceTally, bobTally, carolTally],
    draws: [{
      drawId,
      memberAccount: ALICE,
      amount: "10",
      price: "1",
      requestedAt: "2026-09-01T00:00:00Z",
      status: "settled",
    }],
  });

  const seedEnterprise = admitMemberEnterpriseFromStore(statePath, dir, {
    enterpriseId: SEED,
    offer: "shared receiving and settlement support, priced plainly",
    reportingCommitment: "one public receipt per closed cycle",
    sponsorEnterprise: null,
    allowUnsponsored: true,
    proposedAt: "2026-09-04T00:00:00Z",
  });
  assert.equal(seedEnterprise.admitted, true);
  niReceipt(seedEnterprise.receipt);

  const proposal = admitMemberEnterpriseFromStore(statePath, dir, {
    enterpriseId: CANDIDATE,
    offer: "member accounting review, priced plainly",
    reportingCommitment: "one public receipt per closed cycle",
    sponsorEnterprise: SEED,
    proposedAt: "2026-09-04T01:00:00Z",
  });
  assert.equal(proposal.admitted, true);
  niReceipt(proposal.receipt);

  const admissionCycle = enterpriseAdmissionCycleId(CANDIDATE);
  for (const [index, account] of [ALICE, BOB, CAROL].entries()) {
    const vote = recordDistributionVoteFromStore(statePath, dir, {
      cycleId: admissionCycle,
      memberAccount: account,
      allocations: [{ enterpriseId: CANDIDATE, weight: 1 }],
      matchedTallyAsOf: "2026-09-30T00:00:00Z",
      recordedAt: `2026-09-30T01:0${index}:00Z`,
    });
    assert.equal(vote.recorded, true);
    assert.equal(vote.weight, 1);
    niReceipt(vote.receipt);
  }

  const enterpriseAdmission = admitEnterpriseVoteFromStore(statePath, dir, {
    enterpriseId: CANDIDATE,
    admittedAt: "2026-10-01T00:00:00Z",
  });
  assert.equal(enterpriseAdmission.admitted, true);
  assert.equal(enterpriseAdmission.tally.quorumMet, true);
  assert.equal(enterpriseAdmission.tally.voterCount, 3);
  niReceipt(enterpriseAdmission.receipt);

  const cycleId = "2026-10-cycle-1";
  for (const [index, account] of [ALICE, BOB, CAROL].entries()) {
    const vote = recordDistributionVoteFromStore(statePath, dir, {
      cycleId,
      memberAccount: account,
      allocations: [{ enterpriseId: CANDIDATE, weight: 1 }],
      matchedTallyAsOf: "2026-09-30T00:00:00Z",
      recordedAt: `2026-10-01T01:0${index}:00Z`,
    });
    assert.equal(vote.recorded, true);
    assert.equal(vote.weight, 1);
    niReceipt(vote.receipt);
  }

  const tally = tallyCycleVotesFromStore(statePath, dir, {
    cycleId,
    closedAt: "2026-10-01T02:00:00Z",
  });
  assert.equal(tally.quorumMet, true);
  assert.equal(tally.voterCount, 3);
  assert.equal(tally.totalWeight, 3);
  assert.deepEqual(tally.shares, { [CANDIDATE]: 3 });
  niReceipt(tally.receipt);

  const splitRequest = {
    cycleId,
    directedYieldReceipts: [
      { memberAccount: ALICE, amount: "40", commodity: "USDC", observedAt: "2026-10-01T00:00:00Z", txHash: "0xalice-cycle" },
      { memberAccount: BOB, amount: "60", commodity: "USDC", observedAt: "2026-10-01T00:01:00Z", txHash: "0xbob-cycle" },
    ],
    totalYield: "100",
    commodity: "USDC",
    recordedAt: "2026-10-01T02:01:00Z",
  };
  const split = deriveCycleSplitFromStore(statePath, dir, splitRequest);
  assert.equal(split.reserve, "20");
  assert.equal(split.float, "30");
  assert.equal(split.distributable, "50");
  assert.equal(split.fixedPortion, "25");
  assert.equal(split.votedPortion, "25");
  assert.equal(split.quorumMet, true);
  assert.equal(split.voteMode, "weighted");
  assert.deepEqual(split.perEnterprise, [
    { enterpriseId: SEED, fixed: "12.5", voted: "0", total: "12.5" },
    { enterpriseId: CANDIDATE, fixed: "12.5", voted: "25", total: "37.5" },
  ]);
  niReceipt(split.receipt);

  // A closed cycle's split is authoritative: a replayed close is refused and leaves the store as it was.
  const storeAfterFirstClose = readFileSync(statePath, "utf8");
  assert.throws(() => deriveCycleSplitFromStore(statePath, dir, splitRequest), /already closed/u);
  assert.equal(readFileSync(statePath, "utf8"), storeAfterFirstClose);

  const reconciliation = reconcilePoolBooksFromStore(
    statePath,
    null,
    dir,
    ALICE,
    "2026-10-01T02:02:00Z",
    { fetchContentAddressed: () => aliceWitnessText },
  );
  assert.equal(reconciliation.reconciled, true);
  assert.deepEqual(reconciliation.agreed, aliceWitnessPostings);
  assert.deepEqual(reconciliation.mismatch, []);
  assert.deepEqual(reconciliation.postedOnly, []);
  assert.deepEqual(reconciliation.assertedOnly, []);
  niReceipt(reconciliation.receipt);

  const disclosureRequest = {
    cycleId,
    falsifiers: ["Yield below operating cost.", "Participation falls below quorum."],
    publishedAt: "2026-10-01T02:03:00Z",
  };
  const publication = publishCycleDisclosureFromStore(
    statePath,
    dir,
    disclosureRequest,
    { root: dir },
  );
  assert.equal(publication.published, true);
  const disclosurePath = publication.path;
  niReceipt(publication.receipt);
  const disclosureBytes = readFileSync(disclosurePath, "utf8");
  const disclosure = JSON.parse(disclosureBytes);
  assert.deepEqual(disclosure.public.roster, [
    { enterpriseId: SEED, offer: "shared receiving and settlement support, priced plainly" },
    { enterpriseId: CANDIDATE, offer: "member accounting review, priced plainly" },
  ]);
  assert.equal(disclosure.public.cycle.quorumMet, split.quorumMet);
  assert.equal(disclosure.public.cycle.voteMode, split.voteMode);
  assert.deepEqual(disclosure.public.cycle.splitRatioPercent, { reserve: 20, float: 30, distributable: 50 });
  assert.deepEqual(disclosure.public.cycle.perEnterpriseTotals, [
    { enterpriseId: SEED, total: "12.5" },
    { enterpriseId: CANDIDATE, total: "37.5" },
  ]);
  const publicKeys = new Set();
  JSON.stringify(disclosure.public, (key, value) => { publicKeys.add(key); return value; });
  for (const privateField of ["account", "memberAccount", "ledgerWitness", "recordNi", "settlementDestinations", "contact", "admissionWitness"]) {
    assert.equal(publicKeys.has(privateField), false, `public disclosure carries ${privateField}`);
  }
  for (const account of [ALICE, BOB, CAROL]) assert.equal(JSON.stringify(disclosure.public).includes(account), false);

  // A published disclosure is final: republishing is refused and the public bytes stay as they were.
  assert.throws(() => publishCycleDisclosureFromStore(
    statePath,
    dir,
    disclosureRequest,
    { root: dir },
  ), /already has a published disclosure/u);
  assert.equal(readFileSync(disclosurePath, "utf8"), disclosureBytes);

  // A separate two-voter cycle proves the persisted equal-allocation fallback.
  const fallbackCycle = "2026-10-cycle-below-quorum";
  for (const [index, account] of [ALICE, BOB].entries()) {
    const vote = recordDistributionVoteFromStore(statePath, dir, {
      cycleId: fallbackCycle,
      memberAccount: account,
      allocations: [{ enterpriseId: CANDIDATE, weight: 1 }],
      matchedTallyAsOf: "2026-09-30T00:00:00Z",
      recordedAt: `2026-10-02T01:0${index}:00Z`,
    });
    assert.equal(vote.recorded, true);
  }
  const fallbackTally = tallyCycleVotesFromStore(statePath, dir, {
    cycleId: fallbackCycle,
    closedAt: "2026-10-02T02:00:00Z",
  });
  assert.equal(fallbackTally.quorumMet, false);
  assert.equal(fallbackTally.voterCount, 2);
  const fallbackSplit = deriveCycleSplitFromStore(statePath, dir, {
    cycleId: fallbackCycle,
    directedYieldReceipts: [
      { memberAccount: ALICE, amount: "50", commodity: "USDC", observedAt: "2026-10-02T00:00:00Z", txHash: "0xalice-fallback" },
      { memberAccount: CAROL, amount: "50", commodity: "USDC", observedAt: "2026-10-02T00:01:00Z", txHash: "0xcarol-fallback" },
    ],
    totalYield: "100",
    commodity: "USDC",
    recordedAt: "2026-10-02T02:01:00Z",
  });
  assert.equal(fallbackSplit.quorumMet, false);
  assert.equal(fallbackSplit.voteMode, "equal-fallback");
  assert.deepEqual(fallbackSplit.perEnterprise, [
    { enterpriseId: SEED, fixed: "12.5", voted: "12.5", total: "25" },
    { enterpriseId: CANDIDATE, fixed: "12.5", voted: "12.5", total: "25" },
  ]);
});
