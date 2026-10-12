import { test } from "node:test";
import assert from "node:assert/strict";
import { admitMemberEnterprise, confirmMemberEnterpriseAdmission, retireMemberEnterprise, admittedEnterpriseIds } from "../src/enterprises.mjs";

test("admitMemberEnterprise: the org's own first-roster seed admits outright with allowUnsponsored", () => {
  const result = admitMemberEnterprise([], { enterpriseId: "ent-0", offer: "internal tools", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true });
  assert.equal(result.admitted, true);
  assert.equal(result.enterprises[0].status, "admitted");
  assert.equal(result.enterprises[0].sponsorEnterprise, null);
});

test("admitMemberEnterprise: refuses an outside enterprise with no admitted sponsor", () => {
  const result = admitMemberEnterprise([], { enterpriseId: "ent-1", offer: "a scored letter", reportingCommitment: "monthly", sponsorEnterprise: "ent-0" });
  assert.equal(result.admitted, false);
  assert.match(result.reason, /not an admitted member enterprise/);
});

test("admitMemberEnterprise: pending once its sponsor is admitted", () => {
  const seeded = admitMemberEnterprise([], { enterpriseId: "ent-0", offer: "internal tools", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true }).enterprises;
  const result = admitMemberEnterprise(seeded, { enterpriseId: "ent-1", offer: "a scored letter", reportingCommitment: "monthly", sponsorEnterprise: "ent-0" });
  assert.equal(result.admitted, true);
  assert.equal(result.enterprises.find((e) => e.enterpriseId === "ent-1").status, "pending");
});

test("confirmMemberEnterpriseAdmission: moves a pending enterprise to admitted", () => {
  const seeded = admitMemberEnterprise([], { enterpriseId: "ent-0", offer: "internal tools", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true }).enterprises;
  const pending = admitMemberEnterprise(seeded, { enterpriseId: "ent-1", offer: "a scored letter", reportingCommitment: "monthly", sponsorEnterprise: "ent-0" }).enterprises;
  const result = confirmMemberEnterpriseAdmission(pending, "ent-1", "2026-09-05T00:00:00Z");
  assert.equal(result.admitted, true);
  const enterprise = result.enterprises.find((e) => e.enterpriseId === "ent-1");
  assert.equal(enterprise.status, "admitted");
  assert.equal(enterprise.admittedAt, "2026-09-05T00:00:00Z");
});

test("confirmMemberEnterpriseAdmission: refuses when there is no pending admission", () => {
  const result = confirmMemberEnterpriseAdmission([], "ent-9", "2026-09-05T00:00:00Z");
  assert.equal(result.admitted, false);
});

test("retireMemberEnterprise: retires an admitted enterprise and admittedEnterpriseIds drops it", () => {
  const admitted = admitMemberEnterprise([], { enterpriseId: "ent-0", offer: "internal tools", reportingCommitment: "monthly", sponsorEnterprise: null, allowUnsponsored: true }).enterprises;
  assert.deepEqual(admittedEnterpriseIds(admitted), ["ent-0"]);
  const result = retireMemberEnterprise(admitted, { enterpriseId: "ent-0", reason: "three cycles of no reporting", retiredAt: "2026-09-05T00:00:00Z" });
  assert.equal(result.retired, true);
  assert.deepEqual(admittedEnterpriseIds(result.enterprises), []);
});

test("retireMemberEnterprise: refuses an enterprise that is not admitted", () => {
  const result = retireMemberEnterprise([], { enterpriseId: "ent-9", reason: "no such enterprise", retiredAt: "2026-09-05T00:00:00Z" });
  assert.equal(result.retired, false);
});
