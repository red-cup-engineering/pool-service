#!/usr/bin/env node
/**
 * Runs a pending member enterprise's admission proposal through the same weighted vote and
 * quorum rule as a distribution vote (membership-and-governance specification, "Member
 * enterprises": "an enterprise's admission is a proposal put to the engaged member set, never
 * a staff decision"). Members cast support for the proposal via `record-distribution-vote`
 * under the reserved cycle id `enterprise-admission:<enterpriseId>` -- a full-weight allocation
 * to the candidate signals support, an all-zero allocation records quorum participation
 * without supporting it. Admission passes when quorum is met (three nonzero-weight voters) and
 * the summed support weight is a strict majority of the total weight cast. Reads a request
 * `{enterpriseId, admittedAt}` as one JSON object via `--request` or stdin. One effect:
 * persists `--state <path>` on admission and records an admission-vote receipt into
 * `--journal-root <dir>` (default: alongside the state file). Refusals are data, never thrown.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { tallyCycleVotes, enterpriseAdmissionCycleId } from "../src/votes.mjs";
import { confirmMemberEnterpriseAdmission } from "../src/enterprises.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Tallies and, if it passes, confirms `request.enterpriseId`'s pending admission.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the admission-vote receipt is recorded under.
 * @param {object} request `{enterpriseId, admittedAt}`.
 * @returns {{admitted: true, tally: object, receipt: string}|{admitted: false, reason: string, tally: object}} The result.
 * @throws {Error} When no pool document exists at `statePath`.
 */
export function admitEnterpriseVoteFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`admit-enterprise-vote: no pool document at ${statePath}`);
  const votes = document.votes ?? [];
  const cycleId = enterpriseAdmissionCycleId(request.enterpriseId);
  const tally = tallyCycleVotes(votes, cycleId);

  const supportWeight = tally.shares[request.enterpriseId] ?? 0;
  const passed = tally.quorumMet && tally.totalWeight > 0 && supportWeight > tally.totalWeight / 2;
  if (!passed) {
    return { admitted: false, reason: `enterprise "${request.enterpriseId}" admission vote did not pass (quorumMet: ${tally.quorumMet}, supportWeight: ${supportWeight}, totalWeight: ${tally.totalWeight})`, tally };
  }

  const result = confirmMemberEnterpriseAdmission(document.enterprises ?? [], request.enterpriseId, request.admittedAt);
  if (!result.admitted) return { ...result, tally };

  writeStore(statePath, { ...document, enterprises: result.enterprises });
  const receipt = recordPoolReceipt(journalRoot, "enterprise-roster", { enterpriseId: request.enterpriseId, admissionVote: tally }, request.admittedAt);
  return { admitted: true, tally, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = admitEnterpriseVoteFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.admitted) process.exitCode = 1;
  }
}
