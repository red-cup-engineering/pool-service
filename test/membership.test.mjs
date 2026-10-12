import { test } from "node:test";
import assert from "node:assert/strict";
import { createPool, admitMember } from "../src/pool.mjs";
import { verifyAdmissionWitness, sponsorSeedTally } from "../src/membership.mjs";
import { admitMemberEnterprise } from "../src/enterprises.mjs";
import { deriveMemberCreditLine } from "../src/pool.mjs";

function poolWithSponsor() {
  const pool = createPool({ id: "t", settlementWindowDays: 7, creditWindowDays: 90 });
  const admitted = admitMember(pool, { account: "pool:account-alice", hiveAccount: "alice-hive", ledgerPath: "/alice.beancount" }).pool;
  const tallies = [
    { drawId: "d1", memberAccount: "pool:account-alice", amount: "10", releasedAt: "2026-08-01T00:00:00Z", admittedAt: "2026-08-05T00:00:00Z", status: "matched" },
  ];
  return { pool: admitted, tallies };
}

test("verifyAdmissionWitness sponsor-vouch: verifies within the sponsor's derived line and seeds a matched tally", () => {
  const { pool, tallies } = poolWithSponsor();
  const result = verifyAdmissionWitness({ pool, tallies, enterprises: [], account: "pool:account-bob", admissionWitness: { kind: "sponsor-vouch", sponsorAccount: "pool:account-alice", pledgedAmount: "5" }, now: "2026-09-05T00:00:00Z" });
  assert.equal(result.verified, true);
  assert.equal(result.seedTally.status, "matched");
  assert.equal(result.seedTally.memberAccount, "pool:account-bob");
  const standing = deriveMemberCreditLine({ tallies: [...tallies, result.seedTally], memberAccount: "pool:account-bob", settlementWindowDays: 7, creditWindowDays: 90, now: "2026-09-05T00:00:00Z" });
  assert.equal(standing.limit, "5");
});

test("verifyAdmissionWitness sponsor-vouch: refuses a sponsor who is not an admitted member", () => {
  const { pool, tallies } = poolWithSponsor();
  const result = verifyAdmissionWitness({ pool, tallies, enterprises: [], account: "pool:account-bob", admissionWitness: { kind: "sponsor-vouch", sponsorAccount: "pool:account-nobody", pledgedAmount: "5" }, now: "2026-09-05T00:00:00Z" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /not an admitted member/);
});

test("verifyAdmissionWitness sponsor-vouch: refuses a pledge exceeding the sponsor's derived line", () => {
  const { pool, tallies } = poolWithSponsor();
  const result = verifyAdmissionWitness({ pool, tallies, enterprises: [], account: "pool:account-bob", admissionWitness: { kind: "sponsor-vouch", sponsorAccount: "pool:account-alice", pledgedAmount: "999" }, now: "2026-09-05T00:00:00Z" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /exceeds sponsor/);
});

test("verifyAdmissionWitness enterprise-roster: verifies only against an admitted enterprise", () => {
  const { pool, tallies } = poolWithSponsor();
  const enterprises = admitMemberEnterprise([], { enterpriseId: "ent-0", offer: "internal tools", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true }).enterprises;
  const ok = verifyAdmissionWitness({ pool, tallies, enterprises, account: "pool:account-bob", admissionWitness: { kind: "enterprise-roster", enterpriseId: "ent-0" }, now: "2026-09-05T00:00:00Z" });
  assert.equal(ok.verified, true);
  assert.equal(ok.seedTally, null);
  const refused = verifyAdmissionWitness({ pool, tallies, enterprises, account: "pool:account-bob", admissionWitness: { kind: "enterprise-roster", enterpriseId: "ent-9" }, now: "2026-09-05T00:00:00Z" });
  assert.equal(refused.verified, false);
});

test("verifyAdmissionWitness turntide-islander-role: refuses a stale checkedAt beyond the settlement window", () => {
  const { pool, tallies } = poolWithSponsor();
  const stale = verifyAdmissionWitness({
    pool, tallies, enterprises: [], account: "pool:account-bob",
    admissionWitness: { kind: "turntide-islander-role", discordSubjectHash: "h1", guildId: "g1", roleId: "r1", checkedAt: "2026-08-01T00:00:00Z" },
    now: "2026-09-05T00:00:00Z",
  });
  assert.equal(stale.verified, false);
  assert.match(stale.reason, /stale/);
  const fresh = verifyAdmissionWitness({
    pool, tallies, enterprises: [], account: "pool:account-bob",
    admissionWitness: { kind: "turntide-islander-role", discordSubjectHash: "h1", guildId: "g1", roleId: "r1", checkedAt: "2026-09-04T00:00:00Z" },
    now: "2026-09-05T00:00:00Z",
  });
  assert.equal(fresh.verified, true);
});

test("verifyAdmissionWitness: refuses an unrecognized kind", () => {
  const { pool, tallies } = poolWithSponsor();
  const result = verifyAdmissionWitness({ pool, tallies, enterprises: [], account: "pool:account-bob", admissionWitness: { kind: "carrier-pigeon" }, now: "2026-09-05T00:00:00Z" });
  assert.equal(result.verified, false);
});

test("sponsorSeedTally: shapes a matched, sponsor-originated tally", () => {
  const tally = sponsorSeedTally({ account: "pool:account-bob", sponsorAccount: "pool:account-alice", pledgedAmount: "5", admittedAt: "2026-09-05T00:00:00Z" });
  assert.equal(tally.status, "matched");
  assert.equal(tally.origin, "sponsor-seed");
  assert.equal(tally.amount, "5");
});
