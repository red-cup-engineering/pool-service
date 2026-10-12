#!/usr/bin/env node
/**
 * `pool-cli` — the composed face over pool-service's scripts: `admit`, `line`, `draw`,
 * `settle`, `contribute`, `barrier`, `reconcile`, `status`, `admit-enterprise`,
 * `retire-enterprise`, `admit-enterprise-vote`, `vote`, `tally-votes`, `split`, `contest`,
 * `cycle-transactions`, `reconcile-receipts`, and `disclose-cycle` (the membership-and-
 * governance specification's cycle-distribution and disclosure operations, § "Operations the
 * build lot adds").
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { admitPoolMember } from "../scripts/admit-pool-member.mjs";
import { deriveMemberCreditLineFromStore } from "../scripts/derive-member-credit-line.mjs";
import { frontPoolDrawFromStore } from "../scripts/front-pool-draw.mjs";
import { settlePoolDrawFromStore } from "../scripts/settle-pool-draw.mjs";
import { contributeToPoolFromStore } from "../scripts/contribute-to-pool.mjs";
import { derivePoolBarrierSeriesFromRequest } from "../scripts/derive-pool-barrier-series.mjs";
import { reconcilePoolBooksFromStore } from "../scripts/reconcile-pool-books.mjs";
import { admitMemberEnterpriseFromStore } from "../scripts/admit-member-enterprise.mjs";
import { retireMemberEnterpriseFromStore } from "../scripts/retire-member-enterprise.mjs";
import { admitEnterpriseVoteFromStore } from "../scripts/admit-enterprise-vote.mjs";
import { recordDistributionVoteFromStore } from "../scripts/record-distribution-vote.mjs";
import { tallyCycleVotesFromStore } from "../scripts/tally-cycle-votes.mjs";
import { deriveCycleSplitFromStore } from "../scripts/derive-cycle-split.mjs";
import { contestPoolReceiptFromStore } from "../scripts/contest-pool-receipt.mjs";
import { deriveSetOfPoolCycleTransactionsFromStore } from "../scripts/derive-set-of-pool-cycle-transactions.mjs";
import { reconcilePoolReceipts } from "../scripts/reconcile-pool-receipts.mjs";
import { publishCycleDisclosureFromStore } from "../scripts/publish-cycle-disclosure.mjs";
import { barrierAt, deriveMemberCreditLine, ledgerBalance, migrateLegacyPoolMembership, verdictForOverdueDraw } from "../src/pool.mjs";
import { readStore } from "../src/store.mjs";

function journalRootFor(statePath, values) {
  return values["journal-root"] ?? dirname(resolve(statePath));
}

function readRequest(values) {
  return JSON.parse(values.request ?? readFileSync(0, "utf8"));
}

/**
 * Every member's standing, the pool's balance against its barrier series, open draws, and
 * the FOUR verdict for any draw past its due date with no settlement.
 * @param {string} statePath Path to the pool's persisted JSON document.
 * @param {string} now ISO date/time "now" is evaluated at.
 * @returns {object} `{pool: {id, account, balance, barrier}, members: object[], openDraws: object[], mismatches: object[]}`.
 */
export function poolStatus(statePath, now) {
  const { pool: storedPool, tallies, draws } = readStore(statePath, null) ?? { pool: null, tallies: [], draws: [] };
  if (!storedPool) throw new Error(`pool-cli status: no pool document at ${statePath}`);
  const pool = migrateLegacyPoolMembership(storedPool);
  const balance = ledgerBalance(pool.ledger?.entries ?? [], pool.account);
  const barrier = barrierAt(pool.barrierSeries, now, pool.barrierFloor ?? "0");
  const members = pool.members.map((m) => ({
    account: m.account,
    settlementDestinations: m.settlementDestinations,
    standing: deriveMemberCreditLine({ tallies, memberAccount: m.account, settlementWindowDays: pool.settlementWindowDays, creditWindowDays: pool.creditWindowDays, now }),
  }));
  const openDraws = draws.filter((d) => d.status === "fronted");
  const mismatches = openDraws
    .filter((d) => Date.parse(now) > Date.parse(d.dueDate))
    .map((d) => verdictForOverdueDraw({ draw: d, pool, tallies, now }));
  return { pool: { id: pool.id, account: pool.account, balance, barrier }, members, openDraws, mismatches };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    state: { type: "string" },
    "journal-root": { type: "string" },
    "member-ledger": { type: "string" },
    account: { type: "string" },
    now: { type: "string" },
    "recorded-at": { type: "string" },
    "pool-id": { type: "string" },
    "settlement-window-days": { type: "string" },
    "credit-window-days": { type: "string" },
    "pool-hive-account": { type: "string" },
    "settlement-destinations": { type: "string" },
    "ledger-witness": { type: "string" },
    "hive-account": { type: "string" },
    "base-address": { type: "string" },
    "ledger-path": { type: "string" },
    "admitted-at": { type: "string" },
    request: { type: "string" },
    out: { type: "string" },
    "known-open": { type: "string", multiple: true },
    "wallet-registry": { type: "string" },
    "wallet-id": { type: "string", default: "tidepool-pool-base" },
    sidecar: { type: "string" },
  },
});

if (import.meta.main) {
  const [command] = positionals;
  if (!values.state && command !== "barrier" && command !== "reconcile-receipts") {
    process.stderr.write("error: --state is required\n");
    process.exit(2);
  }
  switch (command) {
    case "admit": {
      const request = values.request
        ? readRequest(values)
        : {
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
      const result = admitPoolMember(values.state, journalRootFor(values.state, values), request);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.admitted) process.exitCode = 1;
      break;
    }
    case "admit-enterprise": {
      const result = admitMemberEnterpriseFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.admitted) process.exitCode = 1;
      break;
    }
    case "retire-enterprise": {
      const result = retireMemberEnterpriseFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.retired) process.exitCode = 1;
      break;
    }
    case "admit-enterprise-vote": {
      const result = admitEnterpriseVoteFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.admitted) process.exitCode = 1;
      break;
    }
    case "vote": {
      const result = recordDistributionVoteFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.recorded) process.exitCode = 1;
      break;
    }
    case "tally-votes": {
      process.stdout.write(`${JSON.stringify(tallyCycleVotesFromStore(values.state, journalRootFor(values.state, values), readRequest(values)))}\n`);
      break;
    }
    case "split": {
      process.stdout.write(`${JSON.stringify(deriveCycleSplitFromStore(values.state, journalRootFor(values.state, values), readRequest(values)))}\n`);
      break;
    }
    case "contest": {
      const result = contestPoolReceiptFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.contested) process.exitCode = 1;
      break;
    }
    case "line": {
      process.stdout.write(`${JSON.stringify(deriveMemberCreditLineFromStore(values.state, values.account, values.now))}\n`);
      break;
    }
    case "draw": {
      const result = frontPoolDrawFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.admitted) process.exitCode = 1;
      break;
    }
    case "settle": {
      const result = settlePoolDrawFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.settled) process.exitCode = 1;
      break;
    }
    case "contribute": {
      const result = contributeToPoolFromStore(values.state, journalRootFor(values.state, values), readRequest(values));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.admitted) process.exitCode = 1;
      break;
    }
    case "barrier": {
      process.stdout.write(`${JSON.stringify(derivePoolBarrierSeriesFromRequest(readRequest(values), values.state ?? null))}\n`);
      break;
    }
    case "reconcile": {
      const result = reconcilePoolBooksFromStore(values.state, values["member-ledger"] ?? null, journalRootFor(values.state, values), values.account, values["recorded-at"]);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.reconciled) process.exitCode = 1;
      break;
    }
    case "status": {
      process.stdout.write(`${JSON.stringify(poolStatus(values.state, values.now))}\n`);
      break;
    }
    case "cycle-transactions": {
      const result = deriveSetOfPoolCycleTransactionsFromStore(values.state, journalRootFor(values.state, values), readRequest(values), { sidecarPath: values.out, knownOpenPaths: values["known-open"] });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.booked) process.exitCode = 1;
      break;
    }
    case "reconcile-receipts": {
      if (!values["wallet-registry"] || !values.sidecar || !values["recorded-at"]) {
        process.stderr.write("error: --wallet-registry, --sidecar, and --recorded-at are required\n");
        process.exit(2);
      }
      const result = await reconcilePoolReceipts({
        walletRegistryPath: values["wallet-registry"], walletId: values["wallet-id"],
        sidecarPath: values.sidecar, journalRoot: values["journal-root"] ?? dirname(resolve(values.sidecar)),
        recordedAt: values["recorded-at"],
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.reconciled) process.exitCode = 1;
      break;
    }
    case "disclose-cycle": {
      process.stdout.write(`${JSON.stringify(publishCycleDisclosureFromStore(values.state, journalRootFor(values.state, values), readRequest(values)))}\n`);
      break;
    }
    default: {
      process.stderr.write("usage: pool-cli <admit|line|draw|settle|contribute|barrier|reconcile|status|admit-enterprise|retire-enterprise|admit-enterprise-vote|vote|tally-votes|split|contest|cycle-transactions|reconcile-receipts|disclose-cycle> --state <path> ...\n");
      process.exitCode = 2;
    }
  }
}
