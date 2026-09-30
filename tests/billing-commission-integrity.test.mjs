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
  assert.equal(html.includes("220 جنيه"), false);
  assert.equal(html.includes("350 جنيه"), true);
  assert.equal(html.includes("59 جنيه"), true);
  assert.equal(html.includes("50 جنيه عمولة إحالة"), true);
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
    assert.equal(source.includes("commissionAgreementVersion: commission.version"), true, path);
    assert.equal(source.includes("amount: commission.amount"), true, path);
    assert.equal(source.includes("acceptedVersion ||"), false, path);
  }
});
