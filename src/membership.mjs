/**
 * `membership` — the three `admissionWitness` kinds `admit-pool-member` verifies (membership-
 * and-governance specification, "Admission paths"): `sponsor-vouch` (a member already in good
 * tally standing pledges a bounded part of their own credit line), `enterprise-roster` (the
 * applicant is a member enterprise's own), and `turntide-islander-role` (an existing
 * community's own role, witnessed live elsewhere).
 *
 * The live Discord OAuth role check L-Space's own admission gate performs
 * (`science-services-section/sites/l-space.561.group/data/records/2026-08-29-turntide-islander-discord-admission.json`)
 * is a later lot composed from that gate; this build lot accepts a witness record a verifier
 * already produced (`{discordSubjectHash, guildId, roleId, checkedAt}`) and refuses it when
 * `checkedAt` has gone stale, per the specification's "MUST treat a stale or unrevalidated
 * check as absent membership."
 */
import { cmp, parse } from "@red-cup-engineering/energy-bank/decimal";
import { deriveMemberCreditLine } from "./pool.mjs";

/**
 * A sponsor's pledge, materialized as one matched, sponsor-originated tally so the new
 * member's line is derived from the existing `deriveMemberCreditLine` formula unmodified
 * (`matchedPairs × medianSettledSize × factor` = `1 × pledgedAmount × 1`) — "the pledge becomes
 * the new member's first line" (membership specification, "Admission paths") realized without
 * inventing a second, parallel credit-line mechanism.
 * @param {object} request
 * @param {string} request.account The new member's account.
 * @param {string} request.sponsorAccount The sponsoring member's account.
 * @param {string} request.pledgedAmount Exact decimal string: the pledged opening line.
 * @param {string} request.admittedAt ISO date/time the admission (and so the seed tally) is recorded at.
 * @returns {object} A matched `Tally` record (`src/pool.mjs`'s `Tally` shape, plus `origin` and `sponsorAccount`).
 */
export function sponsorSeedTally({ account, sponsorAccount, pledgedAmount, admittedAt }) {
  return Object.freeze({
    drawId: `sponsor-seed:${account}`,
    memberAccount: account,
    amount: pledgedAmount,
    releasedAt: admittedAt,
    admittedAt,
    status: "matched",
    origin: "sponsor-seed",
    sponsorAccount,
  });
}

/**
 * Verifies one `admissionWitness` against the pool's own state, the way `admit-pool-member`
 * must before admitting a new member (membership specification, "Admission paths").
 * @param {object} request
 * @param {object} request.pool The pool record (for its member roster and window settings).
 * @param {object[]} request.tallies The pool's persisted tally record.
 * @param {object[]} request.enterprises The pool's persisted member-enterprise roster.
 * @param {string} request.account The applicant's own account id (for the sponsor seed tally).
 * @param {{kind: "sponsor-vouch", sponsorAccount: string, pledgedAmount: string}|{kind: "enterprise-roster", enterpriseId: string}|{kind: "turntide-islander-role", discordSubjectHash: string, guildId: string, roleId: string, checkedAt: string}} request.admissionWitness
 * @param {string} request.now ISO date/time this verification runs at.
 * @returns {{verified: true, seedTally: object|null}|{verified: false, reason: string}} The verification result; `seedTally` is the sponsor-seed tally to append on a `sponsor-vouch` admission, or `null` for the other kinds.
 * @throws {TypeError} When `admissionWitness.kind` is missing or unrecognized.
 */
export function verifyAdmissionWitness({ pool, tallies, enterprises, account, admissionWitness, now }) {
  if (!admissionWitness || typeof admissionWitness.kind !== "string") {
    throw new TypeError(`membership: admissionWitness.kind must be a non-empty string, got ${JSON.stringify(admissionWitness)}`);
  }
  switch (admissionWitness.kind) {
    case "sponsor-vouch": {
      const { sponsorAccount, pledgedAmount } = admissionWitness;
      const sponsor = pool.members.find((m) => m.account === sponsorAccount);
      if (!sponsor) return { verified: false, reason: `sponsor-vouch: sponsorAccount "${sponsorAccount}" is not an admitted member of pool "${pool.id}"` };
      const sponsorStanding = deriveMemberCreditLine({ tallies, memberAccount: sponsorAccount, settlementWindowDays: pool.settlementWindowDays, creditWindowDays: pool.creditWindowDays, now });
      if (cmp(parse(sponsorStanding.limit), parse("0")) <= 0) {
        return { verified: false, reason: `sponsor-vouch: sponsor "${sponsorAccount}" has a zero derived credit line and cannot pledge` };
      }
      if (cmp(parse(pledgedAmount), parse(sponsorStanding.limit)) > 0) {
        return { verified: false, reason: `sponsor-vouch: pledgedAmount ${pledgedAmount} exceeds sponsor "${sponsorAccount}"'s derived credit line of ${sponsorStanding.limit}` };
      }
      return { verified: true, seedTally: sponsorSeedTally({ account, sponsorAccount, pledgedAmount, admittedAt: now }) };
    }
    case "enterprise-roster": {
      const { enterpriseId } = admissionWitness;
      const enterprise = enterprises.find((e) => e.enterpriseId === enterpriseId);
      if (!enterprise || enterprise.status !== "admitted") {
        return { verified: false, reason: `enterprise-roster: enterprise "${enterpriseId}" is not an admitted member enterprise` };
      }
      return { verified: true, seedTally: null };
    }
    case "turntide-islander-role": {
      const { checkedAt } = admissionWitness;
      if (typeof checkedAt !== "string" || Number.isNaN(Date.parse(checkedAt))) {
        return { verified: false, reason: "turntide-islander-role: checkedAt must be an ISO date/time string" };
      }
      const ageDays = (Date.parse(now) - Date.parse(checkedAt)) / 86_400_000;
      if (ageDays > pool.settlementWindowDays) {
        return { verified: false, reason: `turntide-islander-role: checkedAt ${checkedAt} is stale (${ageDays.toFixed(1)} days old, older than the ${pool.settlementWindowDays}-day settlement window) -- treated as absent membership` };
      }
      return { verified: true, seedTally: null };
    }
    default:
      return { verified: false, reason: `admissionWitness.kind "${admissionWitness.kind}" is not one of sponsor-vouch, enterprise-roster, turntide-islander-role` };
  }
}
