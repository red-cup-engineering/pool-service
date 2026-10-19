# contribute-to-pool
## Requirements
- `member-contribution-posting`: The operation must post a balanced double-entry transfer from the member's own sleeve account into the pool's own account, in the request's named commodity, using energy-bank's ledger primitives, and return the posting record plus the ledger's new entry list.
## Prohibitions
- `refuses-non-positive-amount`: The operation must throw rather than post when amount is not a positive decimal string. [claims: a-contribution-moves-value]
- `refuses-self-contribution`: The operation must throw rather than post when sourceSleeve equals the pool account. [claims: same-account-is-no-transfer]
## Laws
- `commodity-derived-account-path-law` | energy-bank accounts.mjs (`@red-cup-engineering/energy-bank@0.3.1`) | 2026-09-05 | lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-game-system-services-section/services/energy-bank/src/accounts.mjs | Applies to how the posting's account paths are derived. | energyAccountPath(id, commodity) derives liabilities:<commodity>:<id>, never a fixed liabilities:energy:<id> path regardless of what commodity is actually posted.
- `pure-data-transformation-law` | The language law (owner-stated 2026-08-30) | v1 | .claude/rules/org-layering.md | Applies to contributeToPool as ledger-entry-list transformation, never filesystem I/O. | A function computing a new ledger entry list from an old one performs no I/O of its own; effects (persisting the state document, recording a receipt) are a caller's concern.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
## Open questions
none
## Claims
- `dep-energy-bank` | measured | dependency | @red-cup-engineering/energy-bank@0.3.1 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-energy-bank-0-3-1.json | sha256:17a12843769f6761772f831eb8c15e165c341bb36f5c3c1b6937897c5cc92d2a | npm view of @red-cup-engineering/energy-bank@0.3.1 returned its name, version and integrity (2026-10-19)
- `a-contribution-moves-value` | derived | world | A contribution transfers a positive amount from the member's sleeve to the pool, so a zero or negative amount moves nothing or moves it the wrong way | none | requirement:member-contribution-posting | The requirement posts a balanced transfer from the member into the pool, which a non-positive amount cannot be
- `same-account-is-no-transfer` | derived | world | A transfer from the pool account to itself is no transfer | none | requirement:member-contribution-posting | The requirement moves value from the member's own sleeve account into the pool's own account, two accounts
## Package
```json
{"packageName":"@red-cup-engineering/scratch-contribute-to-pool-20260905-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/energy-bank":"0.3.1"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/scratch-contribute-to-pool-20260905.mjs
#!/usr/bin/env node
import { createLedger } from "@red-cup-engineering/energy-bank/ledger";
import { contributeToPool } from "@red-cup-engineering/energy-bank/transfer";

/**
 * Posts a member's contribution into the pool from their own sleeve account, via energy-bank's contributeToPool, returning the ledger's new entry list.
 * @param {{entries: object[], sourceSleeve: string, poolAccount: string, amount: string, commodity: string, ref: string, date: string}} input
 * @returns {object[]} The ledger's entries after the append.
 * @throws {RangeError} When amount is non-positive, sourceSleeve equals poolAccount, ref is reused, or the source would go negative.
 */
export function contributeToPoolEntries({ entries, sourceSleeve, poolAccount, amount, commodity, ref, date }) {
  const ledger = createLedger(entries);
  contributeToPool(ledger, { account: poolAccount, members: [] }, sourceSleeve, amount, commodity, ref, date);
  return ledger.all();
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("contributeToPoolEntries — Posts a member's contribution into the pool from their own sleeve account, via energy-bank's contributeToPool, returning the ledger's new entry list.\n");
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) process.stdout.write(`${JSON.stringify(contributeToPoolEntries(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/contribute-to-pool.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { contributeToPoolEntries } from "../scripts/scratch-contribute-to-pool-20260905.mjs";

const SEEDED = [{ date: "2026-09-01", ref: "seed-1", postings: [{ account: "liabilities:hbd:pool:account-alice", amount: "10", commodity: "HBD" }, { account: "equity:seed:pool", amount: "-10", commodity: "HBD" }] }];

test("posts a balanced HBD contribution from a member's sleeve into the pool account", () => {
  const entries = contributeToPoolEntries({ entries: SEEDED, sourceSleeve: "pool:account-alice", poolAccount: "pool:pool-main", amount: "10", commodity: "HBD", ref: "contrib-1", date: "2026-09-05" });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].postings.some((p) => p.account === "liabilities:hbd:pool:pool-main"), true);
});

test("refuses a non-positive amount", () => {
  assert.throws(() => contributeToPoolEntries({ entries: [], sourceSleeve: "pool:account-alice", poolAccount: "pool:pool-main", amount: "0", commodity: "HBD", ref: "contrib-0", date: "2026-09-05" }), RangeError);
});
```
## Examples
```json name="a member's HBD contribution posted into the pool account"
{"input":{"entries":[{"date":"2026-09-01","ref":"seed-1","postings":[{"account":"liabilities:hbd:pool:account-alice","amount":"10","commodity":"HBD"},{"account":"equity:seed:pool","amount":"-10","commodity":"HBD"}]}],"sourceSleeve":"pool:account-alice","poolAccount":"pool:pool-main","amount":"10","commodity":"HBD","ref":"contrib-1","date":"2026-09-05"},"output":[{"date":"2026-09-01","ref":"seed-1","postings":[{"account":"liabilities:hbd:pool:account-alice","amount":"10","commodity":"HBD"},{"account":"equity:seed:pool","amount":"-10","commodity":"HBD"}]},{"date":"2026-09-05","narration":"pool contribution: pool:account-alice -> pool:pool-main","ref":"contrib-1","postings":[{"account":"liabilities:hbd:pool:account-alice","amount":"-10","commodity":"HBD"},{"account":"liabilities:hbd:pool:pool-main","amount":"10","commodity":"HBD"}]}]}
```
## Traceability
- `member-contribution-posting` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `commodity-derived-account-path-law`
- `refuses-non-positive-amount` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `refuses-self-contribution` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
