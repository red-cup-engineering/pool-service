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
import { readFlatfileText } from "@red-cup-engineering/flatfile-engineering-services-section";
import { add, format, parse } from "@red-cup-engineering/energy-bank/decimal";
import { HBD, ledgerAccountPath, reconcilePoolBooks, migrateLegacyPoolMembership } from "../src/pool.mjs";
import { resolveLedgerWitness } from "../src/ledger-witness.mjs";
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
 * Resolve the member's stored witness and reconcile its posting arrays against pool facts.
 *
 * memberLedgerPath is retained as a legacy 0.5.0 override. New callers pass null and rely on
 * the member's persisted ledgerWitness descriptor. fetchContentAddressed is injected by the
 * hosting receiver; this package never silently fetches a member-controlled provider itself.
 *
 * @returns A reconciled verdict, or {reconciled:false,witnessState,reason}. Witness failure
 * never becomes an empty-postings success.
 */
export function reconcilePoolBooksFromStore(
  statePath,
  memberLedgerPath,
  journalRoot,
  account,
  recordedAt,
  { fetchContentAddressed = null, readLocalFile = readFlatfileText } = {},
) {
  const document = readStore(statePath, null);
  if (!document?.draws || !document?.pool) throw new Error(`reconcile-pool-books: no pool document at ${statePath}`);
  const pool = migrateLegacyPoolMembership(document.pool);
  const member = pool.members.find((candidate) => candidate.account === account);
  if (!member) {
    return Object.freeze({
      reconciled: false,
      witnessState: "refused",
      reason: `reconcile-pool-books: account "${account}" is not an admitted member`,
    });
  }

  const witness = memberLedgerPath
    ? { kind: "local-file", path: memberLedgerPath }
    : member.ledgerWitness;
  const resolution = resolveLedgerWitness(witness, { readLocalFile, fetchContentAddressed });
  if (!resolution.resolved) {
    return Object.freeze({
      reconciled: false,
      witnessState: resolution.state,
      reason: resolution.reason,
    });
  }

  const verdict = reconcilePoolBooks({
    poolPostings: poolFactsForMember(document.draws, document.tallies ?? [], account),
    memberPostings: resolution.postings,
  });
  const receipt = recordPoolReceipt(journalRoot, "reconciliation", { account, ...verdict }, recordedAt);
  return Object.freeze({ reconciled: true, ...verdict, receipt: receipt.id });
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
  if (!values.state || !values.account || !values["recorded-at"]) {
    process.stderr.write("error: --state, --account, and --recorded-at are required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const result = reconcilePoolBooksFromStore(values.state, values["member-ledger"] ?? null, journalRoot, values.account, values["recorded-at"]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.reconciled) process.exitCode = 1;
  }
}
