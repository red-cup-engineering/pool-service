/** `receipts` — the one place this package writes the store. */
import { put, append, readLog } from "@red-cup-engineering/semiotic-eavt-services-section/store";

/**
 * Records one pool receipt into the journal rooted at `journalRoot`.
 * @param {string} journalRoot Custody root of the store.
 * @param {string} category One of `"release"`, `"admission"`, `"reconciliation"`, `"mismatch"`, `"enterprise-roster"`, `"vote"`, `"cycle-tally"`, `"cycle-split"`, `"cycle-transactions"`, `"base-reconciliation"`, `"disclosure"`.
 * @param {object} record The receipt body to record.
 * @param {string} recordedAt ISO date/time the receipt is recorded at.
 * @returns {{id: string}} The address of the recorded receipt.
 */
export function recordPoolReceipt(journalRoot, category, record, recordedAt) {
  if (typeof recordedAt !== "string" || !recordedAt.endsWith("Z") || !Number.isFinite(Date.parse(recordedAt)))
    throw new TypeError("pool receipt requires its original ISO UTC occurrence clock");
  const id = put(journalRoot, "pool-receipt", { ...record, category, at: recordedAt });
  // Native logs carry occurrence references, not another receipt body/store.
  // Stream only this receipt's day; unchanged serial retries publish no second
  // equivalent occurrence. A put followed by a failed append remains recoverable.
  for (const { line } of readLog(journalRoot, "pool-receipt", recordedAt.slice(0, 10))) {
    if (line.e === id && line.a === "pool-receipt" && line.v === category) {
      if (line.at !== recordedAt) throw new Error("pool receipt occurrence clock differs from its record");
      return { id };
    }
  }
  append(journalRoot, "pool-receipt", { at: recordedAt, e: id, a: "pool-receipt", v: category });
  return { id };
}
