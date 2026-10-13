import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMerchantTransferFinanceReview } from "../core/merchants/transfer-finance-review.js";

function sample(overrides={}) {
  const pid="old_supermarket";
  return {
    projectId:pid,adminUid:"admin",
    project:{ownerId:"old",originalSubscriberId:"old",merchantId:"m_"+"a".repeat(32),
      assignedSubscriberId:"",platformManaged:true,assignmentStatus:"platform_managed",recoveryAuditId:pid},
    transferCase:{projectDocId:pid,merchantId:"m_"+"a".repeat(32),
      originalSubscriberId:"old",previousSubscriberId:"",status:"awaiting_consents",
      financeClearance:"pending",operatorConsent:"accepted",recipientConsent:"accepted",
      operatorConsentedAt:new Date(),recipientConsentedAt:new Date(),
      commissionAmount:6,commissionVersion:2,commissionCurrency:"EGP"},
    agreement:{status:"accepted",acceptedVersion:2,currentAmount:6,currency:"EGP"},
    platformSummary:{earnedAmount:125,paidAmount:25,outstandingAmount:100},
    historicalSummary:{earnedAmount:250,paidAmount:200,outstandingAmount:50},
    ...overrides
  };
}

test("review tracks both old and platform outstanding dues without treating either as paid",()=>{
  const inputs=sample();const before=JSON.stringify(inputs);
  const review=buildMerchantTransferFinanceReview(inputs);
  assert.equal(review.financeClearance,"reviewed");
  assert.equal(review.financeReviewedBy,"admin");
  assert.deepEqual(review.financeSnapshot,{
    currency:"EGP",formerSubscriberId:"old",
    platformOutstandingAmount:100,formerSubscriberOutstandingAmount:50,
    platformEarnedAmount:125,formerSubscriberEarnedAmount:250
  });
  assert.equal(JSON.stringify(inputs),before);
});

test("finance review refuses cases without both explicit recipient/operator consents",()=>{
  const base=sample();
  for(const overrides of [
    {transferCase:{...base.transferCase,operatorConsent:"pending"}},
    {transferCase:{...base.transferCase,recipientConsent:"declined"}},
    {transferCase:{...base.transferCase,financeClearance:"reviewed"}},
    {transferCase:{...base.transferCase,commissionAmount:60}},
    {project:{...base.project,assignedSubscriberId:"old"}},
    {historicalSummary:null},
    {platformSummary:{earnedAmount:10,paidAmount:1,outstandingAmount:-1}}
  ]) assert.throws(()=>buildMerchantTransferFinanceReview(sample(overrides)));
});

test("admin review is gated and cannot create or confirm settlements",()=>{
  const service=readFileSync("core/merchants/transfer-case-service.js","utf8");
  const from=service.indexOf("export async function reviewMerchantTransferFinance");
  const snippet=service.slice(from);
  assert.ok(from>0);
  assert.match(snippet,/MERCHANT_TRANSFER_CASES_DISABLED/);
  assert.match(snippet,/buildMerchantTransferFinanceReview/);
  assert.match(snippet,/financeReviewedAt:reviewedAt/);
  assert.match(snippet,/tx.set\(reviewRef,/);
  assert.match(snippet,/const \{financeSnapshot,\.\.\.publicReview\}=payload/);
  assert.doesNotMatch(snippet,/commissionSettlements|transaction.delete|transaction.set\(doc\(db,"commissionLedger"/);
});

test("server rules restrict financial review to admin and preserve accounting",()=>{
  const rules=readFileSync("firestore.rules","utf8");
  const section=rules.slice(rules.indexOf('match /merchantTransferCases/{projectId}'));
  assert.match(section,/request.resource.data.financeClearance == "reviewed"/);
  assert.match(section,/resource.data.operatorConsent == "accepted"/);
  assert.match(section,/resource.data.recipientConsent == "accepted"/);
  assert.match(section,/request.resource.data.financeReviewedBy == request.auth.uid/);
  assert.match(section,/request.resource.data.diff\(resource.data\).affectedKeys\(\).hasOnly\(\[/);
});

test("finance numbers live ONLY in admin-private review docs, never in operator/recipient consent case",()=>{
  const source=readFileSync("core/merchants/transfer-case-service.js","utf8");
  const section=source.slice(source.indexOf("export async function reviewMerchantTransferFinance"));
  assert.match(section,/merchantTransferFinanceReviews/);
  assert.match(section,/tx.update\(caseRef,\{\.\.\.publicReview,financeReviewedAt:reviewedAt\}\)/);
  const rules=readFileSync("firestore.rules","utf8");
  const start=rules.indexOf("match /merchantTransferFinanceReviews/{projectId}");
  assert.ok(start>0);
  const block=rules.slice(start,rules.indexOf("match /{document=**}",start));
  assert.match(block,/allow get, list: if isAdmin\(\)/);
  assert.match(block,/allow update, delete: if false/);
  assert.match(rules,/existsAfter\(merchantTransferFinanceReviewPath\(projectId\)\)/);
});
