import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJson } from "@red-cup-engineering/json-schema-services-section/validation";

import admitPoolMemberInput from "../schemas/admit-pool-member.input.schema.json" with { type: "json" };
import admitPoolMemberOutput from "../schemas/admit-pool-member.output.schema.json" with { type: "json" };
import deriveMemberCreditLineInput from "../schemas/derive-member-credit-line.input.schema.json" with { type: "json" };
import deriveMemberCreditLineOutput from "../schemas/derive-member-credit-line.output.schema.json" with { type: "json" };
import derivePoolBarrierSeriesInput from "../schemas/derive-pool-barrier-series.input.schema.json" with { type: "json" };
import derivePoolBarrierSeriesOutput from "../schemas/derive-pool-barrier-series.output.schema.json" with { type: "json" };
import frontPoolDrawInput from "../schemas/front-pool-draw.input.schema.json" with { type: "json" };
import frontPoolDrawOutput from "../schemas/front-pool-draw.output.schema.json" with { type: "json" };
import reconcilePoolBooksInput from "../schemas/reconcile-pool-books.input.schema.json" with { type: "json" };
import reconcilePoolBooksOutput from "../schemas/reconcile-pool-books.output.schema.json" with { type: "json" };
import settlePoolDrawInput from "../schemas/settle-pool-draw.input.schema.json" with { type: "json" };
import settlePoolDrawOutput from "../schemas/settle-pool-draw.output.schema.json" with { type: "json" };
import contributeToPoolInput from "../schemas/contribute-to-pool.input.schema.json" with { type: "json" };
import contributeToPoolOutput from "../schemas/contribute-to-pool.output.schema.json" with { type: "json" };
import admitMemberEnterpriseInput from "../schemas/admit-member-enterprise.input.schema.json" with { type: "json" };
import admitMemberEnterpriseOutput from "../schemas/admit-member-enterprise.output.schema.json" with { type: "json" };
import retireMemberEnterpriseInput from "../schemas/retire-member-enterprise.input.schema.json" with { type: "json" };
import retireMemberEnterpriseOutput from "../schemas/retire-member-enterprise.output.schema.json" with { type: "json" };
import recordDistributionVoteInput from "../schemas/record-distribution-vote.input.schema.json" with { type: "json" };
import recordDistributionVoteOutput from "../schemas/record-distribution-vote.output.schema.json" with { type: "json" };
import tallyCycleVotesInput from "../schemas/tally-cycle-votes.input.schema.json" with { type: "json" };
import tallyCycleVotesOutput from "../schemas/tally-cycle-votes.output.schema.json" with { type: "json" };
import deriveCycleSplitInput from "../schemas/derive-cycle-split.input.schema.json" with { type: "json" };
import deriveCycleSplitOutput from "../schemas/derive-cycle-split.output.schema.json" with { type: "json" };
import admitEnterpriseVoteInput from "../schemas/admit-enterprise-vote.input.schema.json" with { type: "json" };
import admitEnterpriseVoteOutput from "../schemas/admit-enterprise-vote.output.schema.json" with { type: "json" };
import contestPoolReceiptInput from "../schemas/contest-pool-receipt.input.schema.json" with { type: "json" };
import contestPoolReceiptOutput from "../schemas/contest-pool-receipt.output.schema.json" with { type: "json" };
import deriveSetOfPoolCycleTransactionsInput from "../schemas/derive-set-of-pool-cycle-transactions.input.schema.json" with { type: "json" };
import deriveSetOfPoolCycleTransactionsOutput from "../schemas/derive-set-of-pool-cycle-transactions.output.schema.json" with { type: "json" };
import reconcilePoolReceiptsInput from "../schemas/reconcile-pool-receipts.input.schema.json" with { type: "json" };
import reconcilePoolReceiptsOutput from "../schemas/reconcile-pool-receipts.output.schema.json" with { type: "json" };
import publishCycleDisclosureInput from "../schemas/publish-cycle-disclosure.input.schema.json" with { type: "json" };
import publishCycleDisclosureOutput from "../schemas/publish-cycle-disclosure.output.schema.json" with { type: "json" };
import poolCycleDisclosure from "../schemas/pool-cycle-disclosure.schema.json" with { type: "json" };
import tidepoolMemberEnterpriseRoster from "../schemas/tidepool-member-enterprise-roster.schema.json" with { type: "json" };

function assertValid(value, schema, label) {
  const result = validateJson({ value, schema });
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.errors)}`);
}

function assertInvalid(value, schema, label) {
  const result = validateJson({ value, schema });
  assert.equal(result.valid, false, `${label}: expected schema refusal`);
}

test("admit-pool-member: request and both result shapes validate against their schemas", () => {
  assertValid({ poolId: "t", settlementWindowDays: 7, account: "pool:account-base", settlementDestinations: [{ rail: "base", address: "0xabc" }], ledgerWitness: { kind: "content-addressed-postings", recordNi: "ni:///sha-256;abc", provider: "member-store", subject: "ledger:base" } }, admitPoolMemberInput, "input (v2 Base-only)");
  assertValid({ account: "pool:account-existing", settlementDestinations: [{ rail: "base", address: "0x123" }], ledgerWitness: { kind: "content-addressed-postings", recordNi: "ni:///sha-256;ghi", provider: "member-store", subject: "ledger:existing" } }, admitPoolMemberInput, "input (existing pool needs no bootstrap fields)");
  assertInvalid({ account: "pool:account-witnessed", settlementDestinations: [{ rail: "base", address: "0x456" }], ledgerWitness: { kind: "content-addressed-postings", recordNi: "ni:///sha-256;jkl", provider: "member-store", subject: "ledger:witnessed" }, admissionWitness: { kind: "enterprise-roster", enterpriseId: "ent-1" } }, admitPoolMemberInput, "input (witnessed admission missing admittedAt)");
  assertValid({ poolId: "t", settlementWindowDays: 7, account: "pool:account-dual", settlementDestinations: [{ rail: "base", address: "0xdef" }, { rail: "hive", account: "dual-hive" }], ledgerWitness: { kind: "content-addressed-postings", recordNi: "ni:///sha-256;def", provider: "member-store", subject: "ledger:dual" } }, admitPoolMemberInput, "input (v2 dual rail)");
  assertValid({ poolId: "t", settlementWindowDays: 7, account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount" }, admitPoolMemberInput, "input (legacy adapter)");
  assertValid({ poolId: "t", settlementWindowDays: 7, account: "pool:account-bob", hiveAccount: "bob-hive", baseAddress: "0xabc", ledgerPath: "/bob.beancount", admissionWitness: { kind: "sponsor-vouch", sponsorAccount: "pool:account-alice", pledgedAmount: "10" }, admittedAt: "2026-09-05T00:00:00Z" }, admitPoolMemberInput, "input (sponsor-vouch)");
  assertValid({ poolId: "t", settlementWindowDays: 7, account: "pool:account-carol", hiveAccount: "carol-hive", ledgerPath: "/carol.beancount", admissionWitness: { kind: "enterprise-roster", enterpriseId: "ent-1" }, admittedAt: "2026-09-05T00:00:00Z" }, admitPoolMemberInput, "input (enterprise-roster)");
  assertValid({ poolId: "t", settlementWindowDays: 7, account: "pool:account-dana", hiveAccount: "dana-hive", ledgerPath: "/dana.beancount", admissionWitness: { kind: "turntide-islander-role", discordSubjectHash: "h1", guildId: "g1", roleId: "r1", checkedAt: "2026-09-04T00:00:00Z" }, admittedAt: "2026-09-05T00:00:00Z" }, admitPoolMemberInput, "input (turntide-islander-role)");
  assertValid({ admitted: true, pool: { id: "t" } }, admitPoolMemberOutput, "output (admitted, no receipt)");
  assertValid({ admitted: true, pool: { id: "t" }, receipt: "ni:///sha-256;abc" }, admitPoolMemberOutput, "output (admitted, receipted)");
  assertValid({ admitted: false, reason: "already admitted" }, admitPoolMemberOutput, "output (refused)");
});

test("admit-member-enterprise: request and both result shapes validate against their schemas", () => {
  assertValid({ enterpriseId: "ent-1", offer: "a scored letter, priced plainly", reportingCommitment: "monthly", sponsorEnterprise: "ent-0", proposedAt: "2026-09-05T00:00:00Z" }, admitMemberEnterpriseInput, "input");
  assertValid({ admitted: true, receipt: "ni:///sha-256;abc" }, admitMemberEnterpriseOutput, "output (admitted)");
  assertValid({ admitted: false, reason: "already on the roster" }, admitMemberEnterpriseOutput, "output (refused)");
});

test("retire-member-enterprise: request and both result shapes validate against their schemas", () => {
  assertValid({ enterpriseId: "ent-1", reason: "three cycles of no reporting", retiredAt: "2026-09-05T00:00:00Z" }, retireMemberEnterpriseInput, "input");
  assertValid({ retired: true, receipt: "ni:///sha-256;abc" }, retireMemberEnterpriseOutput, "output (retired)");
  assertValid({ retired: false, reason: "not an admitted member enterprise" }, retireMemberEnterpriseOutput, "output (refused)");
});

test("record-distribution-vote: request and both result shapes validate against their schemas", () => {
  assertValid({ cycleId: "2026-09-cycle-1", memberAccount: "pool:account-alice", allocations: [{ enterpriseId: "ent-1", weight: 1 }], matchedTallyAsOf: "2026-08-31T00:00:00Z", recordedAt: "2026-09-05T00:00:00Z" }, recordDistributionVoteInput, "input");
  assertValid({ recorded: true, weight: 3, receipt: "ni:///sha-256;abc" }, recordDistributionVoteOutput, "output (recorded)");
  assertValid({ recorded: false, reason: "zero matched-tally weight" }, recordDistributionVoteOutput, "output (refused)");
});

test("tally-cycle-votes: request and result validate against their schemas", () => {
  assertValid({ cycleId: "2026-09-cycle-1", closedAt: "2026-09-30T00:00:00Z" }, tallyCycleVotesInput, "input");
  assertValid({
    cycleId: "2026-09-cycle-1",
    quorumMet: true,
    voterCount: 3,
    totalWeight: 7,
    shares: { "ent-1": 4, "ent-2": 3 },
    closedAt: "2026-09-30T00:00:00Z",
    voteEvidence: { recordNi: "ni:///sha-256;abc", voteCount: 3, excludedLateVoteCount: 0 },
    receipt: "ni:///sha-256;abc",
  }, tallyCycleVotesOutput, "output");
});

test("derive-cycle-split: request and result validate against their schemas", () => {
  const directedYieldReceipts = [
    { memberAccount: "pool:account-alice", amount: "40", commodity: "USDC", observedAt: "2026-09-30T00:00:00Z", txHash: "0xaaa" },
    { memberAccount: "pool:account-bob", amount: "60", commodity: "USDC", observedAt: "2026-09-30T00:01:00Z", txHash: "0xbbb" },
  ];
  assertValid({ cycleId: "2026-09-cycle-1", directedYieldReceipts, totalYield: "100.0", commodity: "USDC", recordedAt: "2026-09-30T00:02:00Z" }, deriveCycleSplitInput, "input");
  assertInvalid({ cycleId: "2026-09-cycle-1", totalYield: "100", commodity: "USDC", recordedAt: "2026-09-30T00:02:00Z" }, deriveCycleSplitInput, "input missing receipt evidence");
  assertValid({
    cycleId: "2026-09-cycle-1", commodity: "USDC", totalYield: "100", reserve: "20", float: "30", distributable: "50", fixedPortion: "25", votedPortion: "25", quorumMet: true, voteMode: "weighted",
    yieldEvidence: { recordNi: "ni:///sha-256;abc", receiptCount: 2, observedThrough: "2026-09-30T00:01:00Z" },
    perEnterprise: [{ enterpriseId: "ent-1", fixed: "12.5", voted: "12.5", total: "25" }, { enterpriseId: "ent-2", fixed: "12.5", voted: "12.5", total: "25" }],
    receipt: "ni:///sha-256;abc",
  }, deriveCycleSplitOutput, "output");
});

test("admit-enterprise-vote: request and both result shapes validate against their schemas", () => {
  assertValid({ enterpriseId: "ent-1", admittedAt: "2026-09-05T00:00:00Z" }, admitEnterpriseVoteInput, "input");
  assertValid({ admitted: true, tally: { cycleId: "enterprise-admission:ent-1" }, receipt: "ni:///sha-256;abc" }, admitEnterpriseVoteOutput, "output (admitted)");
  assertValid({ admitted: false, reason: "did not pass", tally: { cycleId: "enterprise-admission:ent-1" } }, admitEnterpriseVoteOutput, "output (refused)");
});

test("contest-pool-receipt: request and both result shapes validate against their schemas", () => {
  assertValid({ ref: "draw:1", contestedBy: "pool:account-alice", reason: "posting missing from my ledger", contestedAt: "2026-09-05T00:00:00Z" }, contestPoolReceiptInput, "input");
  assertValid({ contested: true, contest: { ref: "draw:1", contestedBy: "pool:account-alice", reason: "posting missing", contestedAt: "2026-09-05T00:00:00Z", status: "open" }, receipt: "ni:///sha-256;abc" }, contestPoolReceiptOutput, "output (contested)");
  assertValid({ contested: false, reason: "already has an open contest" }, contestPoolReceiptOutput, "output (refused)");
});

test("derive-member-credit-line: request and result validate against their schemas", () => {
  assertValid({ account: "pool:account-alice", now: "2026-09-05T00:00:00Z" }, deriveMemberCreditLineInput, "input");
  assertValid({ limit: "20", matchedPairs: 2, medianSettledSize: "10", factor: 1, openHalfTallies: 0, staleHalfTallies: 0 }, deriveMemberCreditLineOutput, "output");
});

test("derive-pool-barrier-series: request and result validate against their schemas", () => {
  assertValid({ baseFloor: "20", obligations: [{ memberAccount: "a", kind: "rent", dueDate: "2026-09-25T00:00:00Z", amount: "30" }] }, derivePoolBarrierSeriesInput, "input");
  assertValid([{ date: "2026-09-15", amount: "50" }], derivePoolBarrierSeriesOutput, "output");
});

test("front-pool-draw: request and both result shapes validate against their schemas", () => {
  assertValid({ account: "pool:account-alice", amount: "10", feeAvoided: "2", inflowDate: "2026-09-10", dueDate: "2026-09-12", requestedAt: "2026-09-05T00:00:00Z" }, frontPoolDrawInput, "input");
  assertValid({ admitted: true, drawId: "draw:1", price: "2", dueDate: "2026-09-12", transferIntent: {}, receipt: "ni:///sha-256;abc" }, frontPoolDrawOutput, "output (admitted)");
  assertValid({ admitted: false, reason: "exceeds credit line" }, frontPoolDrawOutput, "output (refused)");
});

test("reconcile-pool-books: request and result validate against their schemas", () => {
  assertValid({ account: "pool:account-alice", memberLedgerPath: "/alice.json", recordedAt: "2026-09-05T00:00:00Z" }, reconcilePoolBooksInput, "input");
  assertValid({ reconciled: true, agreed: [], mismatch: [], postedOnly: [], assertedOnly: [], receipt: "ni:///sha-256;abc" }, reconcilePoolBooksOutput, "output (reconciled)");
  assertValid({ reconciled: false, witnessState: "unavailable", reason: "member witness unavailable" }, reconcilePoolBooksOutput, "output (witness unavailable)");
});

test("settle-pool-draw: request and both result shapes validate against their schemas", () => {
  assertValid({ drawId: "draw:1", admittedAt: "2026-09-12T00:00:00Z" }, settlePoolDrawInput, "input");
  assertValid({ settled: true, tally: { drawId: "draw:1", memberAccount: "pool:account-alice", amount: "10", releasedAt: "2026-09-05T00:00:00Z", admittedAt: "2026-09-12T00:00:00Z", status: "matched" }, receipt: "ni:///sha-256;abc" }, settlePoolDrawOutput, "output (settled)");
  assertValid({ settled: false, reason: "not open for settlement" }, settlePoolDrawOutput, "output (refused)");
});

test("derive-set-of-pool-cycle-transactions: request and both result shapes validate against their schemas", () => {
  assertValid({
    cycleId: "2026-09-cycle-1",
    directedYieldReceipts: [{ memberAccount: "pool:account-org", amount: "100", commodity: "USDC", observedAt: "2026-09-01T00:00:00Z", txHash: "0xabc" }],
    drawFees: [{ drawId: "draw:1", memberAccount: "pool:account-alice", amount: "2", commodity: "HBD", settledAt: "2026-09-03T00:00:00Z" }],
    receivedAt: "2026-09-01T00:00:00Z", distributedAt: "2026-09-05T00:00:00Z", recordedAt: "2026-09-05T00:00:00Z",
  }, deriveSetOfPoolCycleTransactionsInput, "input");
  assertValid({ booked: true, recovered: false, path: "/tmp/x.beancount", sidecarNi: "ni:///sha-256;def", transactionCount: 4, receipt: "ni:///sha-256;abc" }, deriveSetOfPoolCycleTransactionsOutput, "output (booked)");
  assertValid({ booked: true, recovered: true, path: "/tmp/x.beancount", sidecarNi: "ni:///sha-256;def", transactionCount: 4, receipt: "ni:///sha-256;abc" }, deriveSetOfPoolCycleTransactionsOutput, "output (booked, recovered)");
  assertInvalid({ booked: true, path: "/tmp/x.beancount", transactionCount: 4, receipt: "ni:///sha-256;abc" }, deriveSetOfPoolCycleTransactionsOutput, "output (booked without sidecar witness)");
  assertValid({ booked: false, reason: "receipts do not sum to the split's totalYield" }, deriveSetOfPoolCycleTransactionsOutput, "output (refused)");
});

test("reconcile-pool-receipts: request and both result shapes validate against their schemas", () => {
  assertValid({ walletRegistryPath: "/registry.json", walletId: "tidepool-pool-base", sidecarPath: "/sidecar.beancount", recordedAt: "2026-09-05T00:00:00Z" }, reconcilePoolReceiptsInput, "input");
  assertValid({ reconciled: true, agreed: [], mismatch: [], postedOnly: [], assertedOnly: [], receipt: "ni:///sha-256;abc" }, reconcilePoolReceiptsOutput, "output (reconciled)");
  assertValid({ reconciled: false, reason: 'no wallet registered under id "tidepool-pool-base" in /registry.json' }, reconcilePoolReceiptsOutput, "output (refused)");
});

test("publish-cycle-disclosure: request and result validate against their schemas", () => {
  assertValid({ cycleId: "2026-09-cycle-1", falsifiers: ["Yield below operating cost."], publishedAt: "2026-09-05T00:00:00Z" }, publishCycleDisclosureInput, "input");
  assertValid({ published: true, path: "/records/2026-09-05-pool-cycle-disclosure-2026-09-cycle-1.json", receipt: "ni:///sha-256;abc" }, publishCycleDisclosureOutput, "output");
});

test("pool-cycle-disclosure record: validates against its schema", () => {
  assertValid({
    type: "PoolCycleDisclosure", cycleId: "2026-09-cycle-1", publishedAt: "2026-09-05T00:00:00Z",
    members: {
      barrierSeries: [{ date: "2026-09-01", amount: "50" }],
      split: { cycleId: "2026-09-cycle-1" },
      enterprises: [{ enterpriseId: "ent-1", offer: "a scored letter, priced plainly", reportingCommitment: "monthly", sponsorEnterprise: null, status: "admitted", admittedAt: "2026-08-01T00:00:00Z", retiredAt: null, retiredReason: null }],
    },
    public: {
      roster: [{ enterpriseId: "ent-1", offer: "a scored letter, priced plainly" }],
      cycle: {
        cycleId: "2026-09-cycle-1", commodity: "USDC", totalYield: "100", reserve: "20", float: "30", distributable: "50", fixedPortion: "25", votedPortion: "25", quorumMet: true, voteMode: "weighted",
        splitRatioPercent: { reserve: 20, float: 30, distributable: 50 },
        perEnterpriseTotals: [{ enterpriseId: "ent-1", total: "25" }],
      },
      falsifiers: ["Yield below operating cost."],
    },
  }, poolCycleDisclosure, "pool-cycle-disclosure record");
});

test("tidepool-member-enterprise-roster record: validates against its schema", () => {
  assertValid({
    type: "TidepoolMemberEnterpriseRoster", seededAt: "2026-09-05T00:00:00Z",
    sourceNote: "561-group-enterprise-services-section/.../2026-09-05-note-on-collapse-aware-financial-enterprises.md",
    enterprises: [
      { enterpriseId: "climate-event-contract-desk", offer: "a scored forecast", reportingCommitment: "scored on settlement", sourceSection: "section 1", admitted: true, receipt: "ni:///sha-256;abc" },
    ],
  }, tidepoolMemberEnterpriseRoster, "roster record");
});

test("contribute-to-pool: request and both result shapes validate against their schemas", () => {
  assertValid({ account: "pool:account-alice", amount: "20", commodity: "HBD", sourceSleeve: "pool:account-alice", contributedAt: "2026-09-05T12:00:00Z" }, contributeToPoolInput, "input");
  assertValid({ admitted: true, posting: { date: "2026-09-05", ref: "contrib-1", account: "pool:account-alice", amount: "20", commodity: "HBD" }, receipt: "ni:///sha-256;abc" }, contributeToPoolOutput, "output (admitted)");
  assertValid({ admitted: false, reason: "not an admitted member" }, contributeToPoolOutput, "output (refused)");
});
