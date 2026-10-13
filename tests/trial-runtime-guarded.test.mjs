import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSubscriptionActive } from "../core/subscriptions/subscription-service.js";
import { requiredSubscriptionPayment } from "../core/subscriptions/payment-policy.js";
import { TRIAL_REGISTRATION_ENABLED } from "../core/subscriptions/trial-rollout.js";
import { buildWorkspaceGuide } from "../core/onboarding/guide-state.js";

const at = days => new Date(Date.parse("2026-10-13T00:00:00Z")+days*86400000);
const trial = extra => ({
  accessModel:"merchant_trial_v1", firstMerchantLinkedAt:null,
  createdAt:at(0),isActive:true,subscriptionStatus:"trial",
  initialActivationPaid:false,...extra
});

test("Phase B2b rollout remains off until manual Firebase rules deployment", () => {
  assert.equal(TRIAL_REGISTRATION_ENABLED,false);
  const source=readFileSync("core/auth/auth.js","utf8");
  assert.match(source,/TRIAL_REGISTRATION_ENABLED/);
  assert.match(source,/accessModel: "merchant_trial_v1"/);
  assert.match(source,/firstMerchantLinkedAt: null/);
});

test("shared access guard allows 7 days then denies without agreement", () => {
  assert.equal(isSubscriptionActive(trial(),at(6)),true);
  assert.equal(isSubscriptionActive(trial(),at(7)),false);
});

test("shared guard switches to three days after first qualified link", () => {
  const linked=trial({firstMerchantLinkedAt:at(2)});
  assert.equal(isSubscriptionActive(linked,at(4)),true);
  assert.equal(isSubscriptionActive(linked,at(5)),false);
});

test("legacy active account access and expiry semantics remain unchanged", () => {
  assert.equal(isSubscriptionActive({isActive:true,subscriptionStatus:"active"},at(200)),true);
  assert.equal(isSubscriptionActive({isActive:false,subscriptionStatus:"pending"},at(1)),false);
  assert.equal(isSubscriptionActive({isActive:true,subscriptionStatus:"active",subscriptionExpiresAt:at(30)},at(30)),false);
});

test("trial first invoice is 59 while legacy first invoice remains 350", () => {
  assert.deepEqual(requiredSubscriptionPayment(trial()),{paymentType:"initial",amount:59,currency:"EGP"});
  assert.deepEqual(requiredSubscriptionPayment({initialActivationPaid:false}),{paymentType:"initial",amount:350,currency:"EGP"});
  assert.deepEqual(requiredSubscriptionPayment(trial({initialActivationPaid:true})),{paymentType:"renewal",amount:59,currency:"EGP"});
});

test("first merchant acceptance always stores server timestamp in the same transaction", () => {
  const source=readFileSync("core/commissions/commission-service.js","utf8");
  const start=source.indexOf("export async function acceptPendingCommission");
  const end=source.indexOf("export async function rejectPendingCommission",start);
  const accept=source.slice(start,end);
  assert.match(accept,/transaction.get\(ownerRef\)/);
  assert.match(accept,/linkFirstMerchant/);
  assert.match(accept,/firstMerchantLinkedAt: serverTimestamp\(\)/);
  assert.match(accept,/firstMerchantProjectId: projectDocId/);
  assert.equal(source.includes('projectId: `${ownerId}_${templateId}`'),false);
});

test("trial onboarding does not incorrectly claim a subscription payment", () => {
  const guide=buildWorkspaceGuide({userData:trial(),subscriptionActive:true,projects:[]});
  assert.equal(guide.id,"owner-workspace-trial");
  assert.match(guide.intro,/7 أيام/);
  const expiry=buildWorkspaceGuide({userData:trial({createdAt:at(-20)}),subscriptionActive:false,projects:[]});
  assert.match(expiry.intro,/59 جنيه/);
});
