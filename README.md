# @red-cup-engineering/pool-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

The pool: the poor's manufactured ensemble, as operations over the house ledger, settling on
the Hive family rail. Doctrine:

- [Sizing without a bank](../../../../../science-services-section/services/social-science-services-section/services/economics-and-business-science-services-section/services/economics-science-services-section/content/text/documents/articles/notes/2026/09/04/2026-09-04-note-on-sizing-without-a-bank.md)
  (2026-09-04), section 4: N members pooling bounded sleeves face something closer to an
  ensemble; the pool is itself a sleeve, with a barrier below which it can no longer re-seed
  anyone; draws are priced on circulation, not balance; the pool is booked with two witnesses.
  Section 5: the barrier is a rising time series.
- [Fintech for a small pool](../../../../../561-group-services-section/services/561-group-operations-services-section/services/561-group-economic-operations-services-section/services/561-group-business-operations-services-section/services/561-group-finance-operations-services-section/content/text/documents/articles/notes/2026/09/04/2026-09-04-note-on-fintech-for-the-tiyospaye.md)
  (2026-09-04), section 1: the timing float, priced at the fee it avoids; section 2: value a
  member on an asset-tested benefit holds must be unbookable to their position; section 5: the
  rail is Hive, a dollar-pegged token in three seconds for nothing.
- [Three ways to turn capital into capital](../../../../../561-group-services-section/services/561-group-operations-services-section/services/561-group-economic-operations-services-section/services/561-group-business-operations-services-section/services/561-group-finance-operations-services-section/content/text/documents/articles/notes/2026/09/04/2026-09-04-note-on-three-ways-to-turn-capital-into-capital.md)
  (2026-09-04), section 3: tally credit — the limit is matched pairs in the window times the
  median settled size, times a factor falling to zero with any unmatched half-tally older than
  the settlement window; every draw is a crossing (a release receipt, an admission receipt);
  default is a mismatch held in FOUR, never an eviction.
- [Remittance and cost-to-serve measurement](../../../../../public-services-section/services/public-financial-services-section/data/records/2026-09-05-remittance-and-cost-to-serve-measurement.json)
  holds the fee schedule a draw's price is measured against.

## The money path

A member's draw is an HBD transfer from the pool's Hive account to the member's, three seconds,
no fee, priced at the overdraft or payday fee it replaces; the pool keeps that margin. The Hive
account, its key custody, and the mandate that arms live transfers are the founder's hands —
until a mandate exists, `front-pool-draw` always emits its transfer intent with `paper: true`
(`mandate: null`), the same shape Aagaard's signer expects under an armed mandate (see
`public-web3-services-section/services/hive-services-section/services/aagaard`, whose
`hiveEngineOps.mjs` "only ENCODES operations" and whose `cold-red-gate-*-broadcast.mjs` scripts
are the one place a key ever signs). This package never reads a key or a `.wif` file. The books
this package writes are real regardless: every draw and settlement is a balanced double-entry
posting, whether or not the transfer intent is ever armed.

## Why energy-bank, not the house Beancount reader

Both were candidates for the pool's ledger. `@red-cup-engineering/energy-bank` was chosen:

1. It already implements the exact primitives this doctrine names — a double-entry ledger,
   pooling (`createPool`/`withMember`/`poolDistribution`/`contributeToPool`/`distributePool`),
   player-to-player transfer, and exact decimal arithmetic — with zero runtime dependencies.
2. The house Beancount reader (`@red-cup-engineering/organizing`'s `accounting/report`, consumed
   by `computer-ledger-system-services-section/apps/farolfi`) answers a different question:
   `reconciliationReport` reconciles posted balances against balance assertions *within one
   ledger*, not two independently-kept ledgers against each other. Importing it also pulls in
   the whole relational-computing lineage (`animating`, `computing`, `gaming`, `playing`,
   `relating`, `socializing`) as transitive dependencies, which this package's actual job
   (booking HBD transfers and reading them back) does not need.
3. `reconcile-pool-books.mjs` therefore writes the two-witness comparison directly against this
   package's own draw/tally records and energy-bank's `decimal` module, never a second Beancount
   parser. A member's own ledger, wherever Farolfi/organizing keeps it, reaches this comparison
   as the same `{postings: [{date, ref, account, amount, commodity}]}` shape energy-bank itself
   produces (see `--member-ledger` on `reconcile-pool-books.mjs`) — wiring a real Farolfi-derived
   export into that shape is future integration work for a Farolfi consumer, not a parser this
   package should own.

`position-sizing-service`'s `sleeve` module (survival capital walled off, refuse rather than
clamp) is the pattern this package's draw evaluation follows, not a runtime dependency: a pool
draw has no edge to compute a Kelly fraction from, so `frontPoolDraw` reuses the *shape*
(exact decimal strings, refuse-with-a-named-reason) without importing `sizePosition`.

## Membership, member enterprises, and cycle distribution

The membership-and-governance specification
([2026-09-05-specification-of-the-directed-yield-pool-membership-and-governance.md](../../../../../public-services-section/services/public-financial-services-section/public-blockchain-finance-services-section/services/public-blockchain-yield-pool-finance-services-section/content/text/documents/articles/specifications/2026/09/05/2026-09-05-specification-of-the-directed-yield-pool-membership-and-governance.md))
and the companion economics specification's "The pool's use of directed yield" section govern
this section's operations.

- **Typed settlement destinations, one ledger.** Membership v2 stores
  `settlementDestinations[]` instead of making Hive identity mandatory. A Base-only member may
  name only `{rail:"base", address:"0x..."}`; Hive-only and Base+Hive members remain valid.
  The 0.5.0 `hiveAccount` / `baseAddress` fields are accepted only by a deterministic adapter
  and are not persisted in new member records. Energy-bank remains multi-commodity; no bridge
  is built.
- **Verification boundary.** Membership v2 is not release-ready until Tidepool CI passes a fresh canonical-registry install, syntax checks, and the full pool-service test suite on the exact PR head against the current base; a later base advance invalidates the older merge receipt.
- **Member-controlled ledger witnesses.** Membership v2 stores a `ledgerWitness` descriptor
  rather than a public server filepath. `content-addressed-postings` names a provider,
  subject, and `ni:///sha-256;...` digest; `src/ledger-witness.mjs` verifies the exact bytes
  before parsing the existing `{postings:[...]}` contract. Missing providers are
  `unavailable`; invalid content or digest mismatch is `refused`; neither becomes an empty
  ledger. Historical `ledgerPath` records migrate deterministically to an internal
  `local-file` witness so existing state can still be reconciled while public onboarding no
  longer asks a member for a server filesystem path.
- **`admissionWitness` (optional, additive on `admit-pool-member`).** When a request names one,
  `admit-pool-member` verifies it (`src/membership.mjs`'s `verifyAdmissionWitness`) before
  admitting; when absent, the pool's own unwitnessed admission applies unchanged (every
  pre-existing caller, and the pool's own bootstrap admit). Three kinds:
  - `sponsor-vouch` — refused unless `sponsorAccount` is an admitted member with a nonzero
    derived credit line and `pledgedAmount` is within it. On success the pledge becomes the new
    member's first line by seeding one matched, sponsor-originated tally
    (`sponsorSeedTally`) rather than a second, parallel credit-line mechanism: the existing
    `deriveMemberCreditLine` formula (`matchedPairs × medianSettledSize × factor`) then reports
    exactly `pledgedAmount` for a member with no other history.
  - `enterprise-roster` — refused unless `enterpriseId` names an already-admitted member
    enterprise.
  - `turntide-islander-role` — this build lot accepts a witness record `{discordSubjectHash,
    guildId, roleId, checkedAt}` a verifier already produced, and refuses a `checkedAt` older
    than the pool's own settlement window (treated as absent membership, never a cached pass).
    **The live Discord OAuth role check itself — L-Space's own admission gate performs one
    against the exact configured role ID
    ([2026-08-29-turntide-islander-discord-admission.json](../../../../../../science-services-section/sites/l-space.561.group/data/records/2026-08-29-turntide-islander-discord-admission.json))
    — is a later lot, composed from that same gate; `pool-service` does not itself hold a
    Discord client.**
  `admit-pool-member` also gains an optional `admittedAt` (required for a receipt to be
  recorded and for the turntide staleness check) and `--journal-root` (`admitPoolMember`'s
  exported signature is now `(statePath, journalRoot, request)`, matching every other
  effectful script in this package — the one signature change in 0.3.0, with no external
  consumer found in the tree at the time of the change).
- **Member enterprises** (`src/enterprises.mjs`): `admit-member-enterprise` proposes an
  enterprise onto the pending roster (refused without an already-admitted `sponsorEnterprise`,
  unless `allowUnsponsored` names the org's own first-roster seed); `admit-enterprise-vote`
  runs a pending proposal through the same weighted vote and quorum rule as a distribution
  vote — members cast support via `record-distribution-vote` under the reserved cycle id
  `enterprise-admission:<enterpriseId>` (a full-weight allocation to the candidate signals
  support, an all-zero allocation records quorum participation without supporting it), and
  admission passes at quorum with a strict majority of cast weight; `retire-member-enterprise`
  retires one after the dialogue-then-vote sequence (a human process this package does not
  model) has closed.
- **The distribution vote** (`src/votes.mjs`): `record-distribution-vote` weights a member's
  vote by their `matchedPairs` count read as of `matchedTallyAsOf` — this build lot's own
  explicit resolution of the specification's "the previous cycle's close": `pool-service` does
  not yet own a cycle calendar, so the caller (a cycle-running script or the CLI) names the
  reference date directly, fixed once at cast time. `tally-cycle-votes` sums each cycle's
  recorded votes per enterprise; quorum is three nonzero-weight voters, below which the caller
  (`derive-cycle-split`) falls back to an even split of the voted portion too.
- **The cycle split** (`src/cycle.mjs`): `derive-cycle-split` applies the economics
  specification's 20% barrier reserve / 30% tally-credit float / 50% distributable, then the
  distributable's fixed-even / tally-weighted-voted split, in exact decimal arithmetic. The
  persisted split is **receipt-bound**: a non-empty, positive, single-commodity set of directed-
  yield receipts is normalized deterministically; its exact sum and commodity become the split's
  authoritative `totalYield` and `commodity`; and `yieldEvidence.recordNi` commits to that full
  normalized receipt set. Caller-supplied `totalYield` or `commodity`, when present, are only
  assertions and must agree. Transaction booking must later present the same evidence NI, so a
  different receipt set with the same numerical total cannot be substituted after close.
  `apportionByWeight` — the largest-remainder (Hamilton) apportionment with an even, disclosed
  tie-break for the last divisible unit — was fabricated first through the jsnode fabrication
  line (`data/records/fabrication-work-order-records/apportion-by-weight-fabrication-work-order.md`, unpublished scratch
  package `@red-cup-engineering/scratch-apportion-by-weight-20260905-service@0.1.0`, every
  assay green) and its proven algorithm is reproduced here as this package's own module.
- **Contests** (`src/contests.mjs`): `contest-pool-receipt` opens a contest window on a
  `reconcilePoolBooks` bucket entry within the settlement window, refusing a duplicate open
  contest on the same ref; resolution (an amended posting, or a standing mismatch) is the
  dialogue sequence the specification names, a later human step this package does not perform.

## Account paths are commodity-derived

`@red-cup-engineering/energy-bank@0.3.1`'s `accounts.mjs` derives every account's ledger path
from the commodity actually posted (`energyAccountPath(id, commodity)` →
`liabilities:<commodity>:<id>`, defaulting to `"ENERGY"` for callers that don't name one). This
package always names HBD explicitly (`ledgerAccountPath` in `src/pool.mjs`), so a rendered pool
ledger reads `liabilities:hbd:pool:account-alice  15 HBD` — the account path and the commodity
it holds now agree.

## Layout

- `src/pool.mjs` — the algebra: the pool record, barrier series, the tally-credit formula, the
  draw, settlement, the FOUR verdict for an overdue draw, and the two-witness reconciliation.
- `src/enterprises.mjs` — the member-enterprise roster algebra (admission, confirmation,
  retirement, the admitted-ids list the fixed portion divides across).
- `src/votes.mjs` — the distribution-vote algebra (casting a weighted vote, tallying a cycle,
  the reserved enterprise-admission cycle id).
- `src/membership.mjs` — the three `admissionWitness` kinds' verification.
- `src/cycle.mjs` — the cycle-split algebra: `apportionByWeight` (largest-remainder
  apportionment with a disclosed tie-break) and `deriveCycleSplit` (the 20/30/50 then
  fixed/voted split).
- `src/directed-yield-receipts.mjs` — canonical admission of the exact receipt set that owns a
  cycle's yield basis: positive exact decimals, one commodity, duplicate refusal, deterministic
  order, exact sum, latest observation time, and a content-addressed evidence identity.
- `src/contests.mjs` — opening a contest on a reconciliation bucket entry.
- `src/store.mjs` — this package's own small persisted-document helper (one JSON document per
  pool: `{pool, tallies, draws, enterprises, votes, cycleTallies, cycleSplits, contests}`).
- `src/receipts.mjs` — the one call site for `@red-cup-engineering/semiotic-eavt-engineering-services-section/record-semantic-record`.
- `scripts/admit-pool-member.mjs`, `derive-member-credit-line.mjs`, `front-pool-draw.mjs`,
  `settle-pool-draw.mjs`, `contribute-to-pool.mjs`, `derive-pool-barrier-series.mjs`,
  `reconcile-pool-books.mjs`, `admit-member-enterprise.mjs`, `retire-member-enterprise.mjs`,
  `admit-enterprise-vote.mjs`, `record-distribution-vote.mjs`, `tally-cycle-votes.mjs`,
  `derive-cycle-split.mjs`, `contest-pool-receipt.mjs` — one operation each, a thin persistence
  shell over the `src/` algebra above. `contribute-to-pool.mjs` is a member funding the pool
  from their own sleeve: a balanced transfer via energy-bank's `contributeToPool`, in whatever
  commodity the request names.
- `apps/pool-cli.mjs` — `admit`, `line`, `draw`, `settle`, `contribute`, `barrier`, `reconcile`,
  `status`, `admit-enterprise`, `retire-enterprise`, `admit-enterprise-vote`, `vote`,
  `tally-votes`, `split`, `contest`.
- `schemas/` — a JSON Schema (draft 2020-12) pair per script, one for its request
  and one for its result, validated in `test/schema-conformance.test.mjs` through
  `@red-cup-engineering/json-schema-engineering-services-section/validation`.

## A cold-start gap, named plainly

`deriveMemberCreditLine`'s limit is `matchedPairs × medianSettledSize × factor`: a member with
no settled history has a limit of zero. The doctrine notes do not state a bootstrap rule for a
brand-new member's first-ever draw; this package does not invent one. The test fixture seeds a
matched-tally history to demonstrate the steady-state formula, and that seeding is fixture setup,
never house policy.

## Development

```sh
npm test   # node --test test/*.test.mjs
npm run check
```
