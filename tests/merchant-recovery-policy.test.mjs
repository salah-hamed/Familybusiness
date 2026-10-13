import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessPlatformMerchantRecovery,
  MERCHANT_RECOVERY_REASON
} from "../core/merchants/merchant-recovery-policy.js";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const day = days => new Date(NOW.getTime() + days * 86400000);
const project = {
  ownerId:"initial_subscriber",originalSubscriberId:"initial_subscriber",
  assignedSubscriberId:"initial_subscriber",
  merchantId:"m_"+"a".repeat(32),
  assignmentStatus:"assigned_to_subscriber",platformManaged:false,
  template:"supermarket",operatingModel:"partner_operated",
  status:"active",isActive:true
};
const operator = {authUid:"shop_operator",status:"active",isActive:true,agreementStatus:"accepted"};
const agreement = {status:"accepted",acceptedVersion:2};

function fixture(overrides={}) {
  return {
    projectDocId:"initial_subscriber_supermarket",
    project,
    operator,
    agreement,
    subscriber:{
      uid:"initial_subscriber",
      isActive:true,subscriptionStatus:"active",
      initialActivationPaid:true,subscriptionExpiresAt:day(-1)
    },
    reason:MERCHANT_RECOVERY_REASON.OVERDUE_RENEWAL,
    now:NOW,
    ...overrides
  };
}

test("overdue renewal is an eligible unilateral recovery, but cannot cut over without finance isolation", () => {
  const input=fixture();const before=JSON.stringify(input);
  const decision=assessPlatformMerchantRecovery(input);
  assert.equal(decision.eligibleForRecovery,true);
  assert.equal(decision.oldSubscriberApprovalRequired,false);
  assert.equal(decision.operatorShutdownRequired,false);
  assert.equal(decision.mayApplyTakeoverNow,false);
  assert.equal(decision.previousSubscriberId,"initial_subscriber");
  assert.equal(decision.deferredSafetyRequirements.length,4);
  assert.equal(JSON.stringify(input),before);
});

test("paid subscribers still in term cannot be reclaimed for nonpayment",()=>{
  const decision=assessPlatformMerchantRecovery(fixture({
    subscriber:{uid:"initial_subscriber",initialActivationPaid:true,subscriptionExpiresAt:day(3)}
  }));
  assert.equal(decision.eligibleForRecovery,false);
});

test("users waiting on renewal payment review are protected from automatic nonpayment recovery",()=>{
  assert.equal(assessPlatformMerchantRecovery(fixture({
    hasUnreviewedRenewalPayment:true
  })).eligibleForRecovery,false);
});

test("trial, free legacy and missing-expiry accounts are not auto-seized on imagined due dates",()=>{
  for(const subscriber of [
    {uid:"initial_subscriber",subscriptionStatus:"trial",createdAt:day(-10),initialActivationPaid:false},
    {uid:"initial_subscriber",subscriptionStatus:"active",initialActivationPaid:false},
    {uid:"initial_subscriber",subscriptionStatus:"active",initialActivationPaid:true},
    {uid:"initial_subscriber",subscriptionStatus:"active",initialActivationPaid:true,subscriptionExpiresAt:"bad-date"}
  ]) {
    assert.equal(assessPlatformMerchantRecovery(fixture({subscriber})).eligibleForRecovery,false);
  }
});

test("a documented admin-confirmed violation allows recovery even before subscription expiry",()=>{
  const violation={
    status:"confirmed",
    reasonCode:"serious_policy_breach",
    evidenceReference:"case-2026-1041",
    confirmedByAdminUid:"admin_uid",
    confirmedAt:day(-0.2)
  };
  const decision=assessPlatformMerchantRecovery(fixture({
    reason:MERCHANT_RECOVERY_REASON.CONFIRMED_VIOLATION,
    subscriber:{uid:"initial_subscriber",initialActivationPaid:true,subscriptionExpiresAt:day(30)},
    violation
  }));
  assert.equal(decision.eligibleForRecovery,true);
  assert.equal(decision.oldSubscriberApprovalRequired,false);
  assert.equal(decision.mayApplyTakeoverNow,false);
});

test("unverified, future-dated or evidence-free violations do not permit recovery",()=>{
  const valid={status:"confirmed",reasonCode:"fraud",evidenceReference:"case-2026-1",confirmedByAdminUid:"administrator",confirmedAt:day(-1)};
  for(const violation of [
    null,
    {...valid,status:"pending"},
    {...valid,evidenceReference:""},
    {...valid,confirmedByAdminUid:""},
    {...valid,confirmedAt:day(1)},
    {...valid,reasonCode:"x"},
  ]) {
    const decision=assessPlatformMerchantRecovery(fixture({
      reason:MERCHANT_RECOVERY_REASON.CONFIRMED_VIOLATION,violation
    }));
    assert.equal(decision.eligibleForRecovery,false);
  }
});

test("paused shop, absent operator and already recovered shop cannot qualify",()=>{
  for(const changes of [
    {operator:{...operator,isActive:false}},
    {agreement:{...agreement,status:"pending"}},
    {project:{...project,status:"inactive"}},
    {project:{...project,platformManaged:true,assignmentStatus:"platform_managed"}},
    {project:{...project,operatingModel:"owner_operated"}},
    {subscriber:{uid:"different",initialActivationPaid:true,subscriptionExpiresAt:day(-1)}}
  ]) {
    assert.equal(assessPlatformMerchantRecovery(fixture(changes)).eligibleForRecovery,false);
  }
});

test("after any future handover, check the current assignee rather than the original owner",()=>{
  const assigned={...project,assignedSubscriberId:"second_subscriber",assignmentStatus:"assigned_to_new_subscriber"};
  const decision=assessPlatformMerchantRecovery(fixture({
    project:assigned,
    subscriber:{uid:"second_subscriber",initialActivationPaid:true,subscriptionExpiresAt:day(-2)}
  }));
  assert.equal(decision.eligibleForRecovery,true);
  assert.equal(decision.originalSubscriberId,"initial_subscriber");
  assert.equal(decision.previousSubscriberId,"second_subscriber");
});

test("recovery policy has no write or subscriber approval dependencies",()=>{
  const source=readFileSync("core/merchants/merchant-recovery-policy.js","utf8");
  for(const token of ["setDoc(", "updateDoc(", "runTransaction(", "deleteDoc(", "transaction.update(", "subscriberConsent","oldSubscriberConsent"]) {
    assert.equal(source.includes(token),false,token);
  }
  assert.match(source,/mayApplyTakeoverNow: false/);
  assert.match(source,/oldSubscriberApprovalRequired: false/);
  assert.match(source,/operatorShutdownRequired: false/);
  assert.match(source,/deferredSafetyRequirements/);
});


test("first 59 EGP payment overdue after first merchant 3-day grace qualifies without old subscriber veto", () => {
  const subscriber = {
    uid:"initial_subscriber",
    accessModel:"merchant_trial_v1", subscriptionStatus:"trial",
    initialActivationPaid:false, firstMerchantLinkedAt:day(-4)
  };
  const result=assessPlatformMerchantRecovery(fixture({
    reason:MERCHANT_RECOVERY_REASON.UNPAID_FIRST_MONTH,subscriber
  }));
  assert.equal(result.eligibleForRecovery,true);
  assert.equal(result.oldSubscriberApprovalRequired,false);
  assert.equal(result.mayApplyTakeoverNow,false);
});

test("first month is NOT overdue before 3 days, before link, or while payment is awaiting review",()=>{
  const base={
    uid:"initial_subscriber",accessModel:"merchant_trial_v1",
    subscriptionStatus:"trial",initialActivationPaid:false,
    firstMerchantLinkedAt:day(-2)
  };
  for(const v of [
    {subscriber:base},
    {subscriber:{...base,firstMerchantLinkedAt:day(-3),initialActivationPaid:true}},
    {subscriber:{...base,firstMerchantLinkedAt:null}},
    {subscriber:{...base,firstMerchantLinkedAt:day(-4)},hasUnreviewedFirstPayment:true},
    {subscriber:{...base,firstMerchantLinkedAt:day(1)}},
  ]) {
    const result=assessPlatformMerchantRecovery(fixture({
      reason:MERCHANT_RECOVERY_REASON.UNPAID_FIRST_MONTH,...v
    }));
    assert.equal(result.eligibleForRecovery,false);
  }
});

test("a missing first merchant link cannot be manufactured from expired seven-day registration",()=>{
  const subscriber={
    uid:"initial_subscriber",accessModel:"merchant_trial_v1",
    subscriptionStatus:"trial",initialActivationPaid:false,
    createdAt:day(-8),firstMerchantLinkedAt:null
  };
  const result=assessPlatformMerchantRecovery(fixture({
    reason:MERCHANT_RECOVERY_REASON.UNPAID_FIRST_MONTH,subscriber
  }));
  assert.equal(result.eligibleForRecovery,false);
});
