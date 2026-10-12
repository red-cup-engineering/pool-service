import { add, format, parse } from "@red-cup-engineering/energy-bank/decimal";
import { recordNiForBytes } from "./ledger-witness.mjs";

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`directed-yield-receipts: ${label} must be a non-empty string`);
  }
  return value;
}

function requireIsoDateTime(value, label) {
  requireText(value, label);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`directed-yield-receipts: ${label} must be an ISO date/time string`);
  }
  return value;
}

function receiptIdentity(receipt) {
  return receipt.txHash ?? [receipt.memberAccount, receipt.amount, receipt.commodity, receipt.observedAt].join("|");
}

/**
 * Admit one exact directed-yield receipt set as the authoritative evidence for a cycle total.
 *
 * The returned receipt array is canonical and order-independent. Duplicate receipt identities
 * are refused so the same observed transfer cannot be counted twice. The evidence NI commits
 * to the normalized full set, not merely its sum.
 */
export function normalizeDirectedYieldReceipts(receipts) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    throw new TypeError("directed-yield-receipts: receipts must be a non-empty array");
  }

  const normalized = receipts.map((receipt, index) => {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      throw new TypeError(`directed-yield-receipts: receipts[${index}] must be an object`);
    }
    const memberAccount = requireText(receipt.memberAccount, `receipts[${index}].memberAccount`);
    const commodity = requireText(receipt.commodity, `receipts[${index}].commodity`);
    const observedAt = requireIsoDateTime(receipt.observedAt, `receipts[${index}].observedAt`);
    const parsedAmount = parse(receipt.amount);
    if (parsedAmount.units <= 0n) {
      throw new RangeError(`directed-yield-receipts: receipts[${index}].amount must be positive`);
    }
    const amount = format(parsedAmount);
    const txHash = receipt.txHash === undefined ? undefined : requireText(receipt.txHash, `receipts[${index}].txHash`);
    return Object.freeze({ memberAccount, amount, commodity, observedAt, ...(txHash === undefined ? {} : { txHash }) });
  });

  const commodity = normalized[0].commodity;
  for (const [index, receipt] of normalized.entries()) {
    if (receipt.commodity !== commodity) {
      throw new TypeError(`directed-yield-receipts: receipts[${index}].commodity ${JSON.stringify(receipt.commodity)} does not match ${JSON.stringify(commodity)}`);
    }
  }

  const byIdentity = new Map();
  for (const receipt of normalized) {
    const identity = receiptIdentity(receipt);
    if (byIdentity.has(identity)) {
      throw new TypeError(`directed-yield-receipts: duplicate receipt identity ${JSON.stringify(identity)}`);
    }
    byIdentity.set(identity, receipt);
  }

  const canonical = [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, receipt]) => receipt);

  let total = parse("0");
  for (const receipt of canonical) total = add(total, parse(receipt.amount));
  const totalYield = format(total);
  const observedThrough = canonical.reduce((latest, receipt) =>
    latest === null || Date.parse(receipt.observedAt) > Date.parse(latest) ? receipt.observedAt : latest, null);
  const evidenceBytes = JSON.stringify(canonical);
  const evidenceNi = recordNiForBytes(evidenceBytes);

  return Object.freeze({
    receipts: Object.freeze(canonical),
    commodity,
    totalYield,
    observedThrough,
    evidenceNi,
    receiptCount: canonical.length,
  });
}
