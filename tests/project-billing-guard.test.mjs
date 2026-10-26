import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNewProjectBillingGuard,
  buildSubmittedProjectBillingGuard,
  buildReviewedProjectBillingGuard
} from "../core/subscriptions/project-billing-guard.js";

const at = new Date("2026-10-26T12:00:00.000Z");
const base = () => buildNewProjectBillingGuard("owner_supermarket_instance-01", "owner", "pay-001", at);

test("project billing guard is scoped to one project and starts pending", () => {
  assert.deepEqual(base(), {
    projectDocId: "owner_supermarket_instance-01",
    ownerId: "owner",
    pendingPaymentId: "pay-001",
    lastReviewedPaymentId: "",
    revision: 1,
    updatedAt: at
  });
});

test("project guard allows a new payment only after the prior payment is reviewed", () => {
  const reviewed = buildReviewedProjectBillingGuard(base(), "owner_supermarket_instance-01", "owner", "pay-001", at);
  const next = buildSubmittedProjectBillingGuard(reviewed, "owner_supermarket_instance-01", "owner", "pay-002", at);
  assert.equal(next.pendingPaymentId, "pay-002");
  assert.equal(next.revision, 3);
  assert.throws(
    () => buildSubmittedProjectBillingGuard(base(), "owner_supermarket_instance-01", "owner", "pay-002", at),
    { message: "PROJECT_BILLING_GUARD_PENDING_OR_MISSING" }
  );
});

test("project guard rejects cross-project or cross-owner approval", () => {
  assert.throws(
    () => buildReviewedProjectBillingGuard(base(), "owner_restaurant_instance-02", "owner", "pay-001", at),
    { message: "PROJECT_BILLING_GUARD_PAYMENT_CHANGED" }
  );
  assert.throws(
    () => buildReviewedProjectBillingGuard(base(), "owner_supermarket_instance-01", "other-owner", "pay-001", at),
    { message: "PROJECT_BILLING_GUARD_PAYMENT_CHANGED" }
  );
});

test("project guard rejects malformed identifiers and stale payment IDs", () => {
  assert.throws(
    () => buildNewProjectBillingGuard("bad/project", "owner", "pay-001", at),
    { message: "PROJECT_BILLING_GUARD_INVALID_PROJECT" }
  );
  assert.throws(
    () => buildReviewedProjectBillingGuard(base(), "owner_supermarket_instance-01", "owner", "different-payment", at),
    { message: "PROJECT_BILLING_GUARD_PAYMENT_CHANGED" }
  );
});
