/**
 * `cycle-transactions` — one closed cycle's Beancount postings: the directed-yield receipt,
 * the float's designation, the per-enterprise distributions, and settled draws' fee income,
 * per the economics specification's "Accounting" section (`Income:Pool:Directed-Yield`, the
 * three `Assets:...:Pool:*` buckets, `Liabilities:Pool:Member-Float`,
 * `Equity:Pool:Designated-Reserves`, `Expenses:Pool:Enterprise-Distributions:<Enterprise>`,
 * `Income:Pool:Draw-Fee`). Exact decimal strings only.
 */
import { add, format, parse } from "@red-cup-engineering/energy-bank/decimal";
import { normalizeDirectedYieldReceipts } from "./directed-yield-receipts.mjs";
import { toAccountComponent } from "./pool.mjs";

const RESERVE_ACCOUNT = "Assets:Digital-Assets:EVM:Base:Pool:Barrier-Reserve";
const FLOAT_ACCOUNT = "Assets:Digital-Assets:EVM:Base:Pool:Float";
const DISTRIBUTABLE_ACCOUNT = "Assets:Digital-Assets:EVM:Base:Pool:Distributable-Pending";
const INCOME_DIRECTED_YIELD_ACCOUNT = "Income:Pool:Directed-Yield";
const DESIGNATED_RESERVES_ACCOUNT = "Equity:Pool:Designated-Reserves";
const MEMBER_FLOAT_ACCOUNT = "Liabilities:Pool:Member-Float";
const DRAW_FEE_ASSET_ACCOUNT = "Assets:Digital-Assets:Hive:Custody:Pool";
const INCOME_DRAW_FEE_ACCOUNT = "Income:Pool:Draw-Fee";

function negateDecimalString(text) {
  const decimal = parse(text);
  if (decimal.units === 0n) return format(decimal);
  return format({ units: -decimal.units, places: decimal.places });
}

function renderDirective({ date, narration, metadata, postings }) {
  const lines = [`${date} * "${narration}"`];
  for (const [key, value] of Object.entries(metadata)) lines.push(`  ${key}: "${value}"`);
  for (const { account, amount, currency } of postings) lines.push(`  ${account}  ${amount} ${currency}`);
  return lines.join("\n");
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`cycle-transactions: ${label} must be a non-empty string`);
  return value;
}

function requireIsoDateTime(value, label) {
  requireNonEmptyString(value, label);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`cycle-transactions: ${label} must be an ISO date/time string`);
  return value;
}

/**
 * @typedef {object} DirectedYieldReceipt
 * @property {string} memberAccount The pool-ledger account whose own signed transaction sent this receipt.
 * @property {string} amount Exact decimal string, in `split.commodity`.
 * @property {string} commodity Must equal `split.commodity`.
 * @property {string} observedAt ISO date/time the receipt was observed landing at the pool's address.
 * @property {string} [txHash] The Base transaction hash, when known.
 */

/**
 * @typedef {object} SettledDrawFee
 * @property {string} drawId The draw this fee was priced on (`frontPoolDraw`'s `drawId`).
 * @property {string} memberAccount The member who repaid it.
 * @property {string} amount Exact decimal string: the draw's `price` (the fee `frontPoolDraw` already priced).
 * @property {string} commodity The fee's commodity (HBD, per `pool-service`'s existing money path).
 * @property {string} settledAt ISO date/time the draw settled.
 */

/**
 * Derives one closed cycle's Beancount transaction set: the directed-yield receipt split into
 * the three buckets, the float's designation against member credit lines, one distribution
 * transaction per admitted enterprise, and one fee-income transaction per settled draw.
 * Refuses, naming a datum, when `directedYieldReceipts` does not sum to exactly
 * `split.totalYield` in `split.commodity` — the receipts are the evidentiary trail for the
 * split's own total, never assumed consistent.
 * @param {object} request
 * @param {{cycleId: string, commodity: string, totalYield: string, reserve: string, float: string, distributable: string, yieldEvidence: {recordNi: string, receiptCount: number, observedThrough: string}, perEnterprise: {enterpriseId: string, fixed: string, voted: string, total: string}[]}} request.split `derive-cycle-split.mjs`'s persisted result for one cycle.
 * @param {DirectedYieldReceipt[]} request.directedYieldReceipts The member-signed receipts that fed this cycle's total, for provenance and the sum check.
 * @param {SettledDrawFee[]} [request.drawFees] Draws settled inside this cycle whose price is recognized as fee income here; defaults to none.
 * @param {string} request.receivedAt ISO date/time the directed-yield receipt and float designation post at.
 * @param {string} request.distributedAt ISO date/time the per-enterprise distributions post at.
 * @param {string[]} [request.openAccounts] Accounts already open elsewhere (the sidecar's own prior content, or a known-open ledger such as the main ledger), so this set never redundantly re-opens them.
 * @returns {{derived: true, type: "PoolCycleTransactionSet", cycleId: string, commodity: string, transactionCount: number, transactions: object[], accountsToOpen: object[]}|{derived: false, reason: string}} The transaction set, or a refusal naming why.
 * @throws {TypeError} When a required field is missing or malformed.
 */
export function deriveSetOfPoolCycleTransactions({ split, directedYieldReceipts, drawFees = [], receivedAt, distributedAt, openAccounts = [] }) {
  if (!split || typeof split !== "object") throw new TypeError("cycle-transactions: request.split must be an object");
  requireNonEmptyString(split.cycleId, "split.cycleId");
  requireNonEmptyString(split.commodity, "split.commodity");
  for (const field of ["totalYield", "reserve", "float", "distributable"]) parse(split[field]);
  if (!Array.isArray(split.perEnterprise)) throw new TypeError("cycle-transactions: request.split.perEnterprise must be an array");
  if (!Array.isArray(directedYieldReceipts) || directedYieldReceipts.length === 0) {
    throw new TypeError("cycle-transactions: request.directedYieldReceipts must be a non-empty array");
  }
  const evidence = normalizeDirectedYieldReceipts(directedYieldReceipts);
  if (typeof split.yieldEvidence?.recordNi !== "string" || split.yieldEvidence.recordNi.length === 0) {
    return { derived: false, reason: "split has no directed-yield receipt evidence identity; refusing to book an assertion-only split" };
  }
  if (evidence.evidenceNi !== split.yieldEvidence.recordNi) {
    return { derived: false, reason: `directedYieldReceipts evidence ${evidence.evidenceNi} does not match split.yieldEvidence.recordNi ${split.yieldEvidence.recordNi}` };
  }
  if (evidence.receiptCount !== split.yieldEvidence.receiptCount) {
    return { derived: false, reason: `directedYieldReceipts count ${evidence.receiptCount} does not match split.yieldEvidence.receiptCount ${split.yieldEvidence.receiptCount}` };
  }
  const canonicalReceipts = evidence.receipts;
  requireIsoDateTime(receivedAt, "receivedAt");
  requireIsoDateTime(distributedAt, "distributedAt");

  let receiptTotal = parse("0");
  for (const [index, receipt] of canonicalReceipts.entries()) {
    requireNonEmptyString(receipt.memberAccount, `directedYieldReceipts[${index}].memberAccount`);
    requireIsoDateTime(receipt.observedAt, `directedYieldReceipts[${index}].observedAt`);
    if (receipt.commodity !== split.commodity) {
      return { derived: false, reason: `directedYieldReceipts[${index}].commodity "${receipt.commodity}" does not match split.commodity "${split.commodity}"` };
    }
    receiptTotal = add(receiptTotal, parse(receipt.amount));
  }
  if (format(receiptTotal) !== format(parse(split.totalYield))) {
    return { derived: false, reason: `directedYieldReceipts sum to ${format(receiptTotal)} ${split.commodity}, which does not equal split.totalYield ${split.totalYield} ${split.commodity}` };
  }

  const opened = new Set(openAccounts);
  const accountsToOpenByName = new Map();
  const noteAccountUse = (account, date) => {
    if (opened.has(account)) return;
    const existing = accountsToOpenByName.get(account);
    if (!existing || date < existing.date) accountsToOpenByName.set(account, { account, date });
  };

  const transactions = [];
  const receivedDate = receivedAt.slice(0, 10);
  const distributedDate = distributedAt.slice(0, 10);
  const receiptRefs = canonicalReceipts.map((r) => r.txHash ?? `${r.memberAccount}:${r.amount}`).join(",");

  // The directed-yield receipt posts directly into the three buckets (the economics
  // specification's own worked example: no intermediate holding account).
  {
    const postings = [
      { account: RESERVE_ACCOUNT, amount: split.reserve, currency: split.commodity },
      { account: FLOAT_ACCOUNT, amount: split.float, currency: split.commodity },
      { account: DISTRIBUTABLE_ACCOUNT, amount: split.distributable, currency: split.commodity },
      { account: INCOME_DIRECTED_YIELD_ACCOUNT, amount: negateDecimalString(split.totalYield), currency: split.commodity },
    ];
    for (const p of postings) noteAccountUse(p.account, receivedDate);
    const metadata = { cycle_id: split.cycleId, receipts: receiptRefs };
    const narration = `Tidepool cycle ${split.cycleId} directed yield received`;
    transactions.push({
      date: receivedDate, narration, cycleId: split.cycleId, kind: "directed-yield-receipt", postings,
      directive: renderDirective({ date: receivedDate, narration, metadata, postings }),
    });
  }

  // Designate the float against outstanding member credit lines.
  {
    const postings = [
      { account: DESIGNATED_RESERVES_ACCOUNT, amount: split.float, currency: split.commodity },
      { account: MEMBER_FLOAT_ACCOUNT, amount: negateDecimalString(split.float), currency: split.commodity },
    ];
    for (const p of postings) noteAccountUse(p.account, receivedDate);
    const metadata = { cycle_id: split.cycleId };
    const narration = `Tidepool cycle ${split.cycleId} float designated against outstanding member credit lines`;
    transactions.push({
      date: receivedDate, narration, cycleId: split.cycleId, kind: "float-designation", postings,
      directive: renderDirective({ date: receivedDate, narration, metadata, postings }),
    });
  }

  // One distribution transaction per admitted enterprise (the disclosure surface's
  // per-enterprise detail; the specification's own worked example posts the aggregate).
  for (const entry of split.perEnterprise) {
    requireNonEmptyString(entry.enterpriseId, "split.perEnterprise[].enterpriseId");
    const expenseAccount = `Expenses:Pool:Enterprise-Distributions:${toAccountComponent(entry.enterpriseId)}`;
    const postings = [
      { account: DISTRIBUTABLE_ACCOUNT, amount: negateDecimalString(entry.total), currency: split.commodity },
      { account: expenseAccount, amount: entry.total, currency: split.commodity },
    ];
    for (const p of postings) noteAccountUse(p.account, distributedDate);
    const metadata = { cycle_id: split.cycleId, enterprise_id: entry.enterpriseId, fixed: entry.fixed, voted: entry.voted };
    const narration = `Tidepool cycle ${split.cycleId} distribution to ${entry.enterpriseId}`;
    transactions.push({
      date: distributedDate, narration, cycleId: split.cycleId, kind: "enterprise-distribution", enterpriseId: entry.enterpriseId, postings,
      directive: renderDirective({ date: distributedDate, narration, metadata, postings }),
    });
  }

  // Draw fee income already priced by `frontPoolDraw` (the economics specification's "house
  // fee: none, on directed yield" clause: the house's earned revenue is this existing line).
  for (const [index, fee] of drawFees.entries()) {
    requireNonEmptyString(fee.drawId, `drawFees[${index}].drawId`);
    requireNonEmptyString(fee.memberAccount, `drawFees[${index}].memberAccount`);
    requireNonEmptyString(fee.commodity, `drawFees[${index}].commodity`);
    requireIsoDateTime(fee.settledAt, `drawFees[${index}].settledAt`);
    parse(fee.amount);
    const settledDate = fee.settledAt.slice(0, 10);
    const postings = [
      { account: DRAW_FEE_ASSET_ACCOUNT, amount: fee.amount, currency: fee.commodity },
      { account: INCOME_DRAW_FEE_ACCOUNT, amount: negateDecimalString(fee.amount), currency: fee.commodity },
    ];
    for (const p of postings) noteAccountUse(p.account, settledDate);
    const metadata = { cycle_id: split.cycleId, draw_id: fee.drawId, member_account: fee.memberAccount };
    const narration = `Tidepool draw fee earned (${fee.drawId})`;
    transactions.push({
      date: settledDate, narration, cycleId: split.cycleId, kind: "draw-fee-income", drawId: fee.drawId, postings,
      directive: renderDirective({ date: settledDate, narration, metadata, postings }),
    });
  }

  const accountsToOpen = [...accountsToOpenByName.values()]
    .sort((a, b) => a.account.localeCompare(b.account))
    .map(({ account, date }) => ({ account, date, directive: `${date} open ${account}` }));

  return Object.freeze({
    derived: true,
    type: "PoolCycleTransactionSet",
    cycleId: split.cycleId,
    commodity: split.commodity,
    transactionCount: transactions.length,
    transactions: Object.freeze(transactions),
    accountsToOpen: Object.freeze(accountsToOpen),
  });
}
