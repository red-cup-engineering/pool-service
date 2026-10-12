#!/usr/bin/env node
/**
 * Derives one member's tally-credit standing from the pool's persisted tally record.
 * Zero-effect: reads `--state <path>`, prints the standing.
 */
import { parseArgs } from "node:util";
import { deriveMemberCreditLine } from "../src/pool.mjs";
import { readStore } from "../src/store.mjs";

/**
 * Reads the pool document at `statePath` and derives `account`'s credit line at `now`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} account The member's ledger account id.
 * @param {string} now ISO date/time "now" is evaluated at.
 * @returns {object} The derived standing (`deriveMemberCreditLine`'s result).
 */
export function deriveMemberCreditLineFromStore(statePath, account, now) {
  const { pool, tallies } = readStore(statePath, null) ?? { pool: null, tallies: [] };
  if (!pool) throw new Error(`derive-member-credit-line: no pool document at ${statePath}`);
  return deriveMemberCreditLine({
    tallies,
    memberAccount: account,
    settlementWindowDays: pool.settlementWindowDays,
    creditWindowDays: pool.creditWindowDays,
    now,
  });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, account: { type: "string" }, now: { type: "string" } } });
  if (!values.state || !values.account || !values.now) {
    process.stderr.write("error: --state, --account, and --now are required\n");
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify(deriveMemberCreditLineFromStore(values.state, values.account, values.now))}\n`);
  }
}
