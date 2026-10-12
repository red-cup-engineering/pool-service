#!/usr/bin/env node
/**
 * Posts a member's contribution into the pool from their own sleeve: a balanced double-entry
 * transfer from the member's own ledger account into the pool's own account, via energy-bank's
 * `contributeToPool` (the missing operation the 2026-09-05 collapse-aware-financial-enterprises
 * note names: "members funding the pool from their own sleeve"). Reads a request `{account,
 * amount, commodity, sourceSleeve, contributedAt}` as one JSON object via `--request` or stdin.
 * One effect: persists `--state <path>` on admission and records an admission receipt into
 * `--journal-root <dir>` (default: alongside the state file). Refusals are data, never thrown.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { postPoolContribution } from "../src/pool.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Posts `request`'s contribution against the pool document at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the admission receipt is recorded under.
 * @param {object} request `{account, amount, commodity, sourceSleeve, contributedAt}`.
 * @returns {{admitted: true, posting: object, receipt: string}|{admitted: false, reason: string}} The posted posting plus its receipt id, or a refusal naming why the contribution could not post.
 */
export function contributeToPoolFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`contribute-to-pool: no pool document at ${statePath}`);
  const { pool } = document;
  const member = pool.members.find((m) => m.account === request.account);
  if (!member) return { admitted: false, reason: `"${request.account}" is not an admitted member of pool "${pool.id}"` };

  const date = request.contributedAt.slice(0, 10);
  const ref = `contribution:${pool.id}:${request.account}:${request.contributedAt}`;
  let entries;
  try {
    entries = postPoolContribution(pool.ledger?.entries ?? [], request.sourceSleeve, pool.account, request.amount, request.commodity, ref, date);
  } catch (error) {
    return { admitted: false, reason: error.message };
  }

  const posting = { date, ref, account: request.sourceSleeve, amount: request.amount, commodity: request.commodity };
  const receipt = recordPoolReceipt(
    journalRoot,
    "admission",
    { account: request.account, sourceSleeve: request.sourceSleeve, amount: request.amount, commodity: request.commodity, ref },
    request.contributedAt,
  );

  writeStore(statePath, { ...document, pool: { ...pool, ledger: { entries } } });
  return { admitted: true, posting, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = contributeToPoolFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.admitted) process.exitCode = 1;
  }
}
