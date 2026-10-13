import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMerchantId,
  buildInitialMerchantIdentity,
  resolveMerchantIdentity,
  isQualifyingMerchantLink
} from "../core/merchants/merchant-identity.js";

test("merchant ID is a cryptographically generated opaque identity", () => {
  const fakeCrypto = { getRandomValues(array) { array.fill(0xab); return array; } };
  assert.equal(createMerchantId(fakeCrypto), "m_" + "ab".repeat(16));
  assert.throws(() => createMerchantId(null), /SECURE_RANDOM_REQUIRED/);
});

test("a new merchant starts assigned to the original subscriber, not linked", () => {
  const fields = buildInitialMerchantIdentity("alice", "m_" + "a".repeat(32));
  assert.equal(fields.originalSubscriberId, "alice");
  assert.equal(fields.assignedSubscriberId, "alice");
  assert.equal(fields.assignmentStatus, "assigned_to_subscriber");
  assert.equal(fields.platformManaged, false);
  assert.equal(fields.linkedAt, null);
  assert.equal(fields.assignmentUpdatedAt, null);
  assert.throws(() => buildInitialMerchantIdentity("alice", "manual-id"), /INVALID_MERCHANT_ID/);
});

test("legacy project documents resolve without mutation or renaming project IDs", () => {
  const existing = { ownerId: "alice", projectId: "supermarket", businessName: "Local" };
  const original = JSON.stringify(existing);
  const merchant = resolveMerchantIdentity(existing, "alice_supermarket");
  assert.equal(merchant.merchantId, "legacy_alice_supermarket");
  assert.equal(merchant.originalSubscriberId, "alice");
  assert.equal(merchant.assignedSubscriberId, "alice");
  assert.equal(merchant.isLegacyIdentity, true);
  assert.equal(JSON.stringify(existing), original);
});

test("merchant's assignment can evolve without changing legacy ownerId", () => {
  const project = {
    ownerId: "alice", projectId: "restaurant",
    merchantId: "m_" + "b".repeat(32),
    originalSubscriberId: "alice",
    assignedSubscriberId: "bob",
    assignmentStatus: "assigned_to_new_subscriber",
    platformManaged: false,
    linkedAt: 123
  };
  const merchant = resolveMerchantIdentity(project, "alice_restaurant");
  assert.equal(merchant.isLegacyIdentity, false);
  assert.equal(merchant.assignedSubscriberId, "bob");
  assert.equal(merchant.originalSubscriberId, "alice");
  assert.equal(project.ownerId, "alice");
});

test("recovered shop has an explicit empty current assignee, never the original subscriber", () => {
  const project={ownerId:"old",projectId:"supermarket",merchantId:"m_"+"a".repeat(32),
    originalSubscriberId:"old",assignedSubscriberId:"",assignmentStatus:"platform_managed",platformManaged:true};
  const merchant=resolveMerchantIdentity(project,"old_supermarket");
  assert.equal(merchant.assignedSubscriberId,"");
  assert.equal(merchant.originalSubscriberId,"old");
  assert.equal(project.assignedSubscriberId,"");
});

test("creating project/inviting operator never qualifies a merchant link", () => {
  assert.equal(isQualifyingMerchantLink({}, {}), false);
  assert.equal(isQualifyingMerchantLink(
    { authUid: "operator", status: "pending_agreement", isActive: false, agreementStatus: "pending" },
    { status: "pending" }
  ), false);
  assert.equal(isQualifyingMerchantLink(
    { authUid: "operator", status: "active", isActive: true, agreementStatus: "accepted" },
    { status: "accepted", acceptedVersion: 1 }
  ), true);
  assert.equal(isQualifyingMerchantLink(
    { status: "active", isActive: true, agreementStatus: "accepted" },
    { status: "accepted", acceptedVersion: 1 }
  ), false);
});

test("legacy runtime and financial identities are unchanged in Phase A", () => {
  const source = readFileSync("templates/engine/project-engine.js", "utf8");
  const identity = readFileSync("core/projects/project-service.js", "utf8");
  const ledger = readFileSync("core/commissions/commission-service.js", "utf8");
  assert.match(source, /getProjectDocId\(ownerId, project\.id\)/);
  assert.match(identity, /return `\$\{ownerId\}_\$\{templateId\}`/);
  assert.match(ledger, /userId: ownerId/);
  assert.match(ledger, /projectId,/);
});
