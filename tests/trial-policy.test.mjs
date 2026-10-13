import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MERCHANT_TRIAL_ACCESS_MODEL,
  REGISTRATION_TRIAL_DAYS,
  FIRST_MERCHANT_GRACE_DAYS,
  MONTHLY_TRIAL_SUBSCRIPTION_AMOUNT,
  resolveSubscriptionAccess,
  requiredMerchantTrialPayment
} from "../core/subscriptions/trial-policy.js";

const signup = new Date("2026-10-13T00:00:00.000Z");
const day = 86_400_000;
const trial = (extra = {}) => ({
  accessModel: MERCHANT_TRIAL_ACCESS_MODEL,
  isActive: true,
  subscriptionStatus: "trial",
  initialActivationPaid: false,
  createdAt: signup,
  firstMerchantLinkedAt: null,
  ...extra
});
const at = (days) => new Date(signup.getTime() + days * day);

test("trial policy pins 7-day signup and 3-day first-merchant windows", () => {
  assert.equal(REGISTRATION_TRIAL_DAYS, 7);
  assert.equal(FIRST_MERCHANT_GRACE_DAYS, 3);
  assert.equal(MONTHLY_TRIAL_SUBSCRIPTION_AMOUNT, 59);
});

test("new unlinked account starts immediately and remains usable before 7-day deadline", () => {
  assert.equal(resolveSubscriptionAccess(trial(), at(0)).phase, "setup_trial");
  assert.equal(resolveSubscriptionAccess(trial(), at(6.999)).allowed, true);
  const deadline = resolveSubscriptionAccess(trial(), at(6));
  assert.equal(deadline.remainingMilliseconds, day);
  assert.equal(deadline.deadline.toISOString(), "2026-10-20T00:00:00.000Z");
});

test("unlinked account is blocked at exactly 7 days: no new free window on re-login", () => {
  const denied = resolveSubscriptionAccess(trial(), at(7));
  assert.equal(denied.phase, "setup_trial_expired");
  assert.equal(denied.allowed, false);
  assert.equal(denied.requiresPayment, true);
});

test("first accepted merchant starts a fresh 3-day window instead of resetting 7 days", () => {
  const linked = trial({ firstMerchantLinkedAt: at(2) });
  assert.equal(resolveSubscriptionAccess(linked, at(2)).phase, "merchant_grace");
  assert.equal(resolveSubscriptionAccess(linked, at(4.999)).allowed, true);
  const denied = resolveSubscriptionAccess(linked, at(5));
  assert.equal(denied.phase, "merchant_grace_expired");
  assert.equal(denied.allowed, false);
});

test("first merchant link at day 6 grants the three days from the link", () => {
  const linked = trial({ firstMerchantLinkedAt: at(6) });
  assert.equal(resolveSubscriptionAccess(linked, at(7.5)).allowed, true);
  assert.equal(resolveSubscriptionAccess(linked, at(9)).allowed, false);
});

test("creating a project or operator invite alone does not shift the deadline", () => {
  const withProject = trial({
    projectId: "alice_supermarket",
    operatorId: "operator_invited",
    merchantId: "m_123"
  });
  assert.equal(resolveSubscriptionAccess(withProject, at(7)).phase, "setup_trial_expired");
});

test("legacy non-trial accounts do not receive a backdated or newly inferred free trial", () => {
  for (const oldUser of [
    { isActive: false, subscriptionStatus: "pending", createdAt: signup },
    { isActive: true, subscriptionStatus: "inactive", createdAt: signup },
    { accessModel: "unknown", isActive: true, createdAt: signup }
  ]) {
    assert.equal(resolveSubscriptionAccess(oldUser, at(1)).allowed, false);
    assert.equal(resolveSubscriptionAccess(oldUser, at(1)).phase, "legacy_requires_activation");
  }
});

test("already-paid legacy users continue to work until their subscription expiry", () => {
  const paid = { isActive: true, subscriptionStatus: "active", subscriptionExpiresAt: at(30) };
  assert.equal(resolveSubscriptionAccess(paid, at(10)).phase, "paid");
  assert.equal(resolveSubscriptionAccess(paid, at(30)).allowed, false);
  const legacyPermanent = { isActive: true, subscriptionStatus: "active" };
  assert.equal(resolveSubscriptionAccess(legacyPermanent, at(100)).allowed, true);
});

test("expired paid trial-mode user cannot restart old merchant grace", () => {
  const account = trial({
    subscriptionStatus: "active",
    initialActivationPaid: true,
    firstMerchantLinkedAt: at(2),
    subscriptionExpiresAt: at(35)
  });
  assert.equal(resolveSubscriptionAccess(account, at(35)).phase, "payment_required");
  assert.equal(resolveSubscriptionAccess(account, at(36)).allowed, false);
});

test("suspended and malformed trial accounts fail closed", () => {
  assert.equal(resolveSubscriptionAccess(trial({isActive:false}), at(1)).allowed, false);
  assert.equal(resolveSubscriptionAccess(trial({subscriptionStatus:"inactive"}), at(1)).allowed, false);
  assert.equal(resolveSubscriptionAccess(trial({createdAt:null}), at(1)).allowed, false);
  assert.equal(resolveSubscriptionAccess(trial({createdAt:at(2)}), at(1)).allowed, false);
  assert.equal(resolveSubscriptionAccess(trial({firstMerchantLinkedAt:"not a timestamp"}), at(5)).allowed, false);
  assert.equal(resolveSubscriptionAccess(trial({firstMerchantLinkedAt:at(-1)}), at(1)).allowed, false);
  assert.equal(resolveSubscriptionAccess(trial({firstMerchantLinkedAt:at(2)}), at(1)).allowed, false);
});

test("Firestore Timestamp date anchors are accepted without relying on device-saved dates", () => {
  const firestoreStamp = date => ({ toDate: () => date });
  const value = trial({ createdAt: firestoreStamp(signup), firstMerchantLinkedAt: firestoreStamp(at(1)) });
  assert.equal(resolveSubscriptionAccess(value, at(2)).phase, "merchant_grace");
});

test("new accounts have a 59 EGP first monthly invoice, not the old 350 EGP activation charge", () => {
  const first = requiredMerchantTrialPayment(trial());
  assert.deepEqual(first, { paymentType:"initial", amount:59, currency:"EGP" });
  const renewal = requiredMerchantTrialPayment(trial({initialActivationPaid:true}));
  assert.deepEqual(renewal, { paymentType:"renewal", amount:59, currency:"EGP" });
  assert.equal(requiredMerchantTrialPayment({isActive:false}), null);
});

test("Phase B1 is policy-only: existing auth, rules and orders remain unmodified", () => {
  const source = readFileSync("core/subscriptions/trial-policy.js", "utf8");
  assert.equal(source.includes("setDoc("), false);
  assert.equal(source.includes("Date.now()"), false);
  assert.equal(source.includes("serverTimestamp"), false);
  assert.equal(source.includes("request.auth.uid"), false);
});

test("opted-in users cannot gain a perpetual subscription by setting status active without expiry or payment", () => {
  const fakeActive = trial({subscriptionStatus:"active"});
  assert.equal(resolveSubscriptionAccess(fakeActive, at(1)).allowed, false);
  assert.equal(resolveSubscriptionAccess(fakeActive, at(1)).phase, "payment_required");
  assert.equal(resolveSubscriptionAccess({...fakeActive, subscriptionExpiresAt:at(30)}, at(1)).allowed, false);
  const realPaid = trial({
    subscriptionStatus:"active", initialActivationPaid:true, subscriptionExpiresAt:at(30)
  });
  assert.equal(resolveSubscriptionAccess(realPaid, at(1)).phase, "paid");
  assert.equal(resolveSubscriptionAccess(realPaid, at(30)).phase, "payment_required");
});

test("new-model launch promo must have a real expiry but can work without a paid transaction", () => {
  const grant = trial({
    subscriptionStatus:"active",
    lastActivationSource:"launch_promo",
    subscriptionExpiresAt:at(30)
  });
  assert.equal(resolveSubscriptionAccess(grant, at(10)).phase, "paid");
  assert.equal(resolveSubscriptionAccess({...grant, subscriptionExpiresAt:null}, at(10)).allowed, false);
});
