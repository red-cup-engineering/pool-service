#!/usr/bin/env node
/**
 * Records one member's cycle vote, weighted by their matched-tally count
 * (membership-and-governance specification, "The distribution rule"). Reads a request
 * `{cycleId, memberAccount, allocations, matchedTallyAsOf, recordedAt}` as one JSON object via
 * `--request` or stdin. One effect: persists `--state <path>` and records a vote receipt into
 * `--journal-root <dir>` (default: alongside the state file). Refusals (a zero-weight voter, a
 * duplicate vote) are data, never thrown.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { castDistributionVote } from "../src/votes.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Casts `request` against the pool document's vote record at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the vote receipt is recorded under.
 * @param {object} request `{cycleId, memberAccount, allocations, matchedTallyAsOf, recordedAt}`.
 * @returns {{recorded: true, weight: number, receipt: string}|{recorded: false, reason: string}} The result.
 * @throws {Error} When no pool document exists at `statePath`.
 */
export function recordDistributionVoteFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`record-distribution-vote: no pool document at ${statePath}`);
  const { pool, tallies } = document;
  if ((document.cycleTallies ?? []).some((tally) => tally.cycleId === request.cycleId)) {
    return { recorded: false, reason: `cycle "${request.cycleId}" is already closed and cannot accept another distribution vote` };
  }
  const votes = document.votes ?? [];
  const result = castDistributionVote({
    votes,
    tallies,
    settlementWindowDays: pool.settlementWindowDays,
    creditWindowDays: pool.creditWindowDays,
    cycleId: request.cycleId,
    memberAccount: request.memberAccount,
    allocations: request.allocations,
    matchedTallyAsOf: request.matchedTallyAsOf,
    recordedAt: request.recordedAt,
  });
  if (!result.recorded) return result;

  writeStore(statePath, { ...document, votes: result.votes });
  const receipt = recordPoolReceipt(journalRoot, "vote", { cycleId: request.cycleId, memberAccount: request.memberAccount, allocations: request.allocations, weight: result.weight }, request.recordedAt);
  return { recorded: true, weight: result.weight, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = recordDistributionVoteFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.recorded) process.exitCode = 1;
  }
}
