# apportion-by-weight
## Requirements
- `largest-remainder-apportionment`: The operation must split an exact decimal amount, given as a decimal string (energy-bank's `decimal.mjs` string shape), across a list of `{key, weight}` entries using the largest-remainder (Hamilton) method at the amount's own decimal precision, so every entry's share sums back to exactly the input amount.
- `tie-break-extends-precision`: When two or more entries tie for the last whole divisible unit of the amount, the operation must split that unit evenly across the tied entries by extending decimal precision (never awarding the whole unit to one tied entry by insertion order), up to a bounded number of extra decimal places (`tieBreakExtraPlaces`, default 10); any amount still unresolved at that precision boundary must be assigned one finest sub-unit at a time to the tied entries in ascending key order, deterministically.
- `zero-weight-even-fallback`: When every entry's weight is zero (or the entries list represents an even split request), the operation must treat all weights as equal (1 each), producing an even split through the same apportionment path rather than a special case.
## Prohibitions
- `refuses-negative-weight`: The operation must throw rather than apportion when any entry's weight is negative.
- `refuses-empty-entries-with-nonzero-amount`: The operation must throw rather than silently drop value when the entries list is empty but the amount is nonzero.
## Laws
- `exact-decimal-law` | energy-bank decimal.mjs (`@red-cup-engineering/energy-bank@0.3.1`) | 2026-09-05 | lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-game-system-services-section/services/energy-bank/src/decimal.mjs | Applies to every amount and share this operation produces. | A decimal is carried as a BigInt numerator over a power-of-ten denominator; nothing may round or lose a digit except an explicitly bounded, disclosed tie-break extension.
- `pure-data-transformation-law` | The language law (owner-stated 2026-08-30) | v1 | .claude/rules/org-layering.md | Applies to apportionByWeight as a pure function from decimal plus weights to decimal shares. | A function computing shares from an amount and weights performs no I/O of its own.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
## Open questions
none
## Package
```json
{"packageName":"@red-cup-engineering/scratch-apportion-by-weight-20260905-service","packageVersion":"0.1.0","license":"UNLICENSED","dependencies":{"@red-cup-engineering/energy-bank":"0.3.1"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/scratch-apportion-by-weight-20260905.mjs
#!/usr/bin/env node
import { parse, format } from "@red-cup-engineering/energy-bank/decimal";

/**
 * Splits an exact decimal amount across weighted entries using the largest-remainder (Hamilton) method at the amount's own precision, resolving any tie for the last divisible unit by extending precision evenly across the tied entries, up to a bounded number of extra places.
 * @param {{amount: string, entries: {key: string, weight: number}[], tieBreakExtraPlaces?: number}} input
 * @returns {{key: string, amount: string}[]} One share per entry, summing exactly to the input amount.
 * @throws {RangeError} When any weight is negative, or entries is empty while amount is nonzero.
 */
export function apportionByWeight({ amount, entries, tieBreakExtraPlaces = 10 }) {
  const amountDecimal = parse(amount);
  if (entries.length === 0) {
    if (amountDecimal.units !== 0n) throw new RangeError("apportion-by-weight: entries must be non-empty when amount is nonzero");
    return [];
  }
  for (const e of entries) {
    if (e.weight < 0) throw new RangeError(`apportion-by-weight: weight must be non-negative, got ${JSON.stringify(e.weight)} for "${e.key}"`);
  }
  const places = amountDecimal.places;
  const total = amountDecimal.units;
  const weightsBigInt = entries.map((e) => BigInt(Math.trunc(e.weight * 1_000_000)));
  const anyNonzero = weightsBigInt.some((w) => w !== 0n);
  const effectiveWeights = anyNonzero ? weightsBigInt : entries.map(() => 1n);
  const totalWeight = effectiveWeights.reduce((s, w) => s + w, 0n);

  const rows = entries.map((e, i) => {
    const w = effectiveWeights[i];
    const num = total * w;
    return { key: e.key, floor: num / totalWeight, rem: num % totalWeight };
  });
  const allocated = rows.reduce((s, r) => s + r.floor, 0n);
  let leftover = total - allocated;

  const order = [...rows].sort((a, b) => (a.rem === b.rem ? (a.key < b.key ? -1 : 1) : b.rem > a.rem ? 1 : -1));
  const finalUnits = new Map(rows.map((r) => [r.key, r.floor]));
  const extraShares = new Map();

  let i = 0;
  while (leftover > 0n && i < order.length) {
    const remVal = order[i].rem;
    const group = [];
    while (i < order.length && order[i].rem === remVal) {
      group.push(order[i]);
      i += 1;
    }
    if (BigInt(group.length) <= leftover) {
      for (const g of group) finalUnits.set(g.key, finalUnits.get(g.key) + 1n);
      leftover -= BigInt(group.length);
    } else {
      const sortedGroupKeys = group.map((g) => g.key).sort();
      let scaled = leftover;
      let extra = 0;
      const n = BigInt(group.length);
      while (scaled % n !== 0n && extra < tieBreakExtraPlaces) {
        scaled *= 10n;
        extra += 1;
      }
      const per = scaled / n;
      const residual = scaled % n;
      for (const key of sortedGroupKeys) extraShares.set(key, { units: per, places: places + extra });
      for (let r = 0; r < Number(residual); r += 1) {
        const key = sortedGroupKeys[r];
        const existing = extraShares.get(key);
        extraShares.set(key, { units: existing.units + 1n, places: existing.places });
      }
      leftover = 0n;
    }
  }

  return entries.map((e) => {
    const base = finalUnits.get(e.key);
    const extra = extraShares.get(e.key);
    if (!extra) return { key: e.key, amount: format({ units: base, places }) };
    const scaleUp = 10n ** BigInt(extra.places - places);
    return { key: e.key, amount: format({ units: base * scaleUp + extra.units, places: extra.places }) };
  });
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write("apportionByWeight — Splits an exact decimal amount across weighted entries using the largest-remainder (Hamilton) method at the amount's own precision, resolving any tie for the last divisible unit by extending precision evenly across the tied entries, up to a bounded number of extra places.\n");
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) process.stdout.write(`${JSON.stringify(apportionByWeight(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/apportion-by-weight.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { apportionByWeight } from "../scripts/scratch-apportion-by-weight-20260905.mjs";

test("splits evenly across two equally weighted entries with no remainder", () => {
  const result = apportionByWeight({ amount: "25.000", entries: [{ key: "a", weight: 1 }, { key: "b", weight: 1 }] });
  assert.deepEqual(result, [{ key: "a", amount: "12.5" }, { key: "b", amount: "12.5" }]);
});

test("resolves a tie for the last divisible unit by extending precision evenly", () => {
  const result = apportionByWeight({ amount: "1", entries: [{ key: "a", weight: 1 }, { key: "b", weight: 1 }] });
  assert.deepEqual(result, [{ key: "a", amount: "0.5" }, { key: "b", amount: "0.5" }]);
});

test("treats all-zero weights as an even split", () => {
  const result = apportionByWeight({ amount: "100", entries: [{ key: "a", weight: 0 }, { key: "b", weight: 0 }] });
  assert.deepEqual(result, [{ key: "a", amount: "50" }, { key: "b", amount: "50" }]);
});

test("refuses a negative weight", () => {
  assert.throws(() => apportionByWeight({ amount: "10", entries: [{ key: "a", weight: -1 }] }), RangeError);
});

test("refuses empty entries with a nonzero amount", () => {
  assert.throws(() => apportionByWeight({ amount: "10", entries: [] }), RangeError);
});
```
## Examples
```json name="a 100-unit amount split by weights 3 and 1 among two entries"
{"input":{"amount":"100","entries":[{"key":"a","weight":3},{"key":"b","weight":1}]},"output":[{"key":"a","amount":"75"},{"key":"b","amount":"25"}]}
```
## Traceability
- `largest-remainder-apportionment` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `exact-decimal-law`
- `tie-break-extends-precision` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `exact-decimal-law`
- `zero-weight-even-fallback` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `refuses-negative-weight` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
- `refuses-empty-entries-with-nonzero-amount` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `pure-data-transformation-law`
