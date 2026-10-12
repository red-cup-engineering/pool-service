/**
 * `enterprises` — the member-enterprise roster: admission behind a sponsor (the cold-start
 * sponsor rule at enterprise scale) and retirement after the dialogue-then-vote sequence
 * (membership-and-governance specification, "Member enterprises").
 */
import { requireText } from "./pool.mjs";

/** Replaces the enterprise matching `enterpriseId` with `record`, leaving every other entry untouched. */
function replaceEnterprise(enterprises, enterpriseId, record) {
  return enterprises.map((e) => (e.enterpriseId === enterpriseId ? record : e));
}

/**
 * @typedef {object} MemberEnterprise
 * @property {string} enterpriseId
 * @property {string} offer
 * @property {string} reportingCommitment
 * @property {string|null} sponsorEnterprise `null` only for the org's own first-roster seed.
 * @property {"pending"|"admitted"|"retired"} status
 * @property {string|null} admittedAt
 * @property {string|null} retiredAt
 * @property {string|null} retiredReason
 */

/**
 * Admits (or re-proposes) one member enterprise to the pending roster, pending the admission
 * vote (`admit-enterprise-vote`) — an outside enterprise's admission is a proposal put to the
 * engaged member set, never a staff decision. Requires its `sponsorEnterprise` already be
 * admitted, unless `allowUnsponsored` names it the org's own first-roster seed.
 * @param {MemberEnterprise[]} enterprises The pool's persisted enterprise roster.
 * @param {object} request
 * @param {string} request.enterpriseId Legal or trade name and contact, used as the roster key.
 * @param {string} request.offer A one-sentence receiver/offer/price statement, no identity framing.
 * @param {string} request.reportingCommitment The cadence and shape of receipts the enterprise posts to disclosure.
 * @param {string|null} request.sponsorEnterprise An already-admitted enterprise vouching for it, or `null` only when `allowUnsponsored` is true.
 * @param {boolean} [request.allowUnsponsored] True only for the org's own first-roster seed (membership specification, "Member enterprises").
 * @returns {{admitted: true, enterprises: MemberEnterprise[]}|{admitted: false, reason: string}} The updated roster (status `"pending"`), or a refusal naming why.
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function admitMemberEnterprise(enterprises, { enterpriseId, offer, reportingCommitment, sponsorEnterprise, allowUnsponsored = false }) {
  requireText(enterpriseId, "enterpriseId");
  requireText(offer, "offer");
  requireText(reportingCommitment, "reportingCommitment");
  if (enterprises.some((e) => e.enterpriseId === enterpriseId && e.status !== "retired")) {
    return { admitted: false, reason: `enterprise "${enterpriseId}" is already on the roster` };
  }
  if (!allowUnsponsored) {
    requireText(sponsorEnterprise, "sponsorEnterprise");
    const sponsor = enterprises.find((e) => e.enterpriseId === sponsorEnterprise);
    if (!sponsor || sponsor.status !== "admitted") {
      return { admitted: false, reason: `sponsorEnterprise "${sponsorEnterprise}" is not an admitted member enterprise` };
    }
  }
  const record = Object.freeze({
    enterpriseId,
    offer,
    reportingCommitment,
    sponsorEnterprise: allowUnsponsored ? null : sponsorEnterprise,
    status: allowUnsponsored ? "admitted" : "pending",
    admittedAt: null,
    retiredAt: null,
    retiredReason: null,
  });
  return { admitted: true, enterprises: [...enterprises.filter((e) => e.enterpriseId !== enterpriseId), record] };
}

/**
 * Admits a `"pending"` enterprise onto the yield roster once its admission vote has passed.
 * @param {MemberEnterprise[]} enterprises The pool's persisted enterprise roster.
 * @param {string} enterpriseId The pending enterprise to admit.
 * @param {string} admittedAt ISO date/time the admission vote closed.
 * @returns {{admitted: true, enterprises: MemberEnterprise[]}|{admitted: false, reason: string}} The updated roster, or a refusal naming why.
 */
export function confirmMemberEnterpriseAdmission(enterprises, enterpriseId, admittedAt) {
  const pending = enterprises.find((e) => e.enterpriseId === enterpriseId);
  if (!pending || pending.status !== "pending") {
    return { admitted: false, reason: `enterprise "${enterpriseId}" has no pending admission to confirm` };
  }
  const record = Object.freeze({ ...pending, status: "admitted", admittedAt });
  return { admitted: true, enterprises: replaceEnterprise(enterprises, enterpriseId, record) };
}

/**
 * Retires a member enterprise from the fixed/voted split, after the dialogue-then-vote
 * sequence has closed (membership-and-governance specification, "Member enterprises"; the
 * sequence itself is a human process this function does not model — it records the outcome).
 * @param {MemberEnterprise[]} enterprises The pool's persisted enterprise roster.
 * @param {object} request
 * @param {string} request.enterpriseId The enterprise to retire.
 * @param {string} request.reason The grounds for retirement.
 * @param {string} request.retiredAt ISO date/time the retirement took effect.
 * @returns {{retired: true, enterprises: MemberEnterprise[]}|{retired: false, reason: string}} The updated roster, or a refusal naming why.
 */
export function retireMemberEnterprise(enterprises, { enterpriseId, reason, retiredAt }) {
  requireText(enterpriseId, "enterpriseId");
  requireText(reason, "reason");
  const existing = enterprises.find((e) => e.enterpriseId === enterpriseId);
  if (!existing || existing.status !== "admitted") {
    return { retired: false, reason: `enterprise "${enterpriseId}" is not an admitted member enterprise` };
  }
  const record = Object.freeze({ ...existing, status: "retired", retiredAt, retiredReason: reason });
  return { retired: true, enterprises: replaceEnterprise(enterprises, enterpriseId, record) };
}

/**
 * The currently-admitted member enterprises' ids, in roster order — the fixed portion's
 * per-enterprise divisor (membership specification, "The distribution rule").
 * @param {MemberEnterprise[]} enterprises The pool's persisted enterprise roster.
 * @returns {string[]} Every enterpriseId with `status === "admitted"`.
 */
export function admittedEnterpriseIds(enterprises) {
  return enterprises.filter((e) => e.status === "admitted").map((e) => e.enterpriseId);
}
