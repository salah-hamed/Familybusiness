import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {merchantCycleId,nextMerchantCycle,buildRepeatMerchantRecovery,buildRepeatMerchantAssignment} from "../core/merchants/merchant-assignment-cycle.js";
import {MERCHANT_REPEAT_RECOVERY_ENABLED,MERCHANT_REPEAT_ASSIGNMENT_ENABLED} from "../core/merchants/merchant-cycle-rollout.js";
import {resolveCommissionBeneficiary,PLATFORM_COMMISSION_BENEFICIARY} from "../core/merchants/merchant-commission-beneficiary.js";

const when=new Date("2026-10-13T20:00:00Z");
const projectId="original_supermarket";
const merchantId="m_"+"c".repeat(32);
const agreement={ownerId:"original",currentAmount:6,acceptedVersion:1,status:"accepted",currency:"EGP"};
const operator={authUid:"operator",status:"active",isActive:true,agreementStatus:"accepted"};
function first(){
 const project={
  ownerId:"original",originalSubscriberId:"original",
  merchantId,projectId:"supermarket",template:"supermarket",
  operatingModel:"partner_operated",operatorId:projectId,
  isActive:true,status:"active",platformManaged:true,
  assignmentStatus:"assigned_to_new_subscriber",assignedSubscriberId:"subscriber1",
  recoveryAuditId:projectId,recoveryAt:when,recoveryAdminUid:"admin",
  cutoverAuditId:projectId,cutoverAt:when,cutoverAdminUid:"admin"
 };
 const priorAssignmentAudit={status:"completed",projectDocId:projectId,
  merchantId,assignedSubscriberId:"subscriber1"};
 const subscriber={uid:"subscriber1",initialActivationPaid:true,
  subscriptionExpiresAt:new Date("2026-10-12T10:00:00Z")};
 return {project,priorAssignmentAudit,subscriber};
}
function recover(input=first(),updates={}){
 return buildRepeatMerchantRecovery({
  projectId,adminUid:"admin",...input,operator,agreement,
  reason:"overdue_renewal",pendingPayment:false,now:when,...updates
 });
}
function caseFor(cycleId,uid){
 return {cycleId,projectDocId:projectId,merchantId,
  previousSubscriberId:"",proposedSubscriberId:uid,
  status:"awaiting_consents",operatorConsent:"accepted",
  recipientConsent:"accepted",operatorConsentedAt:when,recipientConsentedAt:when,
  financeClearance:"reviewed",financeReviewedBy:"admin",financeReviewedAt:when,
  commissionAmount:6,commissionVersion:1,commissionCurrency:"EGP"};
}
function financeFor(id,uid){
 return {cycleId:id,projectDocId:projectId,formerSubscriberId:uid,adminUid:"admin",
  reviewedAt:when,currency:"EGP",formerSubscriberEarnedAmount:120,
  formerSubscriberOutstandingAmount:30,platformEarnedAmount:40,
  platformOutstandingAmount:35};
}
function assign(project,recoveryAudit,uid){
 const id=merchantCycleId(projectId,project.assignmentCycle);
 return buildRepeatMerchantAssignment({
  projectId,adminUid:"admin",project,recoveryAudit,
  transferCase:caseFor(id,uid),financeReview:financeFor(id,recoveryAudit.previousSubscriberId),
  operator,agreement,recipient:{uid,isActive:true,subscriptionStatus:"active",
    subscriptionExpiresAt:new Date("2026-11-15T00:00:00Z")},now:when
 });
}
test("C4B12 gates are OFF even if the service is accidentally called",()=>{
 assert.equal(MERCHANT_REPEAT_RECOVERY_ENABLED,true);
 assert.equal(MERCHANT_REPEAT_ASSIGNMENT_ENABLED,true);
 const s=readFileSync("core/merchants/merchant-cycle-service.js","utf8");
 assert.match(s,/MERCHANT_REPEAT_RECOVERY_DISABLED/);
 assert.match(s,/MERCHANT_REPEAT_ASSIGNMENT_DISABLED/);
 assert.ok(s.includes("assertTrustedRecoveryBillingGuard(billingSnap.data(),previousUid)"));
 for(const bad of ["collection(db,\"commissionLedger\")","collection(db,\"orders\")",
   "transaction.delete","tx.delete"]){assert.equal(s.includes(bad),false,bad);}
});
test("C4B12 first repeat recovery never overwrites original project identity or C4B11 witnesses",()=>{
 const {project,priorAssignmentAudit,subscriber}=first();
 const before=JSON.stringify(project);
 const r=recover({project,priorAssignmentAudit,subscriber});
 assert.equal(r.cycle,2);
 assert.equal(r.cycleId,projectId+"_2");
 assert.equal(r.projectPatch.assignedSubscriberId,"");
 assert.equal(r.projectPatch.assignmentStatus,"platform_managed");
 assert.equal(r.recoveryAudit.previousSubscriberId,"subscriber1");
 assert.equal(r.historicAccess.subscriberUid,"subscriber1");
 for(const field of ["ownerId","originalSubscriberId","merchantId",
  "operatorId","status","isActive","cutoverAuditId","cutoverAt"]){
  assert.equal(field in r.projectPatch,false,field);
 }
 assert.equal(JSON.stringify(project),before);
});
test("C4B12 rejects unpaid claims, pending payments, unchanged subscriptions or audit forgery",()=>{
 const src=first();
 for(const change of [
  {pendingPayment:true},
  {pendingPayment:null},
  {subscriber:{...src.subscriber,subscriptionExpiresAt:new Date("2026-12-01")}},
  {subscriber:{...src.subscriber,initialActivationPaid:false}},
  {priorAssignmentAudit:{...src.priorAssignmentAudit,assignedSubscriberId:"forged"}},
  {project:{...src.project,merchantId:"forged"}},
  {project:{...src.project,cutoverAuditId:"stale"}},
  {project:{...src.project,ownerId:"subscriber1"}},
  {project:{...src.project,platformManaged:false}},
  {operator:{...operator,isActive:false}},
  {reason:"subscriber_requested"}]){
  assert.throws(()=>recover(src,change),undefined,JSON.stringify(change));
 }
});
test("C4B12 sequential repeat cycles keep each recipient's rights and do not reuse their UID",()=>{
 const orig=first();
 const r2=recover(orig);
 const p2={...orig.project,...r2.projectPatch};
 assert.equal(resolveCommissionBeneficiary(p2,agreement),PLATFORM_COMMISSION_BENEFICIARY);
 const a2=assign(p2,r2.recoveryAudit,"subscriber2");
 assert.equal(a2.assignmentAudit.previousSubscriberId,"subscriber1");
 assert.equal(a2.assignmentAudit.assignedSubscriberId,"subscriber2");
 assert.equal(a2.assignmentAudit.cycleId,projectId+"_2");
 const assigned2={...p2,...a2.projectPatch};
 assert.equal(resolveCommissionBeneficiary(assigned2,agreement),"subscriber2");
 const sub2={uid:"subscriber2",initialActivationPaid:true,
  subscriptionExpiresAt:new Date("2026-10-10")};
 const r3=recover({project:assigned2,priorAssignmentAudit:a2.assignmentAudit,subscriber:sub2});
 assert.equal(r3.cycle,3);
 assert.equal(r3.recoveryAudit.previousAssignmentAuditId,projectId+"_2");
 assert.equal(r3.historicAccess.subscriberUid,"subscriber2");
 const p3={...assigned2,...r3.projectPatch};
 const a3=assign(p3,r3.recoveryAudit,"subscriber3");
 assert.equal(a3.assignmentAudit.assignedSubscriberId,"subscriber3");
 assert.equal(resolveCommissionBeneficiary({...p3,...a3.projectPatch},agreement),"subscriber3");
 assert.throws(()=>buildRepeatMerchantAssignment({
  projectId,adminUid:"admin",project:p3,recoveryAudit:r3.recoveryAudit,
  transferCase:caseFor(projectId+"_3","subscriber2"),
  financeReview:financeFor(projectId+"_3","subscriber2"),operator,agreement,
  recipient:{uid:"subscriber2",isActive:true,subscriptionStatus:"active"},
  priorRecipientHistoricGrant:r3.historicAccess,now:when
 }),/FORBIDDEN/);
});
test("C4B12 no consent by old subscriber: fresh operator and recipient approvals required",()=>{
 const r=recover();
 const project={...first().project,...r.projectPatch},id=r.cycleId;
 const mutation=assign(project,r.recoveryAudit,"subscriber2");
 assert.equal(mutation.projectPatch.assignmentStatus,"assigned_to_new_subscriber");
 assert.equal(mutation.projectPatch.cutoverAuditId,id);
 for(const caseChange of [
  {recipientConsent:"pending"},{operatorConsent:"declined"},
  {commissionAmount:12},{financeClearance:"pending"},{financeReviewedAt:new Date("2026-10-11")}
 ]){
  assert.throws(()=>buildRepeatMerchantAssignment({
   projectId,adminUid:"admin",project,recoveryAudit:r.recoveryAudit,
   transferCase:{...caseFor(id,"subscriber2"),...caseChange},
   financeReview:financeFor(id,"subscriber1"),operator,agreement,
   recipient:{uid:"subscriber2",isActive:true,subscriptionStatus:"active"},
   now:when
  }),/PREREQUISITES/);
 }
});
test("C4B12 invalid and overflowing IDs fail closed",()=>{
 for(const cycle of [0,1,10000,2.4,-3]) assert.throws(()=>merchantCycleId(projectId,cycle));
 assert.equal(nextMerchantCycle(first().project),2);
 assert.throws(()=>nextMerchantCycle({assignmentCycle:9999}));
 assert.throws(()=>merchantCycleId("../path",2));
});
