#!/usr/bin/env node
/**
 * Publishes one closed cycle's disclosure record (membership-and-governance specification,
 * "Disclosure"): reads the pool's persisted barrier series, `derive-cycle-split.mjs` result,
 * and enterprise roster off the store, derives the members' and public views
 * (`deriveCycleDisclosure`), and writes them as one dated JSON record under this package's own
 * `data/records/`. One effect: the record file write; a receipt is also recorded through the
 * semantic record journal.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { deriveCycleDisclosure } from "../src/disclosure.mjs";
import { packageRoot, readStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Derives and writes `request.cycleId`'s disclosure record from the pool document at
 * `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the disclosure receipt is recorded under.
 * @param {object} request `{cycleId, falsifiers, publishedAt}`.
 * @param {{recordPath?: string}} [options] `recordPath` overrides the default dated path under `data/records/`.
 * @returns {{published: true, path: string, receipt: string}} What was written.
 * @throws {Error} When no pool document, or no cycle-split for `request.cycleId`, exists at `statePath`.
 */
export function publishCycleDisclosureFromStore(statePath, journalRoot, request, options = {}) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`publish-cycle-disclosure: no pool document at ${statePath}`);
  const split = document.cycleSplits?.find((s) => s.cycleId === request.cycleId);
  if (!split) throw new Error(`publish-cycle-disclosure: no cycle-split document for cycle "${request.cycleId}" at ${statePath}`);

  const disclosure = deriveCycleDisclosure({
    cycleId: request.cycleId,
    barrierSeries: document.pool.barrierSeries ?? [],
    split,
    enterprises: document.enterprises ?? [],
    falsifiers: request.falsifiers,
    publishedAt: request.publishedAt,
  });

  const date = request.publishedAt.slice(0, 10);
  const recordPath = options.recordPath ?? join(packageRoot(), "data/records", `${date}-pool-cycle-disclosure-${request.cycleId}.json`);
  const recordDirectory = dirname(recordPath);
  mkdirSync(recordDirectory, { recursive: true });
  const cycleRecordSuffix = `-pool-cycle-disclosure-${request.cycleId}.json`;
  const priorCycleRecord = readdirSync(recordDirectory, { withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.endsWith(cycleRecordSuffix));
  if (existsSync(recordPath) || priorCycleRecord) {
    throw new Error(`publish-cycle-disclosure: cycle "${request.cycleId}" already has a published disclosure; refusing to overwrite or republish it`);
  }
  writeFileSync(recordPath, `${JSON.stringify(disclosure, null, 2)}\n`, "utf8");

  const receipt = recordPoolReceipt(journalRoot, "disclosure", { cycleId: request.cycleId, recordPath }, request.publishedAt);
  return { published: true, path: recordPath, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = publishCycleDisclosureFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
