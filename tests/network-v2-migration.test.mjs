import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  isSubscriptionActive,
  subscriptionAccessState,
  remainingWholeDays
} from "../core/subscriptions/subscription-service.js";
import { requiredSubscriptionPayment } from "../core/subscriptions/payment-policy.js";
import { PLATFORM_BILLING } from "../core/config/platform-config.js";

const DAY = 24 * 60 * 60 * 1000;

test("network v2 account starts free with seven days to link a merchant", () => {
  const source = readFileSync("core/auth/auth.js", "utf8");
  assert.match(source, /subscriptionModel: "network_v2"/);
  assert.match(source, /subscriptionStatus: "onboarding_active"/);
  assert.match(source, /onboardingStatus: "awaiting_merchant"/);
  assert.match(source, /isActive: true/);
  assert.match(source, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(source, /subscriptionStatus: "pending"[\s\S]{0,160}billingCycle: "initial"/);
  assert.equal(PLATFORM_BILLING.initialActivationFee, 0);
  assert.equal(PLATFORM_BILLING.merchantLinkDeadlineDays, 7);
});

test("network v2 access follows merchant and payment deadlines without affecting legacy active users", () => {
  const now = new Date("2026-10-12T12:00:00Z");

  const onboarding = {
    isActive: true,
    subscriptionModel: "network_v2",
    subscriptionStatus: "onboarding_active",
    firstMerchantLinkedAt: null,
    merchantLinkDeadlineAt: new Date(now.getTime() + 2 * DAY)
  };
  assert.equal(isSubscriptionActive(onboarding, now), true);
  assert.equal(subscriptionAccessState(onboarding, now).state, "onboarding_active");
  assert.equal(remainingWholeDays(onboarding.merchantLinkDeadlineAt, now), 2);

  const overdueLink = {
    ...onboarding,
    merchantLinkDeadlineAt: new Date(now.getTime() - 1)
  };
  assert.equal(isSubscriptionActive(overdueLink, now), false);
  assert.equal(subscriptionAccessState(overdueLink, now).state, "suspended_no_merchant");

  const paymentGrace = {
    isActive: true,
    subscriptionModel: "network_v2",
    subscriptionStatus: "merchant_linked_payment_due",
    firstMerchantLinkedAt: new Date(now.getTime() - DAY),
    firstPaymentDueAt: new Date(now.getTime() + DAY)
  };
  assert.equal(isSubscriptionActive(paymentGrace, now), true);

  const paymentOverdue = {
    ...paymentGrace,
    firstPaymentDueAt: new Date(now.getTime() - 1)
  };
  assert.equal(isSubscriptionActive(paymentOverdue, now), false);
  assert.equal(subscriptionAccessState(paymentOverdue, now).state, "suspended_payment_due");

  const legacy = {
    isActive: true,
    subscriptionStatus: "active"
  };
  assert.equal(isSubscriptionActive(legacy, now), true);
});

test("first network v2 payment is the 59 EGP monthly subscription, not an activation fee", () => {
  assert.deepEqual(
    requiredSubscriptionPayment({
      subscriptionModel: "network_v2",
      initialActivationPaid: false
    }),
    { paymentType: "renewal", amount: 59, currency: "EGP" }
  );
});

test("new projects keep legacy projectDocId while adding durable central merchant assignment", () => {
  const source = readFileSync("templates/engine/project-engine.js", "utf8");
  assert.match(source, /merchantId: projectDocId/);
  assert.match(source, /originalSubscriberId: ownerId/);
  assert.match(source, /assignedSubscriberId: ownerId/);
  assert.match(source, /assignmentStatus: "assigned_to_subscriber"/);
  assert.match(source, /platformManaged: false/);
  assert.match(source, /merchantRelationshipStatus: "awaiting_operator"/);
});

test("operator claim is the real merchant-link milestone and starts the three-day payment window once", () => {
  const source = readFileSync("core/partners/partner-service.js", "utf8");
  assert.match(source, /merchantRelationshipStatus: "linked"/);
  assert.match(source, /acceptedPlatformTermsAt: serverTimestamp\(\)/);
  assert.match(source, /if \(owner\.subscriptionModel === "network_v2" && !owner\.firstMerchantLinkedAt\)/);
  assert.match(source, /subscriptionStatus: "merchant_linked_payment_due"/);
  assert.match(source, /firstMerchantLinkedAt: serverTimestamp\(\)/);
  assert.match(source, /3 \* 24 \* 60 \* 60 \* 1000/);
});

test("admin hides obsolete manual activation promo and reversal surfaces but keeps payment review", () => {
  const html = readFileSync("admin/index.html", "utf8");
  const source = readFileSync("admin/admin.js", "utf8");

  assert.match(html, /data-section="reversalsSection"[^>]*hidden/);
  assert.match(html, /id="reversalsSection"[^>]*hidden/);
  assert.match(html, /id="metricLaunchPromo"/);
  assert.match(html, /id="metricPendingSubscriptionPayments"/);

  const renderUsersStart = source.indexOf("function renderUsers()");
  const renderUsersEnd = source.indexOf("async function grantLaunchPromo", renderUsersStart);
  const renderUsers = source.slice(renderUsersStart, renderUsersEnd);
  assert.doesNotMatch(renderUsers, /grant-launch-promo|activate-user/);
  assert.match(renderUsers, /راجع دفعات الاشتراك/);
  assert.match(source, /اعتماد الاشتراك/);
});

test("commission reversal is retired from visible owner and operator UI while history logic remains intact", () => {
  const finance = readFileSync("core/commissions/finance-panel.js", "utf8");
  assert.doesNotMatch(finance, /data-reversal-action|طلبات عكس العمولة|confirmCommissionReversal|rejectCommissionReversal/);

  for (const path of [
    "supermarket-operator/app.js",
    "restaurant-operator/app.js",
    "bakery-operator/app.js",
    "laundry-operator/app.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /<button class="secondary requestReversal"/, path);
  }

  const settlement = readFileSync("core/commissions/settlement-service.js", "utf8");
  assert.match(settlement, /where\("status", "==", "reversed"\)/);
});

test("runtime supermarket catalog contains no Carrefour branding or retailer product links", () => {
  for (const path of [
    "core/supermarket/master-catalog-data.js",
    "core/supermarket/daily-essentials.js",
    "core/supermarket/catalog-service.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /carrefour|كارفور/i, path);
  }
});

test("custom products cannot add or edit external image URLs until safe object storage is connected", () => {
  const html = readFileSync("supermarket-operator/products.html", "utf8");
  const source = readFileSync("supermarket-operator/products.js", "utf8");
  const service = readFileSync("core/supermarket/catalog-service.js", "utf8");

  assert.doesNotMatch(html, /id="productImage"/);
  assert.match(html, /id="productImageFile"[^>]*type="file"[^>]*disabled/);
  assert.doesNotMatch(html, /رابط الصورة اختياري/);
  assert.doesNotMatch(source, /class="editImage"|querySelector\("\.editImage"\)/);
  assert.match(source, /size: \$\("productSize"\)\.value,\s*image: ""/);
  assert.match(service, /image: masterId \? clean\(data\.image \|\| master\?\.image\) : ""/);
  assert.match(service, /image: "",/);
});

test("network v2 changed JavaScript modules remain syntactically valid", () => {
  for (const path of [
    "app.js",
    "workspace/app.js",
    "admin/admin.js",
    "core/auth/auth.js",
    "core/subscriptions/subscription-service.js",
    "core/subscriptions/payment-policy.js",
    "core/partners/partner-service.js",
    "core/commissions/finance-panel.js",
    "core/supermarket/catalog-service.js",
    "supermarket-operator/products.js"
  ]) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path} syntax error:\n${result.stderr || result.stdout}`);
  }
});
