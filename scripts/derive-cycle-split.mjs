#!/usr/bin/env node
/**
 * Derives one cycle's directed-yield split: 20% barrier reserve, 30% tally-credit float, 50%
 * distributable (economics specification), then the distributable split into a fixed-even
 * portion across every currently-admitted member enterprise and a voted portion weighted by
 * `tally-cycle-votes`'s own persisted tally (membership-and-governance specification, "The
 * distribution rule"). Reads a request `{cycleId, totalYield, commodity, reserveFraction?,
 * floatFraction?, fixedFraction?}` as one JSON object via `--request` or stdin. One effect:
 * persists the split onto `--state <path>` and records a cycle-split receipt into
 * `--journal-root <dir>` (default: alongside the state file) -- the disclosure record the
 * membership specification's "Disclosure" section names.
 */
import { readFileSync } from "node:fs";
import { format, parse } from "@red-cup-engineering/energy-bank/decimal";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { deriveCycleSplit } from "../src/cycle.mjs";
import { normalizeDirectedYieldReceipts } from "../src/directed-yield-receipts.mjs";
import { admittedEnterpriseIds } from "../src/enterprises.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Derives and persists `request.cycleId`'s split against the pool document at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the cycle-split receipt is recorded under.
 * @param {object} request `{cycleId, directedYieldReceipts, totalYield?, commodity?, reserveFraction?, floatFraction?, fixedFraction?, recordedAt}`. `totalYield`/`commodity`, when supplied, are assertions checked against the receipt-derived values.
 * @returns {object} `deriveCycleSplit`'s result, plus `receipt`.
 * @throws {Error} When no pool document exists at `statePath`.
 */
export function deriveCycleSplitFromStore(statePath, journalRoot, request) {
  const document = readStore(statePath, null);
  if (!document?.pool) throw new Error(`derive-cycle-split: no pool document at ${statePath}`);
  const existingSplit = (document.cycleSplits ?? []).find((s) => s.cycleId === request.cycleId);
  if (existingSplit) {
    throw new Error(`derive-cycle-split: cycle "${request.cycleId}" is already closed; refusing to replace its authoritative split`);
  }
  const enterpriseIds = admittedEnterpriseIds(document.enterprises ?? []);
  const tally = (document.cycleTallies ?? []).find((t) => t.cycleId === request.cycleId);
  if (!tally) {
    throw new Error(`derive-cycle-split: cycle "${request.cycleId}" has no authoritative tally`);
  }
  const evidence = normalizeDirectedYieldReceipts(request.directedYieldReceipts);

  if (request.totalYield !== undefined && format(parse(request.totalYield)) !== evidence.totalYield) {
    throw new Error(`derive-cycle-split: asserted totalYield ${JSON.stringify(request.totalYield)} does not match receipt-derived total ${JSON.stringify(evidence.totalYield)}`);
  }
  if (request.commodity !== undefined && request.commodity !== evidence.commodity) {
    throw new Error(`derive-cycle-split: asserted commodity ${JSON.stringify(request.commodity)} does not match receipt-derived commodity ${JSON.stringify(evidence.commodity)}`);
  }

  const split = deriveCycleSplit({
    cycleId: request.cycleId,
    totalYield: evidence.totalYield,
    commodity: evidence.commodity,
    enterpriseIds,
    voteShares: tally.shares,
    quorumMet: tally.quorumMet,
    reserveFraction: request.reserveFraction,
    floatFraction: request.floatFraction,
    fixedFraction: request.fixedFraction,
  });
  const authoritativeSplit = Object.freeze({
    ...split,
    yieldEvidence: Object.freeze({
      recordNi: evidence.evidenceNi,
      receiptCount: evidence.receiptCount,
      observedThrough: evidence.observedThrough,
    }),
  });

  const cycleSplits = document.cycleSplits ?? [];
  writeStore(statePath, { ...document, cycleSplits: [...cycleSplits, authoritativeSplit] });
  const receipt = recordPoolReceipt(journalRoot, "cycle-split", authoritativeSplit, request.recordedAt);
  return { ...authoritativeSplit, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = deriveCycleSplitFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
