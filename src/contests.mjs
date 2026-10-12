/**
 * `contests` — opening a contest window on a `reconcilePoolBooks` bucket entry (membership-
 * and-governance specification, "Disputes and defaults"): either witness may contest a
 * `mismatch`, `postedOnly`, or `assertedOnly` entry within the pool's own settlement window;
 * resolution (an amended posting, or a standing mismatch) is the dialogue sequence the
 * specification names, not a further automated step this module performs.
 */
import { requireText } from "./pool.mjs";

/**
 * @typedef {object} Contest
 * @property {string} ref The contested posting's ref (a `reconcilePoolBooks` bucket entry).
 * @property {string} contestedBy Who raised the contest: a member account or `"pool"`.
 * @property {string} reason
 * @property {string} contestedAt
 * @property {"open"} status Resolution is a later dialogue step, never automated here.
 */

/**
 * Opens a contest on `ref`, refusing (as data) a duplicate open contest for the same ref.
 * @param {Contest[]} contests The pool's persisted contest record.
 * @param {object} request
 * @param {string} request.ref The contested posting's ref.
 * @param {string} request.contestedBy Who is raising the contest.
 * @param {string} request.reason The grounds for the contest.
 * @param {string} request.contestedAt ISO date/time the contest is raised at.
 * @returns {{contested: true, contests: Contest[], contest: Contest}|{contested: false, reason: string}} The updated contest record, or a refusal naming why.
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function openContest(contests, { ref, contestedBy, reason, contestedAt }) {
  requireText(ref, "ref");
  requireText(contestedBy, "contestedBy");
  requireText(reason, "reason");
  requireText(contestedAt, "contestedAt");
  if (contests.some((c) => c.ref === ref && c.status === "open")) {
    return { contested: false, reason: `ref "${ref}" already has an open contest` };
  }
  const contest = Object.freeze({ ref, contestedBy, reason, contestedAt, status: "open" });
  return { contested: true, contests: [...contests, contest], contest };
}
