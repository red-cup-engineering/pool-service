/**
 * `votes` — the distribution vote: a member's weight is their matched-tally count
 * (`deriveMemberCreditLine`'s `matchedPairs`) read at a reference date the caller supplies —
 * the previous cycle's close, per the membership-and-governance specification's "voting-power
 * lag" ("mirroring Breadchain's one-month lag against manufacturing matched tallies just
 * before a vote"). `pool-service` does not yet own a cycle calendar, so `matchedTallyAsOf` is
 * this build lot's own explicit resolution of "the previous cycle's close": the value the
 * caller (a cycle-running script or the CLI) names, the pool's genesis time for a first cycle.
 * Quorum: fewer than three nonzero-weight voters falls back to an even split (the companion
 * `derive-cycle-split` handles the fallback once `tally-cycle-votes` reports `quorumMet: false`).
 */
import { deriveMemberCreditLine, requireText } from "./pool.mjs";

/**
 * The reserved distribution-vote cycle id an enterprise's admission proposal votes under
 * (`admit-enterprise-vote.mjs`): a full-weight allocation to the candidate signals support,
 * an all-zero allocation records quorum participation without supporting it.
 * @param {string} enterpriseId The candidate enterprise.
 * @returns {string} The reserved cycle id.
 */
export function enterpriseAdmissionCycleId(enterpriseId) {
  return `enterprise-admission:${enterpriseId}`;
}

/**
 * @typedef {object} DistributionVote
 * @property {string} cycleId
 * @property {string} memberAccount
 * @property {{enterpriseId: string, weight: number}[]} allocations
 * @property {number} weight The voter's matched-tally weight, fixed at cast time.
 * @property {string} recordedAt
 */

/**
 * Casts one member's distribution vote, weighted by their matched-tally count at
 * `matchedTallyAsOf` (membership specification, "Voting-power definition"). Refuses (as data)
 * a voter with zero matched-tally weight, and a duplicate vote for the same member and cycle.
 * @param {object} request
 * @param {DistributionVote[]} request.votes The pool's persisted vote record.
 * @param {object[]} request.tallies The pool's persisted tally record (for `deriveMemberCreditLine`).
 * @param {number} request.settlementWindowDays The pool's settlement window (for `deriveMemberCreditLine`).
 * @param {number} request.creditWindowDays The pool's credit-lookback window (for `deriveMemberCreditLine`).
 * @param {string} request.cycleId The cycle this vote counts toward.
 * @param {string} request.memberAccount The voting member.
 * @param {{enterpriseId: string, weight: number}[]} request.allocations How the member divides their weight across candidate enterprises.
 * @param {string} request.matchedTallyAsOf ISO date/time the member's matched-tally weight is read as of (the previous cycle's close).
 * @param {string} request.recordedAt ISO date/time this vote is cast at.
 * @returns {{recorded: true, votes: DistributionVote[], weight: number}|{recorded: false, reason: string}} The updated vote record and the weight applied, or a refusal naming why.
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function castDistributionVote({ votes, tallies, settlementWindowDays, creditWindowDays, cycleId, memberAccount, allocations, matchedTallyAsOf, recordedAt }) {
  requireText(cycleId, "cycleId");
  requireText(memberAccount, "memberAccount");
  requireText(matchedTallyAsOf, "matchedTallyAsOf");
  requireText(recordedAt, "recordedAt");
  if (!Array.isArray(allocations) || allocations.length === 0) throw new TypeError("votes: allocations must be a non-empty array");
  for (const a of allocations) {
    requireText(a.enterpriseId, "allocation.enterpriseId");
    if (typeof a.weight !== "number" || !Number.isFinite(a.weight) || a.weight < 0) {
      throw new TypeError(`votes: allocation.weight must be a non-negative finite number, got ${JSON.stringify(a.weight)}`);
    }
  }
  if (votes.some((v) => v.cycleId === cycleId && v.memberAccount === memberAccount)) {
    return { recorded: false, reason: `member "${memberAccount}" has already voted in cycle "${cycleId}"` };
  }
  const standing = deriveMemberCreditLine({ tallies, memberAccount, settlementWindowDays, creditWindowDays, now: matchedTallyAsOf });
  if (standing.matchedPairs === 0) {
    return { recorded: false, reason: `member "${memberAccount}" has zero matched-tally weight as of ${matchedTallyAsOf}, and cannot cast a distribution vote` };
  }
  const record = Object.freeze({ cycleId, memberAccount, allocations, weight: standing.matchedPairs, recordedAt });
  return { recorded: true, votes: [...votes, record], weight: standing.matchedPairs };
}

/**
 * Sums one cycle's recorded votes, weighted by each voter's fixed `weight`, per enterprise
 * (membership specification, "The distribution rule"). Quorum requires at least three
 * distinct members with nonzero weight to have cast a vote; below quorum the voted portion
 * MUST fall back to the fixed-portion rule, so `shares` is returned empty and `quorumMet` false
 * for the caller (`derive-cycle-split`) to act on.
 * @param {DistributionVote[]} votes The pool's persisted vote record.
 * @param {string} cycleId The cycle to tally.
 * @returns {{cycleId: string, quorumMet: boolean, voterCount: number, totalWeight: number, shares: Record<string, number>}} The cycle's tally.
 */
export function tallyCycleVotes(votes, cycleId) {
  const cycleVotes = votes.filter((v) => v.cycleId === cycleId && v.weight > 0);
  const quorumMet = cycleVotes.length >= 3;
  const shares = {};
  let totalWeight = 0;
  if (quorumMet) {
    for (const vote of cycleVotes) {
      const allocatedWeight = vote.allocations.reduce((s, a) => s + a.weight, 0);
      if (allocatedWeight === 0) continue;
      for (const a of vote.allocations) {
        const share = (a.weight / allocatedWeight) * vote.weight;
        shares[a.enterpriseId] = (shares[a.enterpriseId] ?? 0) + share;
      }
      totalWeight += vote.weight;
    }
  }
  return { cycleId, quorumMet, voterCount: cycleVotes.length, totalWeight, shares };
}
