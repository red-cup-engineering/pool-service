#!/usr/bin/env node
/**
 * Retires a member enterprise from the fixed/voted split, after the dialogue-then-vote
 * sequence has closed (membership-and-governance specification, "Member enterprises"). Reads
 * a request `{enterpriseId, reason, retiredAt}` as one JSON object via `--request` or stdin.
 * One effect: persists `--state <path>` and records a retirement receipt into `--journal-root
 * <dir>` (default: alongside the state file). Refusals are data, never thrown.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { retireMemberEnterprise } from "../src/enterprises.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Retires `request.enterpriseId` on the pool document's enterprise roster at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the retirement receipt is recorded under.
 * @param {object} request `{enterpriseId, reason, retiredAt}`.
 * @returns {{retired: true, receipt: string}|{retired: false, reason: string}} The result.
 * @throws {Error} When no pool document exists at `statePath`.
 */
export function retireMemberEnterpriseFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`retire-member-enterprise: no pool document at ${statePath}`);
  const enterprises = document.enterprises ?? [];
  const result = retireMemberEnterprise(enterprises, request);
  if (!result.retired) return result;

  writeStore(statePath, { ...document, enterprises: result.enterprises });
  const receipt = recordPoolReceipt(journalRoot, "enterprise-roster", { enterpriseId: request.enterpriseId, reason: request.reason, retired: true }, request.retiredAt);
  return { retired: true, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = retireMemberEnterpriseFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.retired) process.exitCode = 1;
  }
}
