#!/usr/bin/env node
/**
 * Tallies one cycle's recorded distribution votes, weighted by each voter's fixed matched-
 * tally weight, applying the quorum rule (membership-and-governance specification, "The
 * distribution rule"). Reads a request `{cycleId, closedAt}` as one JSON object via `--request`
 * or stdin. The first close is append-only: a later close of the same cycle is refused, later
 * votes are refused by record-distribution-vote, votes timestamped after closedAt are excluded,
 * and the persisted tally commits to the exact included vote set. closedAt is still a described
 * instant, not proof of the separately-unresolved admitted monthly calendar boundary. One effect:
 * persists the tally onto `--state <path>` and records a cycle-tally receipt into
 * `--journal-root <dir>` (default: alongside the state file).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { tallyCycleVotes } from "../src/votes.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";
import { recordNiForBytes } from "../src/ledger-witness.mjs";

/**
 * Tallies `request.cycleId`'s recorded votes against the pool document at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the cycle-tally receipt is recorded under.
 * @param {object} request `{cycleId, closedAt}`.
 * @returns {{cycleId: string, quorumMet: boolean, voterCount: number, totalWeight: number, shares: Record<string, number>, closedAt: string, voteEvidence: {recordNi: string, voteCount: number, excludedLateVoteCount: number}, receipt: string}} The cycle's immutable first-close tally, persisted and receipted.
 * @throws {Error} When no pool document exists at `statePath`.
 */
export function tallyCycleVotesFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`tally-cycle-votes: no pool document at ${statePath}`);
  if (typeof request.cycleId !== "string" || request.cycleId.length === 0) {
    throw new TypeError("tally-cycle-votes: cycleId must be a non-empty string");
  }
  if (typeof request.closedAt !== "string" || Number.isNaN(Date.parse(request.closedAt))) {
    throw new TypeError("tally-cycle-votes: closedAt must be an ISO date/time string");
  }
  const cycleTallies = document.cycleTallies ?? [];
  if (cycleTallies.some((tally) => tally.cycleId === request.cycleId)) {
    throw new Error(`tally-cycle-votes: cycle "${request.cycleId}" is already closed`);
  }

  const closedAtMs = Date.parse(request.closedAt);
  const cycleVotes = (document.votes ?? []).filter((vote) => vote.cycleId === request.cycleId);
  for (const [index, vote] of cycleVotes.entries()) {
    if (typeof vote.recordedAt !== "string" || Number.isNaN(Date.parse(vote.recordedAt))) {
      throw new TypeError(`tally-cycle-votes: stored vote ${index} for cycle "${request.cycleId}" has invalid recordedAt`);
    }
  }
  const includedVotes = cycleVotes
    .filter((vote) => Date.parse(vote.recordedAt) <= closedAtMs)
    .sort((left, right) => left.memberAccount.localeCompare(right.memberAccount));
  const seenMembers = new Set();
  for (const vote of includedVotes) {
    if (seenMembers.has(vote.memberAccount)) {
      throw new Error(`tally-cycle-votes: cycle "${request.cycleId}" contains duplicate votes for member "${vote.memberAccount}"`);
    }
    seenMembers.add(vote.memberAccount);
  }
  const excludedLateVoteCount = cycleVotes.length - includedVotes.length;
  const tally = tallyCycleVotes(includedVotes, request.cycleId);
  const voteEvidence = Object.freeze({
    recordNi: recordNiForBytes(JSON.stringify(includedVotes)),
    voteCount: includedVotes.length,
    excludedLateVoteCount,
  });
  const authoritativeTally = Object.freeze({
    ...tally,
    closedAt: request.closedAt,
    voteEvidence,
  });

  writeStore(statePath, { ...document, cycleTallies: [...cycleTallies, authoritativeTally] });
  const receipt = recordPoolReceipt(journalRoot, "cycle-tally", authoritativeTally, request.closedAt);
  return { ...authoritativeTally, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = tallyCycleVotesFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
