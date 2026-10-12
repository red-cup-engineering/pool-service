/** `receipts` — the one place this package writes the store. */
import { put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

/**
 * Records one pool receipt into the journal rooted at `journalRoot`.
 * @param {string} journalRoot Custody root of the store.
 * @param {string} category One of `"release"`, `"admission"`, `"reconciliation"`, `"mismatch"`, `"enterprise-roster"`, `"vote"`, `"cycle-tally"`, `"cycle-split"`, `"cycle-transactions"`, `"base-reconciliation"`, `"disclosure"`.
 * @param {object} record The receipt body to record.
 * @param {string} recordedAt ISO date/time the receipt is recorded at.
 * @returns {{id: string}} The address of the recorded receipt.
 */
export function recordPoolReceipt(journalRoot, category, record, recordedAt) {
  return { id: put(journalRoot, "pool-receipt", { category, ...record, at: recordedAt }) };
}
