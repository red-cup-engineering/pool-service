#!/usr/bin/env node
/**
 * Fronts a pool draw: the timing float. Reads a request `{account, amount, feeAvoided,
 * priceFraction?, inflowDate, dueDate, requestedAt}` as one JSON object via `--request` or
 * stdin. One effect: persists `--state <path>` on admission and records a release receipt
 * into `--journal-root <dir>` (default: alongside the state file).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { deriveMemberCreditLine, frontPoolDraw, ledgerBalance, postPoolTransfer, settlementDestinationForRail } from "../src/pool.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Evaluates and, if admitted, posts one pool draw against the pool document at `statePath`.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the release receipt is recorded under.
 * @param {object} request `{account, amount, feeAvoided, priceFraction?, inflowDate, dueDate, requestedAt}`.
 * @returns {{admitted: true, drawId: string, price: string, dueDate: string, transferIntent: object}|{admitted: false, reason: string}} The result.
 */
export function frontPoolDrawFromStore(statePath, journalRoot, request) {
  const { pool, tallies, draws } = readStore(statePath, null) ?? { pool: null, tallies: [], draws: [] };
  if (!pool) throw new Error(`front-pool-draw: no pool document at ${statePath}`);
  const member = pool.members.find((m) => m.account === request.account);
  if (!member) return { admitted: false, reason: `"${request.account}" is not an admitted member of pool "${pool.id}"` };
  const hiveDestination = settlementDestinationForRail(member, "hive");
  if (hiveDestination === null) {
    return { admitted: false, reason: `"${request.account}" has no Hive settlement destination for an HBD pool draw` };
  }

  const standing = deriveMemberCreditLine({
    tallies,
    memberAccount: request.account,
    settlementWindowDays: pool.settlementWindowDays,
    creditWindowDays: pool.creditWindowDays,
    now: request.requestedAt,
  });
  const poolBalance = ledgerBalance(pool.ledger?.entries ?? [], pool.account);
  const evaluation = frontPoolDraw({
    pool,
    standing,
    memberAccount: request.account,
    amount: request.amount,
    feeAvoided: request.feeAvoided,
    priceFraction: request.priceFraction,
    inflowDate: request.inflowDate,
    dueDate: request.dueDate,
    poolBalance,
    requestedAt: request.requestedAt,
  });
  if (!evaluation.admitted) return evaluation;

  const entries = postPoolTransfer(pool.ledger?.entries ?? [], pool.account, request.account, request.amount, evaluation.drawId, request.requestedAt.slice(0, 10), `pool draw: ${pool.account} -> ${request.account}`);
  const tally = { drawId: evaluation.drawId, memberAccount: request.account, amount: request.amount, releasedAt: request.requestedAt, admittedAt: null, status: "open" };
  const draw = { ...evaluation, memberAccount: request.account, amount: request.amount, feeAvoided: request.feeAvoided, inflowDate: request.inflowDate, requestedAt: request.requestedAt, status: "fronted" };
  const transferIntent = {
    operation: ["transfer", { from: pool.hiveAccount ?? pool.account, to: hiveDestination.account, amount: `${request.amount} HBD`, memo: `pool draw ${evaluation.drawId}` }],
    mandate: null,
    paper: true,
  };
  const receipt = recordPoolReceipt(journalRoot, "release", { drawId: evaluation.drawId, member: request.account, amount: request.amount, price: evaluation.price, dueDate: evaluation.dueDate, transferIntent }, request.requestedAt);

  writeStore(statePath, { pool: { ...pool, ledger: { entries } }, tallies: [...tallies, tally], draws: [...draws, draw] });
  return { ...evaluation, transferIntent, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { state: { type: "string" }, "journal-root": { type: "string" }, request: { type: "string" } } });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const requestText = values.request ?? readFileSync(0, "utf8");
    const result = frontPoolDrawFromStore(values.state, journalRoot, JSON.parse(requestText));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.admitted) process.exitCode = 1;
  }
}
