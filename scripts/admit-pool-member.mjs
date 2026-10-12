#!/usr/bin/env node
/**
 * Admits one member into a pool, bootstrapping the pool's persisted document on first use.
 * Reads a membership-v2 request `{poolId, settlementWindowDays, account,
 * settlementDestinations, ledgerWitness, admissionWitness}` as NDJSON on stdin (or the same
 * fields as
 * `--flags`); `admissionWitness` is OPTIONAL (a caller admitting a member with no witness --
 * the pool's own bootstrap admits, and every pre-existing test fixture -- gets the unchanged,
 * unwitnessed admission `admitMember` in `src/pool.mjs` already performs). When present, it
 * is verified per the membership-and-governance specification's three kinds
 * (`src/membership.mjs`'s `verifyAdmissionWitness`) before the member is admitted, and a
 * `sponsor-vouch` admission also seeds the new member's first tally so their derived credit
 * line equals the sponsor's pledge. Effects: persists `--state <path>`, and records an
 * admission receipt into `--journal-root <dir>` (default: alongside the state file).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPool, admitMember, migrateLegacyPoolMembership } from "../src/pool.mjs";
import { verifyAdmissionWitness } from "../src/membership.mjs";
import { readStore, writeStore } from "../src/store.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

/**
 * Admits `request.account` into the pool document at `statePath`, creating the pool first
 * when the document does not yet exist.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} journalRoot Custody root the admission receipt is recorded under.
 * @param {object} request Membership-v2 fields, with legacy hiveAccount/baseAddress/ledgerPath accepted as a deterministic adapter.
 * @returns {{admitted: true, pool: object, receipt: string|null}|{admitted: false, reason: string}} The admission result.
 */
export function admitPoolMember(statePath, journalRoot, request) {
  const existing = readStore(statePath, null);
  const pool = existing
    ? migrateLegacyPoolMembership(existing.pool)
    : createPool({ id: request.poolId, settlementWindowDays: request.settlementWindowDays, creditWindowDays: request.creditWindowDays, hiveAccount: request.poolHiveAccount ?? null });
  const tallies = existing?.tallies ?? [];
  const enterprises = existing?.enterprises ?? [];

  let seedTally = null;
  if (request.admissionWitness) {
    if (typeof request.admittedAt !== "string" || Number.isNaN(Date.parse(request.admittedAt))) {
      return { admitted: false, reason: "admit-pool-member: admittedAt is required when admissionWitness is present" };
    }
    const verification = verifyAdmissionWitness({ pool, tallies, enterprises, account: request.account, admissionWitness: request.admissionWitness, now: request.admittedAt });
    if (!verification.verified) return { admitted: false, reason: verification.reason };
    seedTally = verification.seedTally;
  }

  const result = admitMember(pool, {
    account: request.account,
    settlementDestinations: request.settlementDestinations,
    ledgerWitness: request.ledgerWitness,
    hiveAccount: request.hiveAccount,
    baseAddress: request.baseAddress ?? null,
    ledgerPath: request.ledgerPath,
  });
  if (!result.admitted) return result;

  const nextTallies = seedTally ? [...tallies, seedTally] : tallies;
  writeStore(statePath, { ...existing, pool: result.pool, tallies: nextTallies, draws: existing?.draws ?? [], enterprises, votes: existing?.votes ?? [], contests: existing?.contests ?? [] });

  let receipt = null;
  if (request.admittedAt) {
    receipt = recordPoolReceipt(journalRoot, "admission", { account: request.account, admissionWitness: request.admissionWitness ?? null }, request.admittedAt).id;
  }
  return { admitted: true, pool: result.pool, receipt };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      state: { type: "string" },
      "journal-root": { type: "string" },
      "pool-id": { type: "string" },
      "settlement-window-days": { type: "string" },
      "credit-window-days": { type: "string" },
      "pool-hive-account": { type: "string" },
      account: { type: "string" },
      "settlement-destinations": { type: "string" },
      "ledger-witness": { type: "string" },
      "hive-account": { type: "string" },
      "base-address": { type: "string" },
      "ledger-path": { type: "string" },
      "admitted-at": { type: "string" },
      request: { type: "string" },
    },
  });
  if (!values.state) {
    process.stderr.write("error: --state is required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.state));
    const fromRequest = values.request ? JSON.parse(values.request) : values.account ? null : JSON.parse(readFileSync(0, "utf8"));
    const request = fromRequest ?? {
      poolId: values["pool-id"],
      settlementWindowDays: values["settlement-window-days"] ? Number(values["settlement-window-days"]) : undefined,
      creditWindowDays: values["credit-window-days"] ? Number(values["credit-window-days"]) : undefined,
      poolHiveAccount: values["pool-hive-account"],
      account: values.account,
      settlementDestinations: values["settlement-destinations"] ? JSON.parse(values["settlement-destinations"]) : undefined,
      ledgerWitness: values["ledger-witness"] ? JSON.parse(values["ledger-witness"]) : undefined,
      hiveAccount: values["hive-account"],
      baseAddress: values["base-address"],
      ledgerPath: values["ledger-path"],
      admittedAt: values["admitted-at"],
    };
    const result = admitPoolMember(values.state, journalRoot, request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.admitted) process.exitCode = 1;
  }
}
