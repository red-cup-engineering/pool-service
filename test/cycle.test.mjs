import { test } from "node:test";
import assert from "node:assert/strict";
import { apportionByWeight, deriveCycleSplit } from "../src/cycle.mjs";

test("apportionByWeight: splits evenly across two equally weighted entries with no remainder", () => {
  const result = apportionByWeight("25", [{ key: "a", weight: 1 }, { key: "b", weight: 1 }]);
  assert.deepEqual(result, [{ key: "a", amount: "12.5" }, { key: "b", amount: "12.5" }]);
});

test("apportionByWeight: resolves a tie for the last divisible unit by extending precision evenly", () => {
  const result = apportionByWeight("1", [{ key: "a", weight: 1 }, { key: "b", weight: 1 }]);
  assert.deepEqual(result, [{ key: "a", amount: "0.5" }, { key: "b", amount: "0.5" }]);
});

test("apportionByWeight: a three-way tie splits evenly to the tie-break precision boundary, deterministically", () => {
  const result = apportionByWeight("1", [{ key: "a", weight: 1 }, { key: "b", weight: 1 }, { key: "c", weight: 1 }], 6);
  assert.equal(result.length, 3);
  const total = result.reduce((s, r) => s + Number(r.amount), 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares must sum to 1, got ${total}`);
  assert.deepEqual(result, [{ key: "a", amount: "0.333334" }, { key: "b", amount: "0.333333" }, { key: "c", amount: "0.333333" }]);
});

test("apportionByWeight: weights 3 and 1 split a whole amount proportionally", () => {
  const result = apportionByWeight("100", [{ key: "a", weight: 3 }, { key: "b", weight: 1 }]);
  assert.deepEqual(result, [{ key: "a", amount: "75" }, { key: "b", amount: "25" }]);
});

test("apportionByWeight: treats all-zero weights as an even split", () => {
  const result = apportionByWeight("100", [{ key: "a", weight: 0 }, { key: "b", weight: 0 }]);
  assert.deepEqual(result, [{ key: "a", amount: "50" }, { key: "b", amount: "50" }]);
});

test("apportionByWeight: refuses a negative weight", () => {
  assert.throws(() => apportionByWeight("10", [{ key: "a", weight: -1 }]), RangeError);
});

test("apportionByWeight: refuses empty entries with a nonzero amount", () => {
  assert.throws(() => apportionByWeight("10", []), RangeError);
});

test("deriveCycleSplit: 100 USDC yields the worked 20/30/50 split with 25 even and 25 voted", () => {
  const split = deriveCycleSplit({
    cycleId: "cycle-1",
    totalYield: "100",
    commodity: "USDC",
    enterpriseIds: ["ent-1", "ent-2"],
    voteShares: { "ent-1": 1, "ent-2": 1 },
    quorumMet: true,
  });
  assert.equal(split.reserve, "20");
  assert.equal(split.float, "30");
  assert.equal(split.distributable, "50");
  assert.equal(split.fixedPortion, "25");
  assert.equal(split.votedPortion, "25");
  assert.equal(split.quorumMet, true);
  assert.equal(split.voteMode, "weighted");
  assert.deepEqual(split.perEnterprise, [
    { enterpriseId: "ent-1", fixed: "12.5", voted: "12.5", total: "25" },
    { enterpriseId: "ent-2", fixed: "12.5", voted: "12.5", total: "25" },
  ]);
});

test("deriveCycleSplit: below quorum, the voted portion also falls back to an even split", () => {
  const split = deriveCycleSplit({
    cycleId: "cycle-1",
    totalYield: "100",
    commodity: "USDC",
    enterpriseIds: ["ent-1", "ent-2"],
    voteShares: { "ent-1": 9, "ent-2": 1 },
    quorumMet: false,
  });
  assert.equal(split.quorumMet, false);
  assert.equal(split.voteMode, "equal-fallback");
  assert.deepEqual(split.perEnterprise, [
    { enterpriseId: "ent-1", fixed: "12.5", voted: "12.5", total: "25" },
    { enterpriseId: "ent-2", fixed: "12.5", voted: "12.5", total: "25" },
  ]);
});

test("deriveCycleSplit: a skewed vote directs the voted portion unevenly", () => {
  const split = deriveCycleSplit({
    cycleId: "cycle-1",
    totalYield: "100",
    commodity: "USDC",
    enterpriseIds: ["ent-1", "ent-2"],
    voteShares: { "ent-1": 3, "ent-2": 1 },
    quorumMet: true,
  });
  assert.deepEqual(split.perEnterprise, [
    { enterpriseId: "ent-1", fixed: "12.5", voted: "19", total: "31.5" },
    { enterpriseId: "ent-2", fixed: "12.5", voted: "6", total: "18.5" },
  ]);
});
