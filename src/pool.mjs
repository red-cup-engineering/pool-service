/**
 * `pool` — the poor's manufactured ensemble ("Sizing without a bank", 2026-09-04, section 4):
 * N members pooling bounded sleeves so a member's ruin is re-seeded, not absorbing. The pool
 * is itself a sleeve with its own barrier; draws are priced on circulation (tally credit), not
 * balance ("Three ways to turn capital into capital", 2026-09-04, section 3). See README.
 */
import { parse, format, cmp, add } from "@red-cup-engineering/energy-bank/decimal";
import { energyAccountPath } from "@red-cup-engineering/energy-bank/accounts";
import { createLedger } from "@red-cup-engineering/energy-bank/ledger";
import { fundAccount, transferEnergy, contributeToPool as postContributionToPool, poolAccountId } from "@red-cup-engineering/energy-bank/transfer";
import { normalizeLedgerWitness } from "./ledger-witness.mjs";

/** The pool's one settlement unit (economics-science note section 4; fintech-for-the-tiyospaye
 *  note section 5, "Hive moves a dollar-pegged token in three seconds for nothing"). */
export const HBD = "HBD";

/**
 * The chart-of-accounts path one member's or the pool's own account posts under in the pool's
 * energy-bank ledger, derived from the pool's own HBD commodity (energy-bank's
 * `liabilities:energy:*` account-path leak under a non-ENERGY commodity was fixed upstream in
 * `@red-cup-engineering/energy-bank@0.3.1`'s `accounts.mjs`; this pool always names its
 * commodity explicitly rather than relying on that function's ENERGY default).
 * @param {string} account An account id (a member's or the pool's).
 * @returns {string} The ledger path that account's HBD postings carry.
 */
export function ledgerAccountPath(account) {
  return energyAccountPath(account, HBD);
}

const ZERO = parse("0");

/**
 * Requires `value` to be a non-empty string, the one validation guard every module in this
 * package shares (`jsnode_duplication` named the un-exported local copies a finding this
 * consolidation resolves).
 * @param {*} value The value to check.
 * @param {string} label The field name to name in the thrown error.
 * @returns {string} `value`, unchanged.
 * @throws {TypeError} When `value` is not a non-empty string.
 */
export function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`pool: ${label} must be a non-empty string, got ${JSON.stringify(value)}`);
  return value;
}

function requireDecimal(value, label) {
  try {
    return parse(value);
  } catch {
    throw new TypeError(`pool: ${label} must be an exact decimal string, got ${JSON.stringify(value)}`);
  }
}

function requireDate(value, label) {
  requireText(value, label);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`pool: ${label} must be an ISO date/time string, got ${JSON.stringify(value)}`);
  return value;
}

// ── the pool record ─────────────────────────────────────────────────────────────────────

/**
 * Constructs a new, empty pool record: no members, no barrier series, an empty HBD ledger.
 * @param {object} request
 * @param {string} request.id Local pool id, namespaced into a ledger account via `poolAccountId`.
 * @param {string} [request.namespace] Ledger namespace; defaults to `"pool"`.
 * @param {number} request.settlementWindowDays Days a draw has to settle before its half-tally is "old" (three-ways note section 3, and the draw's own due date default).
 * @param {number} [request.creditWindowDays] Lookback window for counting matched tallies toward a member's line; defaults to 90.
 * @param {string|null} [request.hiveAccount] The pool's own Hive account, the settlement source for a draw's transfer intent; null (unarmed) until the founder names one.
 * @returns {object} A frozen pool record: `{id, namespace, account, hiveAccount, members: [], barrierSeries: [], settlementWindowDays, creditWindowDays, ledger: {entries: []}, tallies: []}`.
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function createPool({ id, namespace = "pool", settlementWindowDays, creditWindowDays = 90, hiveAccount = null }) {
  requireText(id, "id");
  requireText(namespace, "namespace");
  if (!Number.isInteger(settlementWindowDays) || settlementWindowDays <= 0) throw new TypeError(`pool: settlementWindowDays must be a positive integer, got ${JSON.stringify(settlementWindowDays)}`);
  if (!Number.isInteger(creditWindowDays) || creditWindowDays <= 0) throw new TypeError(`pool: creditWindowDays must be a positive integer, got ${JSON.stringify(creditWindowDays)}`);
  if (hiveAccount !== null) requireText(hiveAccount, "hiveAccount");
  return Object.freeze({
    id,
    namespace,
    account: poolAccountId(namespace, id),
    hiveAccount,
    members: [],
    barrierSeries: [],
    settlementWindowDays,
    creditWindowDays,
    ledger: { entries: [] },
    tallies: [],
  });
}

/**
 * Normalize one supported settlement destination into the v2 membership resource shape.
 * @param {object} destination
 * @returns {object}
 */
export function normalizeSettlementDestination(destination) {
  if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
    throw new TypeError("pool: settlement destination must be an object");
  }
  if (destination.rail === "hive") {
    return Object.freeze({ rail: "hive", account: requireText(destination.account, "settlementDestination.account") });
  }
  if (destination.rail === "base") {
    return Object.freeze({ rail: "base", address: requireText(destination.address, "settlementDestination.address") });
  }
  throw new TypeError(`pool: unsupported settlement rail ${JSON.stringify(destination.rail)}`);
}

function normalizeSettlementDestinations(destinations) {
  if (!Array.isArray(destinations) || destinations.length === 0) {
    throw new TypeError("pool: member.settlementDestinations must contain at least one supported destination");
  }
  const normalized = destinations.map(normalizeSettlementDestination);
  const keys = normalized.map((destination) => destination.rail);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("pool: member.settlementDestinations may name each rail at most once");
  }
  return Object.freeze(normalized);
}

/**
 * Deterministically migrate a historical 0.5.0 member record to the v2 membership shape.
 * No draw/tally data lives in this record, so migration changes identity metadata only.
 */
export function migrateLegacyMember(member) {
  if (!member || typeof member !== "object" || Array.isArray(member)) {
    throw new TypeError("pool: member must be an object");
  }
  const account = requireText(member.account, "member.account");
  const settlementDestinations = Array.isArray(member.settlementDestinations)
    ? normalizeSettlementDestinations(member.settlementDestinations)
    : normalizeSettlementDestinations([
        ...(member.hiveAccount ? [{ rail: "hive", account: member.hiveAccount }] : []),
        ...(member.baseAddress ? [{ rail: "base", address: member.baseAddress }] : []),
      ]);
  const ledgerWitness = normalizeLedgerWitness(
    member.ledgerWitness
      ?? (member.ledgerPath ? { kind: "local-file", path: member.ledgerPath } : null),
  );
  return Object.freeze({ account, settlementDestinations, ledgerWitness });
}

/**
 * Resolve one member's destination for a named settlement rail across both v2 and 0.5.0
 * identity shapes. Returns null when the member has no destination on that rail.
 */
export function settlementDestinationForRail(member, rail) {
  requireText(rail, "settlement rail");
  const migrated = migrateLegacyMember(member);
  return migrated.settlementDestinations.find((destination) => destination.rail === rail) ?? null;
}

/** Migrate all persisted member identity records while preserving every other pool field. */
export function migrateLegacyPoolMembership(pool) {
  if (!pool || typeof pool !== "object" || !Array.isArray(pool.members)) {
    throw new TypeError("pool: persisted pool must contain members[]");
  }
  return Object.freeze({
    ...pool,
    members: Object.freeze(pool.members.map(migrateLegacyMember)),
  });
}

/**
 * Admit one member using membership v2 resources.
 *
 * The public contract is {account, settlementDestinations, ledgerWitness}. Legacy
 * hiveAccount/baseAddress/ledgerPath inputs remain an adapter for 0.5.0 callers; they are
 * converted before persistence and never create a placeholder Hive identity for Base-only
 * members.
 */
export function admitMember(pool, {
  account,
  settlementDestinations = undefined,
  ledgerWitness = undefined,
  hiveAccount = undefined,
  baseAddress = null,
  ledgerPath = undefined,
}) {
  requireText(account, "member.account");
  const destinations = settlementDestinations === undefined
    ? normalizeSettlementDestinations([
        ...(hiveAccount ? [{ rail: "hive", account: hiveAccount }] : []),
        ...(baseAddress ? [{ rail: "base", address: baseAddress }] : []),
      ])
    : normalizeSettlementDestinations(settlementDestinations);
  const witness = normalizeLedgerWitness(
    ledgerWitness ?? (ledgerPath ? { kind: "local-file", path: ledgerPath } : null),
  );
  if (pool.members.some((m) => m.account === account)) {
    return { admitted: false, reason: `member "${account}" is already admitted to pool "${pool.id}"` };
  }
  const members = [...pool.members, Object.freeze({ account, settlementDestinations: destinations, ledgerWitness: witness })];
  return { admitted: true, pool: Object.freeze({ ...pool, members: Object.freeze(members) }) };
}

// ── Beancount account-path components (the shared owner of a duplicate `cycle-transactions.mjs`
// and `@red-cup-engineering/consumption-hedge-service` each carried locally) ────────────────────

/**
 * Capitalizes each hyphen- or space-separated word of an id into one Beancount account
 * component, the one shape every Beancount-account-name builder in this package (and in
 * `@red-cup-engineering/consumption-hedge-service`, which composes this pool) shares.
 * @param {string} text
 * @returns {string}
 */
export function toAccountComponent(text) {
  return String(text)
    .trim()
    .split(/[\s-]+/u)
    .filter(Boolean)
    .map((word) => (/^\d/u.test(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("-");
}

// ── the barrier series ──────────────────────────────────────────────────────────────────

/**
 * Builds the pool's barrier as a dated, rising step series from members' declared obligations
 * (economics-science note section 5: "every sleeve therefore carries its barrier as a time
 * series, not a number"). The barrier at a date is `baseFloor` plus the sum of every obligation
 * whose due date falls within `leadDays` after that date — so the barrier rises ahead of a
 * cluster of obligations (everyone's rent due on the first) and falls back once they clear.
 * @param {object} request
 * @param {string} request.baseFloor Exact HBD decimal string: the barrier with no obligations pending.
 * @param {{memberAccount: string, kind: string, dueDate: string, amount: string}[]} request.obligations Declared rent/utility/heating obligations.
 * @param {number} [request.leadDays] Forward-looking window in which a due obligation counts toward the barrier; defaults to 14.
 * @returns {{date: string, amount: string}[]} A barrier series sorted by date ascending, one entry per breakpoint (`dueDate - leadDays` and the day after `dueDate`).
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function derivePoolBarrierSeries({ baseFloor, obligations, leadDays = 14 }) {
  const floor = requireDecimal(baseFloor, "baseFloor");
  if (!Array.isArray(obligations)) throw new TypeError("pool: obligations must be an array");
  if (!Number.isInteger(leadDays) || leadDays < 0) throw new TypeError(`pool: leadDays must be a non-negative integer, got ${JSON.stringify(leadDays)}`);

  const windows = obligations.map((o) => {
    requireText(o.memberAccount, "obligation.memberAccount");
    requireText(o.kind, "obligation.kind");
    requireDate(o.dueDate, "obligation.dueDate");
    const amount = requireDecimal(o.amount, "obligation.amount");
    const due = new Date(o.dueDate);
    const start = new Date(due.getTime() - leadDays * 86_400_000);
    const end = new Date(due.getTime() + 86_400_000); // the obligation clears the day after it is due
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), amount };
  });

  const breakpoints = new Set([
    ...windows.map((w) => w.start),
    ...windows.map((w) => w.end),
  ]);
  const dates = [...breakpoints].sort();

  const series = dates.map((date) => {
    const pending = windows.filter((w) => w.start <= date && date < w.end).map((w) => w.amount);
    const total = pending.reduce((acc, amount) => add(acc, amount), ZERO);
    return { date, amount: format(add(floor, total)) };
  });
  return series;
}

/**
 * The barrier in effect at `date`: the latest series entry at or before it (a step function),
 * or the given base floor when `date` precedes every breakpoint or the series is empty.
 * @param {{date: string, amount: string}[]} barrierSeries A series from `derivePoolBarrierSeries`.
 * @param {string} date An ISO date to evaluate the barrier at.
 * @param {string} [baseFloor] The floor to report before the series' first breakpoint; defaults to `"0"`.
 * @returns {string} The exact HBD decimal string barrier in effect at `date`.
 */
export function barrierAt(barrierSeries, date, baseFloor = "0") {
  requireDate(date, "date");
  const day = date.slice(0, 10);
  const applicable = barrierSeries.filter((row) => row.date <= day).sort((a, b) => (a.date < b.date ? -1 : 1));
  return applicable.length === 0 ? format(requireDecimal(baseFloor, "baseFloor")) : applicable.at(-1).amount;
}

// ── member standing: the tally-credit formula ──────────────────────────────────────────

/**
 * A tally records one draw's two crossings: a release receipt (the front) and, once repaid, an
 * admission receipt (the match). Default is a mismatch held in FOUR, never an eviction (the
 * "Three ways to turn capital into capital" note section 3, instrument clause 4).
 * @typedef {object} Tally
 * @property {string} drawId
 * @property {string} memberAccount
 * @property {string} amount Exact HBD decimal string.
 * @property {string} releasedAt ISO date the draw was fronted.
 * @property {string|null} admittedAt ISO date the draw was repaid, or null while open.
 * @property {"open"|"matched"} status
 */

function median(values) {
  if (values.length === 0) return ZERO;
  const sorted = [...values].sort((a, b) => cmp(a, b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : midpoint(sorted[mid - 1], sorted[mid]);
}

/** The exact-enough midpoint of two decimals, at one extra decimal place. */
function midpoint(a, b) {
  return parse((Number(format(add(a, b))) / 2).toString());
}

/**
 * Derives a member's credit line from their tally record alone (the three-ways note's rule):
 * `limit = matchedPairsInWindow × medianSettledSize × factor`, where `factor` is 1 unless the
 * member holds an open half-tally older than `settlementWindowDays`, in which case it is 0 —
 * the note's "falls to zero" is implemented here as a hard cutoff, not a smooth decay; a
 * finer factor is a documented refinement, not this function's claim.
 * @param {object} request
 * @param {Tally[]} request.tallies Every tally on record for this member.
 * @param {string} request.memberAccount The member to derive a line for.
 * @param {number} request.settlementWindowDays Days after which an open half-tally is "old".
 * @param {number} request.creditWindowDays Days of lookback for counting matched pairs.
 * @param {string} request.now ISO date/time "now" is evaluated at.
 * @returns {{limit: string, matchedPairs: number, medianSettledSize: string, factor: 0|1, openHalfTallies: number, staleHalfTallies: number}} The derived standing.
 */
export function deriveMemberCreditLine({ tallies, memberAccount, settlementWindowDays, creditWindowDays, now }) {
  requireText(memberAccount, "memberAccount");
  requireDate(now, "now");
  const nowMs = Date.parse(now);
  const windowStartMs = nowMs - creditWindowDays * 86_400_000;

  const mine = tallies.filter((t) => t.memberAccount === memberAccount);
  const matched = mine.filter((t) => t.status === "matched" && Date.parse(t.releasedAt) >= windowStartMs);
  const open = mine.filter((t) => t.status === "open");
  const stale = open.filter((t) => nowMs - Date.parse(t.releasedAt) > settlementWindowDays * 86_400_000);

  const matchedAmounts = matched.map((t) => requireDecimal(t.amount, "tally.amount"));
  const med = median(matchedAmounts);
  const factor = stale.length > 0 ? 0 : 1;
  const limitDecimal = factor === 0 ? ZERO : parse((matched.length * Number(format(med))).toFixed(Math.max(med.places, 2)));

  return {
    limit: format(limitDecimal),
    matchedPairs: matched.length,
    medianSettledSize: format(med),
    factor,
    openHalfTallies: open.length,
    staleHalfTallies: stale.length,
  };
}

// ── the draw: the timing float ──────────────────────────────────────────────────────────

/**
 * Evaluates a pool draw request against a member's derived credit line and the pool's own
 * barrier series (the timing float: fronts the gap between a bill due and an inflow landing,
 * repaid at the inflow, priced at the fee it avoids — fintech-for-the-tiyospaye note section 1).
 * Refuses, naming a datum, rather than sizing down: when the draw exceeds the line, when the
 * pool's projected balance after the draw would cross its barrier series at any date before the
 * due date, or when the fee avoided is unknown.
 * @param {object} request
 * @param {object} request.pool The pool record.
 * @param {{limit: string}} request.standing The member's derived credit line (`deriveMemberCreditLine`'s result).
 * @param {string} request.memberAccount The drawing member's ledger account id.
 * @param {string} request.amount Exact HBD decimal string requested.
 * @param {string|null} request.feeAvoided Exact HBD decimal string of the fee this draw avoids, or null when unknown.
 * @param {number} [request.priceFraction] Fraction of the avoided fee the pool prices the draw at; defaults to 1 (the whole avoided fee).
 * @param {string} request.inflowDate ISO date the member's inflow is expected.
 * @param {string} request.dueDate ISO date the draw must settle by.
 * @param {string} request.poolBalance The pool's current HBD balance (exact decimal string), before this draw.
 * @param {string} request.requestedAt ISO date/time this evaluation runs at.
 * @returns {{admitted: true, drawId: string, price: string, dueDate: string}|{admitted: false, reason: string}} The admitted draw's terms, or a refusal naming exactly what forbade it.
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function frontPoolDraw({ pool, standing, memberAccount, amount, feeAvoided, priceFraction = 1, inflowDate, dueDate, poolBalance, requestedAt }) {
  requireText(memberAccount, "memberAccount");
  const amountDecimal = requireDecimal(amount, "amount");
  requireDate(inflowDate, "inflowDate");
  requireDate(dueDate, "dueDate");
  requireDate(requestedAt, "requestedAt");
  const balanceDecimal = requireDecimal(poolBalance, "poolBalance");
  if (typeof priceFraction !== "number" || !Number.isFinite(priceFraction) || priceFraction <= 0) {
    throw new TypeError(`pool: priceFraction must be a positive finite number, got ${JSON.stringify(priceFraction)}`);
  }
  if (cmp(amountDecimal, ZERO) <= 0) throw new RangeError("pool: amount must be a positive decimal amount");

  if (feeAvoided === null || feeAvoided === undefined) {
    return { admitted: false, reason: "fee avoided is unknown -- a draw is priced on the fee it avoids, never sized without one" };
  }
  const feeDecimal = requireDecimal(feeAvoided, "feeAvoided");

  const limitDecimal = requireDecimal(standing.limit, "standing.limit");
  if (cmp(amountDecimal, limitDecimal) > 0) {
    return { admitted: false, reason: `draw ${format(amountDecimal)} HBD exceeds member's derived credit line of ${format(limitDecimal)} HBD` };
  }

  const projectedBalance = format(add(balanceDecimal, { units: -amountDecimal.units, places: amountDecimal.places }));
  const projectedDecimal = requireDecimal(projectedBalance, "projectedBalance");
  const day = dueDate.slice(0, 10);
  const crossingDate = pool.barrierSeries
    .filter((row) => row.date <= day)
    .find((row) => cmp(projectedDecimal, requireDecimal(row.amount, "barrierSeries.amount")) < 0);
  if (crossingDate) {
    return { admitted: false, reason: `pool balance after this draw (${projectedBalance} HBD) would cross the barrier of ${crossingDate.amount} HBD in effect on ${crossingDate.date}, at or before the due date` };
  }

  const priceDecimal = parse((Number(format(feeDecimal)) * priceFraction).toFixed(Math.max(feeDecimal.places, 2)));
  const drawId = `draw:${pool.id}:${memberAccount}:${requestedAt}`;
  return { admitted: true, drawId, price: format(priceDecimal), dueDate };
}

// ── settlement ────────────────────────────────────────────────────────────────────────

/**
 * Settles a fronted draw: the admission receipt matching its release, and the matched tally
 * both sides read the next credit-line derivation from.
 * @param {object} request
 * @param {string} request.drawId The draw being settled.
 * @param {string} request.memberAccount The settling member.
 * @param {string} request.amount The exact HBD decimal string originally drawn.
 * @param {string} request.releasedAt ISO date/time the draw was fronted.
 * @param {string} request.admittedAt ISO date/time the repayment lands.
 * @returns {Tally} The matched tally to append to the pool's tally record.
 */
export function settlePoolDraw({ drawId, memberAccount, amount, releasedAt, admittedAt }) {
  requireText(drawId, "drawId");
  requireText(memberAccount, "memberAccount");
  requireDecimal(amount, "amount");
  requireDate(releasedAt, "releasedAt");
  requireDate(admittedAt, "admittedAt");
  return Object.freeze({ drawId, memberAccount, amount, releasedAt, admittedAt, status: "matched" });
}

/**
 * The FOUR verdict for a draw past its due date with no settlement: a mismatch held open, never
 * an eviction (three-ways note section 3, instrument clause 4). Recomputes the member's line
 * with the stale half-tally counted in, so the record itself is what the next limit reads from.
 * @param {object} request
 * @param {object} request.draw `{drawId, memberAccount, amount, releasedAt}` for the overdue draw.
 * @param {object} request.pool The pool record (for its settlementWindowDays/creditWindowDays).
 * @param {Tally[]} request.tallies The pool's tally record, including this draw's open half-tally.
 * @param {string} request.now ISO date/time "now" is evaluated at.
 * @returns {{verdict: "mismatch-held", drawId: string, memberAccount: string, evictable: false, recomputedLine: object}} The FOUR-charged verdict: a mismatch held, evictable always false.
 */
export function verdictForOverdueDraw({ draw, pool, tallies, now }) {
  const recomputedLine = deriveMemberCreditLine({
    tallies,
    memberAccount: draw.memberAccount,
    settlementWindowDays: pool.settlementWindowDays,
    creditWindowDays: pool.creditWindowDays,
    now,
  });
  return Object.freeze({
    verdict: "mismatch-held",
    drawId: draw.drawId,
    memberAccount: draw.memberAccount,
    evictable: false,
    recomputedLine,
  });
}

// ── reconciliation: the two-witness reading ──────────────────────────────────────────────

function postingKey(posting) {
  return `${posting.date}|${posting.ref}|${posting.account}|${posting.amount}|${posting.commodity}`;
}

/**
 * The two-witness reading over a pool's own ledger postings for one member's draws and that
 * member's declared postings for the same draws (economics-science note section 4, constraint
 * 3; "unknown never zero" -- an entry present on only one side is reported as such, never
 * folded into "agreed" or silently dropped). The caller scopes both posting lists to the
 * member being reconciled (e.g. by that member's known draw refs); this function only matches
 * and buckets them, since a repayment's pool-side posting need not share the member's own
 * chart-of-accounts path (it originates from the member's outside inflow, per
 * `postPoolRepayment`).
 * @param {object} request
 * @param {{date: string, ref: string, account: string, amount: string, commodity: string}[]} request.poolPostings Postings from the pool's own energy-bank ledger for this member's draws.
 * @param {{date: string, ref: string, account: string, amount: string, commodity: string}[]} request.memberPostings Postings declared in the member's own ledger for the same draws.
 * @returns {{agreed: object[], mismatch: {poolPosting: object, memberPosting: object}[], postedOnly: object[], assertedOnly: object[]}} The reconciliation verdict.
 */
export function reconcilePoolBooks({ poolPostings, memberPostings }) {
  const byRef = new Map();
  for (const p of poolPostings) byRef.set(p.ref, { poolPosting: p, memberPosting: null });
  for (const m of memberPostings) {
    const existing = byRef.get(m.ref);
    if (existing) existing.memberPosting = m;
    else byRef.set(m.ref, { poolPosting: null, memberPosting: m });
  }

  const agreed = [];
  const mismatch = [];
  const postedOnly = [];
  const assertedOnly = [];
  for (const { poolPosting, memberPosting } of byRef.values()) {
    if (poolPosting && memberPosting) {
      if (postingKey(poolPosting) === postingKey(memberPosting)) agreed.push(poolPosting);
      else mismatch.push({ poolPosting, memberPosting });
    } else if (poolPosting) {
      postedOnly.push(poolPosting);
    } else {
      assertedOnly.push(memberPosting);
    }
  }
  return { agreed, mismatch, postedOnly, assertedOnly };
}

// ── ledger wiring ─────────────────────────────────────────────────────────────────────

/**
 * Rebuilds an in-memory energy-bank `Ledger` from a pool's persisted entry list, appends one
 * balanced HBD transfer between two pool-namespace accounts, and returns the new entry list.
 * The one place this package touches `@red-cup-engineering/energy-bank/ledger` directly.
 * @param {object[]} entries The pool's persisted ledger entries.
 * @param {string} from Source account id.
 * @param {string} to Destination account id.
 * @param {string} amount Exact HBD decimal string.
 * @param {string} ref A fresh, unused ref for this entry.
 * @param {string} date ISO date the entry posts on.
 * @param {string} [narration] Free-text narration; defaults to a plain description of the transfer.
 * @returns {object[]} The ledger's entries after the append.
 * @throws {RangeError} When the ref is reused, the amount is non-positive, or the source would go negative.
 */
export function postPoolTransfer(entries, from, to, amount, ref, date, narration) {
  const ledger = createLedger(entries);
  transferEnergy(ledger, from, to, amount, HBD, ref, date, narration ? { narration } : {});
  return ledger.all();
}

/**
 * Posts a draw's repayment: an inflow from the member's own outside income (the paycheck or
 * benefit the draw fronted the gap to), landing directly on the pool's account -- never a
 * peer transfer from the member's in-ledger balance, which only ever holds what the pool itself
 * sent them (fintech-for-the-tiyospaye note section 1, "repaid at the inflow").
 * @param {object[]} entries The pool's persisted ledger entries.
 * @param {string} memberAccount The repaying member's account id (named in the source posting only).
 * @param {string} poolAccount The pool's own account id.
 * @param {string} amount Exact HBD decimal string.
 * @param {string} ref A fresh, unused ref for this entry.
 * @param {string} date ISO date the entry posts on.
 * @param {string} narration Free-text narration.
 * @returns {object[]} The ledger's entries after the append.
 */
export function postPoolRepayment(entries, memberAccount, poolAccount, amount, ref, date, narration) {
  const ledger = createLedger(entries);
  fundAccount(ledger, `income:repayment:${memberAccount}`, poolAccount, amount, HBD, ref, date, narration);
  return ledger.all();
}

/**
 * Posts a member's contribution into the pool from their own sleeve, via energy-bank's
 * `contributeToPool` — an ordinary balanced transfer into the pool's own account, in whatever
 * commodity the caller names (energy-bank's `liabilities:<commodity>:*` account-path fix,
 * `@red-cup-engineering/energy-bank@0.3.1`, is what lets this post under the right chart path
 * for a non-ENERGY commodity like HBD, rather than leaking into `liabilities:energy:*`).
 * @param {object[]} entries The pool's persisted ledger entries.
 * @param {string} sourceSleeve The contributing member's own ledger account id (their sleeve).
 * @param {string} poolAccount The pool's own account id.
 * @param {string} amount Exact decimal string, denominated in `commodity`.
 * @param {string} commodity The commodity this contribution is denominated in (e.g. `"HBD"`).
 * @param {string} ref A fresh, unused ref for this entry.
 * @param {string} date ISO date the entry posts on.
 * @returns {object[]} The ledger's entries after the append.
 * @throws {RangeError} When the ref is reused, the amount is non-positive, `sourceSleeve` equals `poolAccount`, or the source would go negative.
 */
export function postPoolContribution(entries, sourceSleeve, poolAccount, amount, commodity, ref, date) {
  const ledger = createLedger(entries);
  postContributionToPool(ledger, { account: poolAccount, members: [] }, sourceSleeve, amount, commodity, ref, date);
  return ledger.all();
}

/**
 * The HBD balance an account currently holds, per the ledger's own recomputed audit — never a
 * cached total.
 * @param {object[]} entries The pool's persisted ledger entries.
 * @param {string} account Account id to read a balance for.
 * @returns {string} The exact HBD decimal string balance, `"0"` when the account holds none.
 */
export function ledgerBalance(entries, account) {
  const { balances } = createLedger(entries).audit();
  return balances[ledgerAccountPath(account)]?.[HBD] ?? "0";
}

/**
 * Flattens a pool's ledger entries into a flat posting list, the shape `reconcilePoolBooks`
 * compares against a member's own declared postings.
 * @param {object[]} entries The pool's persisted ledger entries.
 * @returns {{date: string, ref: string, account: string, amount: string, commodity: string}[]} One row per posting, across every entry.
 */
export function flattenPostings(entries) {
  return entries.flatMap((entry) => entry.postings.map((posting) => ({ date: entry.date, ref: entry.ref, ...posting })));
}
