#!/usr/bin/env node
/**
 * Tidepool's own two-witness reading (economics specification, "Two-witness reconciliation"):
 * witness one is a live read of the pool's Base address's USDC balance
 * (`treasury-observation-service`); witness two is the running booked balance of the three
 * `Assets:...:EVM:Base:Pool:*` buckets in a cycle-transactions sidecar. The pool's Base
 * address is looked up in the key-management wallet registry; an unregistered id is refused,
 * naming the missing row. Read-only: no key, no `.wif`, no signing.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chain, balanceOfToken } from "@red-cup-engineering/treasury-observation-service";
import { add, format, parse } from "@red-cup-engineering/energy-bank/decimal";
import { reconcilePoolBooks } from "../src/pool.mjs";
import { recordPoolReceipt } from "../src/receipts.mjs";

const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_POOL_ASSET_ACCOUNTS = [
  "Assets:Digital-Assets:EVM:Base:Pool:Barrier-Reserve",
  "Assets:Digital-Assets:EVM:Base:Pool:Float",
  "Assets:Digital-Assets:EVM:Base:Pool:Distributable-Pending",
];
const POSTING_LINE = /^\s{2}(\S+)\s+(-?\d+(?:\.\d+)?)\s+(\S+)\s*$/mu;

/**
 * Finds `walletId` in a wallet-registry JSON document.
 * @param {object} registry A `WalletRegistry` document (key-management section's own shape).
 * @param {string} walletId The registry row id to find.
 * @returns {{address: string, chain: string}|null} The matching wallet, or `null` when absent.
 */
export function findRegisteredWallet(registry, walletId) {
  // key-management's registry rows are keyed by {chain, address} (no `id`), so a walletId may also
  // be an address or the keystore-file basename a row's custody names (e.g. "tidepool-pool-base").
  const named = (w) => [w.custody, ...(w.custodies ?? [])].some((c) => typeof c?.locator === "string" && c.locator.split("/").pop().replace(/\.json$/u, "") === walletId);
  const wallet = (registry.wallets ?? []).find((w) => w.id === walletId || (typeof w.address === "string" && w.address.toLowerCase() === String(walletId).toLowerCase()) || named(w));
  return wallet ? { address: wallet.address, chain: wallet.chain } : null;
}

/**
 * Sums every posting to `accounts` inside a Beancount sidecar's transaction blocks: a small,
 * line-oriented reader scoped to this package's own generated sidecar shape (never a general
 * Beancount parser -- the README's own reason for avoiding one applies here too).
 * @param {string} text The sidecar file's full text.
 * @param {string[]} accounts Account paths to sum postings for.
 * @returns {{amount: string, commodity: string|null}} The running signed sum and the commodity observed (assumes one commodity across the matched postings).
 */
export function sumBookedPostings(text, accounts) {
  const wanted = new Set(accounts);
  let total = parse("0");
  let commodity = null;
  for (const line of text.split("\n")) {
    const match = POSTING_LINE.exec(line);
    if (!match) continue;
    const [, account, amount, unit] = match;
    if (!wanted.has(account)) continue;
    total = add(total, parse(amount));
    commodity = unit;
  }
  return { amount: format(total), commodity };
}

/**
 * Reconciles the pool's live on-chain Base USDC balance against a cycle-transactions
 * sidecar's booked `Assets:...:EVM:Base:Pool:*` running balance.
 * @param {object} request
 * @param {string} request.walletRegistryPath Path to the key-management section's wallet-registry JSON.
 * @param {string} request.walletId The registry row id naming the pool's Base receiving address; `"tidepool-pool-base"` per the build lot.
 * @param {string} request.sidecarPath Path to the cycle-transactions sidecar to read booked postings from.
 * @param {string} request.recordedAt ISO date/time this reconciliation runs at.
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [chainOptions] Injectable transport for the live chain read (test seam; production defaults to the real `fetch`).
 * @returns {Promise<{reconciled: true, agreed: object[], mismatch: object[], postedOnly: object[], assertedOnly: object[], receipt: string}|{reconciled: false, reason: string}>} The two-witness verdict, or a refusal naming why.
 */
export async function reconcilePoolReceipts(request, chainOptions = {}) {
  const registry = JSON.parse(readFileSync(request.walletRegistryPath, "utf8"));
  const wallet = findRegisteredWallet(registry, request.walletId);
  if (!wallet) {
    return { reconciled: false, reason: `no wallet registered under id "${request.walletId}" in ${request.walletRegistryPath}` };
  }
  if (wallet.chain !== "base") {
    return { reconciled: false, reason: `wallet "${request.walletId}" is registered on chain "${wallet.chain}", not "base"` };
  }

  const sidecarText = readFileSync(request.sidecarPath, "utf8");
  const booked = sumBookedPostings(sidecarText, BASE_POOL_ASSET_ACCOUNTS);
  const commodity = booked.commodity ?? "USDC";
  const date = request.recordedAt.slice(0, 10);
  const ref = `tidepool-pool-base-balance:${date}`;
  const account = "Assets:Digital-Assets:EVM:Base:Pool";

  const onChain = await balanceOfToken(chain("base"), USDC_BASE_ADDRESS, wallet.address, chainOptions);
  if (!onChain.checked) {
    return { reconciled: false, reason: `live Base USDC balance read failed for ${wallet.address}: ${onChain.reason}` };
  }

  const verdict = reconcilePoolBooks({
    poolPostings: [{ date, ref, account, amount: booked.amount, commodity }],
    memberPostings: [{ date, ref, account, amount: onChain.amount, commodity }],
  });
  const receipt = recordPoolReceipt(request.journalRoot, "base-reconciliation", { walletId: request.walletId, address: wallet.address, sidecarPath: request.sidecarPath, ...verdict }, request.recordedAt);
  return { reconciled: true, ...verdict, receipt: receipt.id };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "wallet-registry": { type: "string" },
      "wallet-id": { type: "string", default: "tidepool-pool-base" },
      sidecar: { type: "string" },
      "journal-root": { type: "string" },
      "recorded-at": { type: "string" },
    },
  });
  if (!values["wallet-registry"] || !values.sidecar || !values["recorded-at"]) {
    process.stderr.write("error: --wallet-registry, --sidecar, and --recorded-at are required\n");
    process.exitCode = 2;
  } else {
    const journalRoot = values["journal-root"] ?? dirname(resolve(values.sidecar));
    const result = await reconcilePoolReceipts({
      walletRegistryPath: values["wallet-registry"], walletId: values["wallet-id"],
      sidecarPath: values.sidecar, journalRoot, recordedAt: values["recorded-at"],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.reconciled) process.exitCode = 1;
  }
}
