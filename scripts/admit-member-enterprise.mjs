#!/usr/bin/env node
/**
 * Proposes one member enterprise onto the pool's pending roster, pending the admission vote
 * (`admit-enterprise-vote`). Reads a request `{enterpriseId, offer, reportingCommitment,
 * sponsorEnterprise, allowUnsponsored?, proposedAt}` as one JSON object via `--request` or
 * stdin. One effect: persists `--state <path>` and records an enterprise-roster receipt into
 * `--journal-root <dir>` (default: alongside the state file). Refusals are data, never thrown.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { admitMemberEnterprise } from "../src/enterprises.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Proposes `request` onto the pool document's enterprise roster at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the enterprise-roster receipt is recorded under.
 * @param {object} request `{enterpriseId, offer, reportingCommitment, sponsorEnterprise, allowUnsponsored?, proposedAt}`.
 * @returns {{admitted: true, receipt: string}|{admitted: false, reason: string}} The result.
 * @throws {Error} When no pool document exists at `statePath`.
 */
export function admitMemberEnterpriseFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`admit-member-enterprise: no pool document at ${statePath}`);
  const enterprises = document.enterprises ?? [];
  const result = admitMemberEnterprise(enterprises, request);
  if (!result.admitted) return result;

  writeStore(statePath, { ...document, enterprises: result.enterprises });
  const receipt = recordPoolReceipt(journalRoot, "enterprise-roster", { enterpriseId: request.enterpriseId, offer: request.offer, sponsorEnterprise: request.sponsorEnterprise ?? null }, request.proposedAt);
  return { admitted: true, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = admitMemberEnterpriseFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.admitted) process.exitCode = 1;
  }
}
