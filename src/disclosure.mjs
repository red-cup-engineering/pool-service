/**
 * `disclosure` — one cycle's members' view and public view (membership-and-governance
 * specification, "Disclosure"): members read the barrier series, the full split and
 * per-enterprise amounts, and every member enterprise's roster record; the public reads the
 * roster and offers, the split's ratio and totals (never per-member draws), and the design's
 * named falsifiers. No per-member data enters either view.
 */

/**
 * Splits `part` of `whole` as a rounded integer percent, for a disclosure label only --
 * never a booked amount (exact-decimal arithmetic owns those; this is display rounding).
 * @param {string} part
 * @param {string} whole
 * @returns {number}
 */
function roundedPercent(part, whole) {
  const total = Number(whole);
  if (total === 0) return 0;
  return Math.round((Number(part) / total) * 100);
}

/**
 * @typedef {object} MemberEnterprise
 * @property {string} enterpriseId
 * @property {string} offer
 * @property {string} reportingCommitment
 * @property {string|null} sponsorEnterprise
 * @property {"pending"|"admitted"|"retired"} status
 */

/**
 * Derives one cycle's disclosure surface: the members' view (full detail, no per-member data)
 * and the public view (roster, split ratio and totals, falsifiers).
 * @param {object} request
 * @param {string} request.cycleId The cycle this disclosure covers.
 * @param {{date: string, amount: string}[]} request.barrierSeries The pool's own barrier series.
 * @param {object} request.split `derive-cycle-split.mjs`'s persisted result for `cycleId`.
 * @param {MemberEnterprise[]} request.enterprises The pool's persisted enterprise roster.
 * @param {string[]} request.falsifiers The design's own named falsifiers (quoted from the two specifications), published to the public view.
 * @param {string} request.publishedAt ISO date/time this disclosure is published at.
 * @returns {{type: "PoolCycleDisclosure", cycleId: string, publishedAt: string, members: object, public: object}} The disclosure record.
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function deriveCycleDisclosure({ cycleId, barrierSeries, split, enterprises, falsifiers, publishedAt }) {
  if (typeof cycleId !== "string" || cycleId.length === 0) throw new TypeError("disclosure: cycleId must be a non-empty string");
  if (!Array.isArray(barrierSeries)) throw new TypeError("disclosure: barrierSeries must be an array");
  if (!split || typeof split !== "object") throw new TypeError("disclosure: split must be an object");
  if (!Array.isArray(enterprises)) throw new TypeError("disclosure: enterprises must be an array");
  if (!Array.isArray(falsifiers)) throw new TypeError("disclosure: falsifiers must be an array");
  if (typeof publishedAt !== "string" || Number.isNaN(Date.parse(publishedAt))) throw new TypeError("disclosure: publishedAt must be an ISO date/time string");

  const admittedRoster = enterprises.filter((e) => e.status === "admitted");

  return Object.freeze({
    type: "PoolCycleDisclosure",
    cycleId,
    publishedAt,
    members: Object.freeze({
      barrierSeries: Object.freeze(barrierSeries),
      split: Object.freeze(split),
      enterprises: Object.freeze(enterprises.map((e) => Object.freeze({ ...e }))),
    }),
    public: Object.freeze({
      roster: Object.freeze(admittedRoster.map((e) => Object.freeze({ enterpriseId: e.enterpriseId, offer: e.offer }))),
      cycle: Object.freeze({
        cycleId,
        commodity: split.commodity,
        totalYield: split.totalYield,
        reserve: split.reserve,
        float: split.float,
        distributable: split.distributable,
        fixedPortion: split.fixedPortion,
        votedPortion: split.votedPortion,
        quorumMet: split.quorumMet === true,
        voteMode: split.voteMode ?? (split.quorumMet === true ? "weighted" : "equal-fallback"),
        splitRatioPercent: Object.freeze({
          reserve: roundedPercent(split.reserve, split.totalYield),
          float: roundedPercent(split.float, split.totalYield),
          distributable: roundedPercent(split.distributable, split.totalYield),
        }),
        perEnterpriseTotals: Object.freeze(split.perEnterprise.map((e) => Object.freeze({ enterpriseId: e.enterpriseId, total: e.total }))),
      }),
      falsifiers: Object.freeze([...falsifiers]),
    }),
  });
}
