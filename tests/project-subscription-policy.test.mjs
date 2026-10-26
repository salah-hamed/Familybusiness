import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_MONTHLY_SUBSCRIPTION_AMOUNT,
  PROJECT_LINKING_TRIAL_DAYS,
  PROJECT_PAYMENT_GRACE_DAYS,
  PROJECT_SUBSCRIPTION_DAYS,
  resolveProjectSubscriptionAccess,
  requiredProjectSubscriptionPayment,
  nextProjectSubscriptionExpiry
} from "../core/subscriptions/project-subscription-policy.js";

const start = new Date("2026-10-01T00:00:00.000Z");
const day = 86_400_000;
const at = days => new Date(start.getTime() + days * day);
const project = extra => ({
  createdAt: start,
  linkedAt: null,
  subscriptionStatus: "trial",
  subscriptionPaymentVerified: false,
  ...extra
});

test("per-project plan pins price and independent 7-day/3-day windows", () => {
  assert.equal(PROJECT_MONTHLY_SUBSCRIPTION_AMOUNT, 35);
  assert.equal(PROJECT_LINKING_TRIAL_DAYS, 7);
  assert.equal(PROJECT_PAYMENT_GRACE_DAYS, 3);
  assert.equal(PROJECT_SUBSCRIPTION_DAYS, 30);
});

test("unlinked project can be configured for 7 days and expires at the exact boundary", () => {
  assert.equal(resolveProjectSubscriptionAccess(project({}), at(6.999)).allowed, true);
  const denied = resolveProjectSubscriptionAccess(project({}), at(7));
  assert.equal(denied.allowed, false);
  assert.equal(denied.phase, "linking_trial_expired");
  assert.equal(denied.deadline.toISOString(), "2026-10-08T00:00:00.000Z");
});

test("linking a project starts its own 3-day payment grace", () => {
  const linked = project({ linkedAt: at(5) });
  assert.equal(resolveProjectSubscriptionAccess(linked, at(7.999)).allowed, true);
  const denied = resolveProjectSubscriptionAccess(linked, at(8));
  assert.equal(denied.allowed, false);
  assert.equal(denied.phase, "payment_grace_expired");
  assert.equal(denied.deadline.toISOString(), "2026-10-09T00:00:00.000Z");
});

test("adding another project does not alter an existing project's billing anchors", () => {
  const oldProject = project({ linkedAt: at(1) });
  const newProject = project({ createdAt: at(20) });
  assert.equal(resolveProjectSubscriptionAccess(oldProject, at(3)).phase, "payment_grace");
  assert.equal(resolveProjectSubscriptionAccess(newProject, at(20)).phase, "linking_trial");
  assert.equal(resolveProjectSubscriptionAccess(oldProject, at(3)).deadline.toISOString(),
    "2026-10-05T00:00:00.000Z");
});

test("each project payment invoice is 35 EGP and identifies its project", () => {
  assert.deepEqual(requiredProjectSubscriptionPayment({
    projectDocId: "owner_supermarket_2"
  }), {
    paymentType: "initial",
    amount: 35,
    currency: "EGP",
    projectDocId: "owner_supermarket_2"
  });
  assert.equal(requiredProjectSubscriptionPayment({
    lastSubscriptionPaymentId: "verified-payment"
  }).paymentType, "renewal");
});

test("only trusted, unexpired paid project state grants paid access", () => {
  const paid = project({
    subscriptionStatus: "active",
    subscriptionPaymentVerified: true,
    subscriptionExpiresAt: at(30)
  });
  assert.equal(resolveProjectSubscriptionAccess(paid, at(29)).phase, "paid");
  assert.equal(resolveProjectSubscriptionAccess(paid, at(30)).allowed, false);
  assert.equal(resolveProjectSubscriptionAccess({
    ...paid, subscriptionExpiresAt: null, linkedAt: at(1)
  }, at(2)).allowed, false);
});

test("expired paid project cannot restart trial; suspended and malformed projects fail closed", () => {
  const expired = project({
    linkedAt: at(1),
    subscriptionPaymentVerified: true,
    lastSubscriptionPaymentId: "paid-once"
  });
  assert.equal(resolveProjectSubscriptionAccess(expired, at(10)).phase, "payment_required");
  assert.equal(resolveProjectSubscriptionAccess(project({ isActive: false }), at(1)).allowed, false);
  assert.equal(resolveProjectSubscriptionAccess(project({ createdAt: null }), at(1)).allowed, false);
  assert.equal(resolveProjectSubscriptionAccess(project({ linkedAt: "bad-date" }), at(2)).allowed, false);
  assert.throws(() => resolveProjectSubscriptionAccess(project({}), "bad-date"),
    { message: "INVALID_CURRENT_TIME" });
});

test("approved subscription expiry is calculated from approval time, not project creation", () => {
  assert.equal(nextProjectSubscriptionExpiry(at(9)).toISOString(),
    "2026-10-31T00:00:00.000Z");
  assert.throws(() => nextProjectSubscriptionExpiry("invalid"),
    { message: "INVALID_APPROVAL_TIME" });
});
