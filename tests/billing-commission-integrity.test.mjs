import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLATFORM_BILLING, REFERRAL_CONFIG } from "../core/config/platform-config.js";

test("commercial values are 350 initial, 59 monthly, and 50 referral", () => {
  assert.equal(PLATFORM_BILLING.initialActivationFee, 350);
  assert.equal(PLATFORM_BILLING.monthlyRenewalFee, 59);
  assert.equal(REFERRAL_CONFIG.qualifiedReferralReward, 50);
});

test("home pricing copy no longer exposes the old 220 EGP value", () => {
  const html = readFileSync("home/index.html", "utf8");
  const source = readFileSync("home/app.js", "utf8");
  assert.equal(html.includes("220 جنيه"), false);
  assert.equal(source.includes("PLATFORM_BILLING.initialActivationFee"), true);
  assert.equal(source.includes("PLATFORM_BILLING.monthlyRenewalFee"), true);
  assert.equal(source.includes("REFERRAL_CONFIG.qualifiedReferralReward"), true);
});

test("onboarding and admin use the central billing config", () => {
  const onboarding = readFileSync("core/onboarding/guide-state.js", "utf8");
  const admin = readFileSync("admin/admin.js", "utf8");

  assert.equal(onboarding.includes("PLATFORM_BILLING.initialActivationFee"), true);
  assert.equal(onboarding.includes("PLATFORM_BILLING.monthlyRenewalFee"), true);
  assert.equal(admin.includes("PLATFORM_BILLING.initialActivationFee"), true);
  assert.equal(admin.includes("PLATFORM_BILLING.monthlyRenewalFee"), true);
  assert.equal(admin.includes("REFERRAL_CONFIG.qualifiedReferralReward"), true);
});

test("commission service requires an accepted version for an effective snapshot", () => {
  const source = readFileSync("core/commissions/commission-service.js", "utf8");
  assert.equal(source.includes("getEffectiveCommissionSnapshot"), true);
  assert.equal(source.includes("Number(agreement.acceptedVersion) <= 0"), true);
  assert.equal(source.includes("getProjectCommissionLedgerId"), true);
  assert.equal(source.includes("project_order_"), true);
});

test("all partner order services lock the accepted commission snapshot and deterministic ledger id", () => {
  for (const path of [
    "core/supermarket/order-service.js",
    "core/restaurant/order-service.js",
    "core/laundry/order-service.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("getEffectiveCommissionSnapshot"), true, path);
    assert.equal(source.includes("getProjectCommissionLedgerId"), true, path);
    assert.equal(/commissionAgreementVersion\s*:\s*commission\.version/.test(source), true, path);
    assert.equal(/amount\s*:\s*commission\.amount/.test(source), true, path);
    assert.equal(source.includes("acceptedVersion ||"), false, path);
  }
});


test("FB-LAUNCH01 locks project commission at delivery assignment, not normal delivery completion", () => {
  const supermarket = readFileSync("core/supermarket/order-service.js", "utf8");
  const restaurant = readFileSync("core/restaurant/order-service.js", "utf8");
  const laundry = readFileSync("core/laundry/order-service.js", "utf8");

  for (const source of [supermarket, restaurant]) {
    assert.equal(source.includes('nextStatus === "assigned"'), true);
    assert.equal(source.includes('commissionTrigger: "delivery_assignment"'), true);
    assert.equal(source.includes('status: "assigned"'), true);
  }

  assert.equal(laundry.includes('nextStage==="out_for_delivery"'), true);
  assert.equal(laundry.includes('commissionTrigger:"delivery_assignment"'), true);

  for (const source of [supermarket, restaurant, laundry]) {
    assert.equal(source.includes('trigger: "delivery_assignment"') || source.includes('trigger:"delivery_assignment"'), true);
    assert.equal(source.includes("createdAt"), true);
    assert.equal(source.includes("earnedAt"), true);
    assert.equal(source.includes("legacy_delivery"), true);
  }
});
