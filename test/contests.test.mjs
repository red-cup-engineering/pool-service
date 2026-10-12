import { test } from "node:test";
import assert from "node:assert/strict";
import { openContest } from "../src/contests.mjs";

test("openContest: opens a contest on a ref with no existing open contest", () => {
  const result = openContest([], { ref: "draw:1", contestedBy: "pool:account-alice", reason: "posting missing from my ledger", contestedAt: "2026-09-05T00:00:00Z" });
  assert.equal(result.contested, true);
  assert.equal(result.contest.status, "open");
  assert.equal(result.contests.length, 1);
});

test("openContest: refuses a duplicate open contest on the same ref", () => {
  const first = openContest([], { ref: "draw:1", contestedBy: "pool:account-alice", reason: "posting missing", contestedAt: "2026-09-05T00:00:00Z" });
  const second = openContest(first.contests, { ref: "draw:1", contestedBy: "pool", reason: "second contest", contestedAt: "2026-09-06T00:00:00Z" });
  assert.equal(second.contested, false);
  assert.match(second.reason, /already has an open contest/);
});
