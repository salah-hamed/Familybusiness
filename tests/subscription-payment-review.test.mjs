import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminJs = readFileSync("admin/admin.js", "utf8");
const adminHtml = readFileSync("admin/index.html", "utf8");
const rules = readFileSync("firestore.rules", "utf8");

test("admin exposes a dedicated subscription payment review queue", () => {
  for (const id of [
    "subscriptionPaymentsSection",
    "subscriptionPaymentsSearch",
    "subscriptionPaymentsStatusFilter",
    "subscriptionPaymentsContainer",
    "loadMoreSubscriptionPaymentsBtn",
    "metricPendingSubscriptionPayments"
  ]) {
    assert.match(adminHtml, new RegExp(`id="${id}"`));
  }
});

test("subscriber activation is no longer exposed as a direct user-card action", () => {
  assert.doesNotMatch(adminJs, /data-action="activate-user"/);
  assert.doesNotMatch(adminJs, /activateOrRenewUser/);
  assert.match(adminJs, /data-action="view-user-payments"/);
});

test("payment review queue stays bounded, paginated and searchable", () => {
  const start = adminJs.indexOf("async function loadSubscriptionPayments");
  const end = adminJs.indexOf("function renderSubscriptionPayments", start);
  const block = adminJs.slice(start, end);
  assert.match(block, /limit\(PAGE_SIZE\)/);
  assert.match(block, /startAfter\(s\.cursor\)/);
  assert.match(block, /where\("status", "==", s\.status\)/);
  assert.match(adminJs, /searchSubscriptionPayments/);
});

test("admin approval updates payment and subscriber in one Firestore transaction", () => {
  const start = adminJs.indexOf("async function approveSubscriptionPayment");
  const end = adminJs.indexOf("async function rejectSubscriptionPayment", start);
  const block = adminJs.slice(start, end);
  assert.match(block, /runTransaction/);
  assert.match(block, /transaction\.update\(paymentRef/);
  assert.match(block, /transaction\.update\(userRef/);
  assert.match(block, /lastSubscriptionPaymentId: paymentId/);
  assert.match(block, /PAYMENT_DOES_NOT_MATCH_ACCOUNT_STATE/);
});

test("rejection records reason without activating the subscriber", () => {
  const start = adminJs.indexOf("async function rejectSubscriptionPayment");
  const end = adminJs.indexOf("async function searchSubscriptionPayments", start);
  const block = adminJs.slice(start, end);
  assert.match(block, /status: "rejected"/);
  assert.match(block, /rejectionReason/);
  assert.doesNotMatch(block, /subscriptionStatus|isActive/);
});

test("admin reviews WhatsApp proof by payment code instead of Firebase Storage", () => {
  assert.match(adminJs, /copy-payment-code/);
  assert.match(adminJs, /paymentCode/);
  assert.doesNotMatch(adminJs, /getBlob|storageRef|firebase-storage/);
});

test("rules bind approved payment and active subscriber atomically", () => {
  assert.match(rules, /existsAfter\(subscriptionPaymentPath/);
  assert.match(rules, /getAfter\(subscriptionPaymentPath/);
  assert.match(rules, /getAfter\(userPath\(resource\.data\.userId\)\)/);
  assert.match(rules, /lastSubscriptionPaymentId/);
});


test("admin exposes capped Launch 50 activation without restoring direct paid activation", () => {
  assert.match(adminJs, /grantLaunchPromo/);
  assert.match(adminJs, /grant-launch-promo/);
  assert.match(adminJs, /LAUNCH_PROMO\.limit/);
  assert.match(adminHtml, /id="metricLaunchPromo"/);
  assert.doesNotMatch(adminJs, /data-action="activate-user"/);
});

test("Launch 50 activation is modeled as a grant, not a zero-value payment", () => {
  const start = adminJs.indexOf("async function grantLaunchPromo");
  const end = adminJs.indexOf("async function approveSubscriptionPayment", start);
  const block = adminJs.slice(start, end);
  assert.match(block, /subscriptionGrants/);
  assert.match(block, /platformCounters/);
  assert.match(block, /paymentRequired: false/);
  assert.match(block, /lastActivationSource: "launch_promo"/);
  assert.doesNotMatch(block, /subscriptionPayments/);
  assert.doesNotMatch(block, /referralQualified/);
});

test("Storage deployment is removed from Firebase config", () => {
  const firebaseConfig = JSON.parse(readFileSync("firebase.json", "utf8"));
  assert.equal(firebaseConfig.storage, undefined);
});
