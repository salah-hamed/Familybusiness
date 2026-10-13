import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessMerchantCutoverReadiness,formatMerchantCutoverReadiness
} from "../core/merchants/merchant-cutover-readiness.js";

const at=new Date("2026-10-13T16:00:00.000Z");
const projectId="old_supermarket";
const merchantId="m_"+"a".repeat(32);
function ready(overrides={}) {
  const project={ownerId:"old",originalSubscriberId:"old",assignedSubscriberId:"",
    projectId:"supermarket",template:"supermarket",operatingModel:"partner_operated",
    merchantId,operatorId:projectId,assignmentStatus:"platform_managed",platformManaged:true,
    recoveryAuditId:projectId,recoveryAt:at,recoveryAdminUid:"admin"};
  const transferCase={projectDocId:projectId,merchantId,originalSubscriberId:"old",
    previousSubscriberId:"",proposedSubscriberId:"new",status:"awaiting_consents",
    recipientConsent:"accepted",operatorConsent:"accepted",recipientConsentedAt:at,
    operatorConsentedAt:at,financeClearance:"reviewed",financeReviewedAt:at,
    financeReviewedBy:"admin",commissionAmount:6.5,commissionVersion:2,commissionCurrency:"EGP"};
  const recoveryAudit={status:"completed",projectDocId,merchantId,
    originalSubscriberId:"old",previousSubscriberId:"old",recoveredAt:at};
  return {
    projectId,project,transferCase,recoveryAudit,
    operator:{authUid:"operator",status:"active",isActive:true,agreementStatus:"accepted"},
    agreement:{status:"accepted",acceptedVersion:2,currentAmount:6.5,currency:"EGP"},
    recipient:{uid:"new",isActive:true,subscriptionStatus:"active",
      subscriptionExpiresAt:new Date("2026-11-13T00:00:00Z")},
    recipientUid:"new",platformSummary:{earnedAmount:300,paidAmount:50,outstandingAmount:250},
    historicalSummary:{earnedAmount:200,paidAmount:100,outstandingAmount:100},now:at,
    ...overrides
  };
}

test("fully reviewed proposal still cannot execute cutover without atomic service and production Rules",()=>{
  const sample=ready();
  const before=JSON.stringify(sample);
  const report=assessMerchantCutoverReadiness(sample);
  assert.equal(report.prerequisitesMet,true);
  assert.equal(report.canExecuteCutoverNow,false);
  assert.equal(report.oldSubscriberApprovalRequired,false);
  assert.equal(report.checks.length,8);
  assert.equal(JSON.stringify(sample),before);
  assert.match(formatMerchantCutoverReadiness(report),/الاسترداد موثق/);
});

test("missing consent, changed rate, expired subscriber or missing finance review block readiness",()=>{
  const base=ready();
  for(const overrides of [
    {transferCase:{...base.transferCase,operatorConsent:"pending"}},
    {transferCase:{...base.transferCase,recipientConsent:"declined"}},
    {transferCase:{...base.transferCase,commissionAmount:20}},
    {transferCase:{...base.transferCase,commissionVersion:3}},
    {transferCase:{...base.transferCase,financeClearance:"pending"}},
    {recipient:{...base.recipient,subscriptionExpiresAt:new Date("2026-09-01")}},
    {recipient:{...base.recipient,isActive:false}},
    {operator:{...base.operator,status:"inactive"}},
    {recoveryAudit:{...base.recoveryAudit,status:"pending"}},
    {project:{...base.project,assignedSubscriberId:"old"}},
    {historicalSummary:null}
  ]) {
    const report=assessMerchantCutoverReadiness(ready(overrides));
    assert.equal(report.prerequisitesMet,false,JSON.stringify(overrides));
    assert.equal(report.canExecuteCutoverNow,false);
  }
});

test("admin review is read-only and old subscriber has no approval button",()=>{
  const s=readFileSync("admin/admin.js","utf8");
  const start=s.indexOf('if (button.dataset.action === "check-final-cutover")');
  const end=s.indexOf('if (button.dataset.action === "show-platform-recovery-dues")',start);
  const handler=s.slice(start,end);
  assert.ok(handler.length>1000);
  assert.match(handler,/getProjectPaymentSummary\(projectId, \{ ownerId: project.originalSubscriberId \|\| project.ownerId \}\)/);
  assert.match(handler,/formatMerchantCutoverReadiness/);
  for(const unsafe of ["updateDoc(","setDoc(","deleteDoc(","runTransaction(","ownerConsent","oldSubscriberApproval"]) {
    assert.equal(handler.includes(unsafe),false,unsafe);
  }
});
