#!/usr/bin/env node
/**
 * The two-witness reading: the pool's own declared facts about one member's draws (their
 * release and, once matched, their repayment) against that member's declared postings
 * (`{postings: [{date, ref, account, amount, commodity}]}` at `--member-ledger <path>` --
 * Farolfi/organizing-derived postings land in this same shape once a caller supplies them).
 * One effect: records the reconciliation receipt into `--journal-root <dir>` (default:
 * alongside the state file).
 */
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readFlatfileText } from "@red-cup-engineering/flatfile";
import { add, format, parse } from "@red-cup-engineering/energy-bank/decimal";
import { HBD, ledgerAccountPath, reconcilePoolBooks } from "../src/pool.mjs";
import { readStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * The pool's own declared rows for `account`'s draws: one release row per draw, and one
 * repayment row for each draw whose tally has matched.
 * @param {object[]} draws The pool's persisted draw records.
 * @param {object[]} tallies The pool's persisted tally records.
 * @param {string} account The member account to build rows for.
 * @returns {{date: string, ref: string, account: string, amount: string, commodity: string}[]} The pool's declared rows.
 */
function poolFactsForMember(draws, tallies, account) {
  const path = ledgerAccountPath(account);
  const rows = [];
  for (const draw of draws.filter((d) => d.memberAccount === account)) {
    rows.push({ date: draw.requestedAt.slice(0, 10), ref: draw.drawId, account: path, amount: draw.amount, commodity: HBD });
    const tally = tallies.find((t) => t.drawId === draw.drawId && t.status === "matched");
    if (tally) {
      const repayment = format(add(parse(draw.amount), parse(draw.price)));
      rows.push({ date: tally.admittedAt.slice(0, 10), ref: `${draw.drawId}:settle`, account: path, amount: `-${repayment}`, commodity: HBD });
    }
  }
  return rows;
}

/**
 * Reconciles `account`'s draws in the pool document at `statePath` against the member
 * ledger file at `memberLedgerPath`, recording the verdict into `journalRoot`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} memberLedgerPath Path to the member's declared postings JSON file.
 * @param {string} journalRoot Custody root the reconciliation receipt is recorded under.
 * @param {string} account The member account to reconcile.
 * @param {string} recordedAt ISO date/time the reconciliation runs at.
 * @returns {{agreed: object[], mismatch: object[], postedOnly: object[], assertedOnly: object[], receipt: string}} The verdict, with its receipt id.
 */
export function reconcilePoolBooksFromStore(statePath, memberLedgerPath, journalRoot, account, recordedAt) {
  const { draws, tallies } = readStore(statePath, null) ?? { draws: null };
  if (!draws) throw new Error(`reconcile-pool-books: no pool document at ${statePath}`);
  const memberPostings = JSON.parse(readFlatfileText(memberLedgerPath)).postings;
  const verdict = reconcilePoolBooks({ poolPostings: poolFactsForMember(draws, tallies, account), memberPostings });
  const receipt = recordPoolReceipt(journalRoot, "reconciliation", { account, ...verdict }, recordedAt);
  return { ...verdict, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      state: { type: "string" },
      "member-ledger": { type: "string" },
      "journal-root": { type: "string" },
      account: { type: "string" },
      "recorded-at": { type: "string" },
    },
  });
  if (!values.state || !values["member-ledger"] || !values.account || !values["recorded-at"]) {
    process.stderr.write("error: --state, --member-ledger, --account, and --recorded-at are required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const result = reconcilePoolBooksFromStore(values.state, values["member-ledger"], journalRoot, values.account, values["recorded-at"]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
