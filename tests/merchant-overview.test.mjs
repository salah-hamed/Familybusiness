import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectMerchantOverview } from "../core/merchants/merchant-overview.js";

test("legacy projects remain visible with virtual identity and unchanged runtime owner", () => {
  const project = { ownerId:"old_uid", projectId:"restaurant", businessName:"Local" };
  const before = JSON.stringify(project);
  const summary = projectMerchantOverview(project,"old_uid_restaurant");
  assert.equal(summary.merchantId,"legacy_old_uid_restaurant");
  assert.equal(summary.runtimeProjectId,"old_uid_restaurant");
  assert.equal(summary.assignedSubscriberId,"old_uid");
  assert.equal(summary.legacy,true);
  assert.equal(JSON.stringify(project),before);
});

test("central admin projection retains the original owner while showing current assignment", () => {
  const summary = projectMerchantOverview({
    ownerId:"original", originalSubscriberId:"original",
    assignedSubscriberId:"new_subscriber", assignmentStatus:"assigned_to_new_subscriber",
    platformManaged:false, merchantId:"m_"+"a".repeat(32), linkedAt:null
  },"original_supermarket");
  assert.equal(summary.merchantId,"m_"+"a".repeat(32));
  assert.equal(summary.originalSubscriberId,"original");
  assert.equal(summary.assignedSubscriberId,"new_subscriber");
  assert.equal(summary.displayState,"مُخصص لمشترك جديد");
  assert.equal(summary.runtimeProjectId,"original_supermarket");
});

test("central admin remains read only and never changes billing or routing", () => {
  const source=readFileSync("core/merchants/merchant-overview.js","utf8");
  const admin=readFileSync("admin/admin.js","utf8");
  assert.equal(source.includes("updateDoc"),false);
  assert.equal(source.includes("setDoc"),false);
  assert.equal(admin.includes("projectMerchantOverview(project, project.projectDocId)"),true);
  for(const phrase of ["معرّف النشاط المركزي","المشترك الأصلي","المشترك المخصص","تاريخ ربط النشاط"]) {
    assert.equal(admin.includes(phrase),true,phrase);
  }
});
