/**
 * `cycle` — a directed-yield cycle's split: 20% barrier reserve / 30% tally-credit float /
 * 50% distributable (economics specification, "The pool's use of directed yield"), then the
 * distributable split into a fixed-even portion and a tally-weighted voted portion
 * (membership-and-governance specification, "The distribution rule"). `apportionByWeight` was
 * fabricated first through the jsnode fabrication line
 * (`data/records/fabrication-work-order-records/apportion-by-weight-fabrication-work-order.md`, package
 * `@red-cup-engineering/scratch-apportion-by-weight-20260905-service@0.1.0`, unpublished
 * scratch) and its proven algorithm is reproduced here as this package's own module so
 * `derive-cycle-split.mjs` can import it directly, per the house's own decimal law: nothing
 * may round or lose a digit except an explicitly bounded, disclosed tie-break extension.
 */
import { parse, format, add, negate } from "@red-cup-engineering/energy-bank/decimal";

/**
 * Splits an exact decimal amount across weighted entries using the largest-remainder
 * (Hamilton) method at the amount's own decimal precision (the membership specification's
 * "arithmetic tie rule": "a numeric remainder, resolved arithmetically, never a coin flip").
 * A tie for the last divisible unit is split evenly across the tied entries by extending
 * decimal precision one digit at a time, up to `tieBreakExtraPlaces`; any amount still
 * unresolved at that precision boundary (only possible when the tied-group size shares no
 * common factor with ten, e.g. a three-way tie) is assigned one finest sub-unit at a time to
 * the tied entries in ascending key order — disclosed here as the implementation's precision
 * boundary, never claimed as perfectly even beyond it, and never a coin flip.
 * @param {string} amount Exact decimal string to apportion.
 * @param {{key: string, weight: number}[]} entries Entries to split across; a weight of every entry being zero is treated as an even split (all weights equal).
 * @param {number} [tieBreakExtraPlaces] Bound on extra decimal places used to resolve a tie; defaults to 10.
 * @returns {{key: string, amount: string}[]} One share per entry, in `entries`' own order, summing exactly to `amount`.
 * @throws {RangeError} When any weight is negative, or `entries` is empty while `amount` is nonzero.
 */
export function apportionByWeight(amount, entries, tieBreakExtraPlaces = 10) {
  const amountDecimal = parse(amount);
  if (entries.length === 0) {
    if (amountDecimal.units !== 0n) throw new RangeError("cycle: entries must be non-empty when amount is nonzero");
    return [];
  }
  for (const e of entries) {
    if (e.weight < 0) throw new RangeError(`cycle: weight must be non-negative, got ${JSON.stringify(e.weight)} for "${e.key}"`);
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

/** Multiplies a decimal by a plain fraction (e.g. `0.2`), trimmed to `targetPlaces`, throwing
 *  rather than rounding away a nonzero digit (decimal.mjs's own "nothing loses a digit" rule,
 *  extended here to a controlled trim rather than only ever scaling up). */
function multiplyByFractionTrimmed(decimal, fraction, targetPlaces) {
  const fractionDecimal = parse(fraction.toString());
  const productUnits = decimal.units * fractionDecimal.units;
  const productPlaces = decimal.places + fractionDecimal.places;
  if (targetPlaces >= productPlaces) return { units: productUnits * 10n ** BigInt(targetPlaces - productPlaces), places: targetPlaces };
  const diff = productPlaces - targetPlaces;
  const factor = 10n ** BigInt(diff);
  if (productUnits % factor !== 0n) {
    throw new RangeError(`cycle: cannot represent an exact amount at ${targetPlaces} decimal places without rounding`);
  }
  return { units: productUnits / factor, places: targetPlaces };
}

/**
 * Derives one cycle's split of directed yield: 20% barrier reserve, 30% tally-credit float,
 * 50% distributable (economics specification, "The pool's use of directed yield"), then the
 * distributable split into a fixed-even portion across every currently-admitted member
 * enterprise and a voted portion weighted by `voteShares` (membership-and-governance
 * specification, "The distribution rule") — falling back to an even split of the voted portion
 * too when `quorumMet` is false (the specification's quorum rule).
 * @param {object} request
 * @param {string} request.cycleId The cycle this split belongs to.
 * @param {string} request.totalYield Exact decimal string: the cycle's total directed yield.
 * @param {string} request.commodity The commodity `totalYield` is denominated in.
 * @param {string[]} request.enterpriseIds Every currently-admitted member enterprise, sharing the fixed portion evenly regardless of the vote.
 * @param {Record<string, number>} [request.voteShares] Each enterprise's summed matched-tally-weighted vote from `tally-cycle-votes`; entries absent here are treated as zero.
 * @param {boolean} [request.quorumMet] Whether the cycle's vote met quorum; when false the voted portion is also split evenly (defaults to true).
 * @param {number} [request.reserveFraction] Fraction of `totalYield` retained as barrier reserve; defaults to 0.20.
 * @param {number} [request.floatFraction] Fraction of `totalYield` retained as tally-credit float; defaults to 0.30.
 * @param {number} [request.fixedFraction] Fraction of the distributable bucket divided evenly (the remainder is voted); defaults to 0.50.
 * @returns {{cycleId: string, commodity: string, totalYield: string, reserve: string, float: string, distributable: string, fixedPortion: string, votedPortion: string, perEnterprise: {enterpriseId: string, fixed: string, voted: string, total: string}[]}} The cycle's exact-decimal split.
 * @throws {RangeError} When `enterpriseIds` is empty while the distributable bucket is nonzero, or the requested fractions cannot be represented exactly at `totalYield`'s own precision.
 */
export function deriveCycleSplit({ cycleId, totalYield, commodity, enterpriseIds, voteShares = {}, quorumMet = true, reserveFraction = 0.2, floatFraction = 0.3, fixedFraction = 0.5 }) {
  const total = parse(totalYield);
  const reserve = multiplyByFractionTrimmed(total, reserveFraction, total.places);
  const float = multiplyByFractionTrimmed(total, floatFraction, total.places);
  const distributable = add(total, add(negate(reserve), negate(float)));
  const fixedPortion = multiplyByFractionTrimmed(distributable, fixedFraction, distributable.places);
  const votedPortion = add(distributable, negate(fixedPortion));

  const fixedShares = apportionByWeight(format(fixedPortion), enterpriseIds.map((id) => ({ key: id, weight: 1 })));
  const votedWeights = enterpriseIds.map((id) => ({ key: id, weight: quorumMet ? (voteShares[id] ?? 0) : 1 }));
  const votedShares = apportionByWeight(format(votedPortion), votedWeights);

  const perEnterprise = enterpriseIds.map((id) => {
    const fixed = fixedShares.find((s) => s.key === id).amount;
    const voted = votedShares.find((s) => s.key === id).amount;
    return { enterpriseId: id, fixed, voted, total: format(add(parse(fixed), parse(voted))) };
  });

  return {
    cycleId,
    commodity,
    totalYield: format(total),
    reserve: format(reserve),
    float: format(float),
    distributable: format(distributable),
    fixedPortion: format(fixedPortion),
    votedPortion: format(votedPortion),
    quorumMet,
    voteMode: quorumMet ? "weighted" : "equal-fallback",
    perEnterprise,
  };
}
