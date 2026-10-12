#!/usr/bin/env node
/**
 * Opens a contest window on a `reconcilePoolBooks` bucket entry (membership-and-governance
 * specification, "Disputes and defaults"). Reads a request `{ref, contestedBy, reason,
 * contestedAt}` as one JSON object via `--request` or stdin. One effect: persists `--state
 * <path>` and records a contest receipt into `--journal-root <dir>` (default: alongside the
 * state file). Refusals (a duplicate open contest) are data, never thrown. Resolution -- an
 * amended posting or a standing mismatch -- is the dialogue sequence the specification names,
 * a later, human step this operation does not perform.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { openContest } from "../src/contests.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Opens `request`'s contest against the pool document at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the contest receipt is recorded under.
 * @param {object} request `{ref, contestedBy, reason, contestedAt}`.
 * @returns {{contested: true, contest: object, receipt: string}|{contested: false, reason: string}} The result.
 * @throws {Error} When no pool document exists at `statePath`.
 */
export function contestPoolReceiptFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`contest-pool-receipt: no pool document at ${statePath}`);
  const contests = document.contests ?? [];
  const result = openContest(contests, request);
  if (!result.contested) return result;

  writeStore(statePath, { ...document, contests: result.contests });
  const receipt = recordPoolReceipt(journalRoot, "mismatch", { ref: request.ref, contestedBy: request.contestedBy, reason: request.reason }, request.contestedAt);
  return { contested: true, contest: result.contest, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = contestPoolReceiptFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.contested) process.exitCode = 1;
  }
}
