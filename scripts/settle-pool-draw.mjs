#!/usr/bin/env node
/**
 * Settles a fronted pool draw: posts the member's repayment (amount plus the priced fee),
 * matches its tally, and records the admission receipt. Reads a request `{drawId,
 * admittedAt}` via `--request` or stdin. One effect: persists `--state <path>` and records
 * the receipt into `--journal-root <dir>` (default: alongside the state file).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { add, format, parse } from "@red-cup-engineering/energy-bank/decimal";
import { settlePoolDraw, postPoolRepayment } from "../src/pool.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Settles `request.drawId` against the pool document at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the admission receipt is recorded under.
 * @param {object} request `{drawId, admittedAt}`.
 * @returns {{settled: true, tally: object, receipt: string}|{settled: false, reason: string}} The result.
 */
export function settlePoolDrawFromStore(statePath, journalRoot, request) {
  const { pool, tallies, draws } = readStore(statePath, null) ?? { pool: null, tallies: [], draws: [] };
  if (!pool) throw new Error(`settle-pool-draw: no pool document at ${statePath}`);
  const draw = draws.find((d) => d.drawId === request.drawId);
  if (!draw || draw.status !== "fronted") return { settled: false, reason: `draw "${request.drawId}" is not open for settlement` };

  const repayment = format(add(parse(draw.amount), parse(draw.price)));
  const entries = postPoolRepayment(pool.ledger?.entries ?? [], draw.memberAccount, pool.account, repayment, `${draw.drawId}:settle`, request.admittedAt.slice(0, 10), `pool draw repayment: ${draw.memberAccount} -> ${pool.account}`);
  const tally = settlePoolDraw({ drawId: draw.drawId, memberAccount: draw.memberAccount, amount: draw.amount, releasedAt: draw.requestedAt, admittedAt: request.admittedAt });
  const receipt = recordPoolReceipt(journalRoot, "admission", { drawId: draw.drawId, member: draw.memberAccount, repayment }, request.admittedAt);

  const nextTallies = tallies.map((t) => (t.drawId === draw.drawId ? tally : t));
  const nextDraws = draws.map((d) => (d.drawId === draw.drawId ? { ...d, status: "settled", admittedAt: request.admittedAt } : d));
  writeStore(statePath, { pool: { ...pool, ledger: { entries } }, tallies: nextTallies, draws: nextDraws });
  return { settled: true, tally, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = settlePoolDrawFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.settled) process.exitCode = 1;
  }
}
