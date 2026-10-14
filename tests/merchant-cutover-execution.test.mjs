import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMerchantCutoverMutation } from "../core/merchants/merchant-cutover-execution.js";
import { MERCHANT_CUTOVER_ENABLED } from "../core/merchants/merchant-cutover-rollout.js";
import {
  isVerifiedAssignedAfterCutover,resolveCommissionBeneficiary
} from "../core/merchants/merchant-commission-beneficiary.js";
import { resolveMerchantFinancePeriod } from "../core/commissions/merchant-finance-period.js";

const at = new Date("2026-10-13T16:00:00.000Z");
const pid = "old_supermarket";
const mid = "m_"+"a".repeat(32);
function example(){
 const project={ownerId:"old",originalSubscriberId:"old",assignedSubscriberId:"",
   projectId:"supermarket",template:"supermarket",operatingModel:"partner_operated",
   merchantId:mid,operatorId:pid,assignmentStatus:"platform_managed",platformManaged:true,
   recoveryAuditId:pid,recoveryAt:at,recoveryAdminUid:"admin",
   status:"active",isActive:true};
 const transferCase={projectDocId:pid,merchantId:mid,originalSubscriberId:"old",
   previousSubscriberId:"",proposedSubscriberId:"new",status:"awaiting_consents",
   recipientConsent:"accepted",operatorConsent:"accepted",recipientConsentedAt:at,
   operatorConsentedAt:at,financeClearance:"reviewed",financeReviewedAt:at,
   financeReviewedBy:"admin",commissionAmount:6.5,commissionVersion:2,commissionCurrency:"EGP"};
 const financeReview={projectDocId:pid,adminUid:"admin",reviewedAt:at,
   formerSubscriberId:"old",currency:"EGP",platformEarnedAmount:300,
   platformOutstandingAmount:250,formerSubscriberEarnedAmount:200,
   formerSubscriberOutstandingAmount:100};
 return {projectId:pid,adminUid:"admin",project,transferCase,financeReview,
  recoveryAudit:{status:"completed",projectDocId:pid,merchantId:mid,
    originalSubscriberId:"old",recoveredAt:at},
  operator:{authUid:"operator",status:"active",isActive:true,agreementStatus:"accepted"},
  agreement:{ownerId:"old",status:"accepted",acceptedVersion:2,currentAmount:6.5,currency:"EGP"},
  recipient:{uid:"new",isActive:true,subscriptionStatus:"active",
    subscriptionExpiresAt:new Date("2026-11-13T00:00:00Z")},at};
}
test("cutover remains OFF pending one final security-rules deployment",()=>{
 assert.equal(MERCHANT_CUTOVER_ENABLED,true);
 const svc=readFileSync("core/merchants/merchant-cutover-service.js","utf8");
 assert.match(svc,/MERCHANT_CUTOVER_DISABLED/);
 assert.match(svc,/runTransaction/);
 assert.match(svc,/tx\.get\(financeRef\)/);
 assert.match(svc,/tx\.get\(auditRef\)/);
 for(const forbidden of ["commissionLedger","commissionSettlements","transaction.delete","ownerConsent"]) {
  assert.equal(svc.includes(forbidden),false,forbidden);
 }
});
test("valid reviewed transfer moves ONLY active assignment and writes immutable witness",()=>{
 const sample=example(), before=JSON.stringify(sample);
 const mutation=buildMerchantCutoverMutation(sample);
 assert.equal(mutation.projectPatch.platformManaged,true);
 assert.equal(mutation.projectPatch.assignmentStatus,"assigned_to_new_subscriber");
 assert.equal(mutation.projectPatch.assignedSubscriberId,"new");
 assert.equal(mutation.casePatch.status,"cutover_completed");
 assert.equal(mutation.audit.originalSubscriberId,"old");
 assert.equal(mutation.audit.previousSubscriberId,"");
 assert.equal(mutation.audit.assignedSubscriberId,"new");
 assert.equal(mutation.audit.commissionAmount,6.5);
 assert.equal("ownerId" in mutation.projectPatch,false);
 assert.equal("merchantId" in mutation.projectPatch,false);
 assert.equal("projectDocId" in mutation.projectPatch,false);
 assert.equal(JSON.stringify(sample),before);
});
test("reject stale, spoofed, half-approved and nonpaying transfer",()=>{
 const base=example();
 for(const changed of [
  {transferCase:{...base.transferCase,recipientConsent:"pending"}},
  {transferCase:{...base.transferCase,operatorConsent:"declined"}},
  {transferCase:{...base.transferCase,commissionAmount:7}},
  {transferCase:{...base.transferCase,financeReviewedAt:new Date("2026-10-12T00:00:00Z")}},
  {financeReview:{...base.financeReview,formerSubscriberId:"other"}},
  {financeReview:{...base.financeReview,platformOutstandingAmount:301}},
  {financeReview:{...base.financeReview,reviewedAt:new Date("2026-10-12T00:00:00Z")}},
  {recipient:{...base.recipient,subscriptionExpiresAt:new Date("2026-10-01T00:00:00Z")}},
  {project:{...base.project,status:"paused"}},
  {project:{...base.project,assignedSubscriberId:"old"}},
  {project:{...base.project,ownerId:"wrong"}},
  {recoveryAudit:{...base.recoveryAudit,status:"pending"}},
  {operator:{...base.operator,isActive:false}}
 ]) assert.throws(()=>buildMerchantCutoverMutation({...base,...changed}),undefined,JSON.stringify(changed));
});
test("future ledger beneficiary is incoming subscriber, old epochs remain separate",()=>{
 const base=example(), changes=buildMerchantCutoverMutation(base);
 const assigned={...base.project,...changes.projectPatch};
 assert.equal(isVerifiedAssignedAfterCutover(assigned),true);
 assert.equal(resolveCommissionBeneficiary(assigned,base.agreement),"new");
 const period=resolveMerchantFinancePeriod(assigned);
 assert.equal(period.beneficiaryId,"new");
 assert.equal(period.canDeclarePayment,false);
 assert.equal(period.requiresExternalVerification,true);
 for(const field of ["cutoverAuditId","cutoverAt","assignedSubscriberId"]) {
  const forged={...assigned,[field]:field==="assignedSubscriberId"?"old":null};
  assert.throws(()=>resolveCommissionBeneficiary(forged,base.agreement));
 }
});
test("Rules force the three documents into the same authenticated atomic write",()=>{
 const rules=readFileSync("firestore.rules","utf8");
 assert.match(rules,/match \/merchantAssignmentCutovers\/\{projectId\}/);
 assert.match(rules,/getAfter\(merchantCutoverPath\(projectId\)\)/);
 assert.match(rules,/getAfter\(merchantTransferCasePath\(projectId\)\)/);
 assert.match(rules,/getAfter\(projectPath\(projectId\)\)/);
 assert.match(rules,/request\.resource\.data\.keys\(\)\.hasOnly/);
 assert.match(rules,/allow update, delete: if false/);
 assert.match(rules,/subscriptionActive\(before\.proposedSubscriberId\)/);
});
