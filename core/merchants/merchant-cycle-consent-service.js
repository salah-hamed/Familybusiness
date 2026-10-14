import db from "../firebase/firebase-db.js";
import { merchantCycleId } from "./merchant-assignment-cycle.js";
import { buildRepeatMerchantTransferCase } from "./merchant-cycle-service.js";
import { transferTermsMatchAgreement } from "./transfer-financial-terms.js";
import { getProjectPaymentSummary } from "../commissions/settlement-service.js";
import { MERCHANT_REPEAT_ASSIGNMENT_ENABLED } from "./merchant-cycle-rollout.js";
import { doc,getDoc,runTransaction,serverTimestamp,updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const validId=id=>{if(!ID.test(String(id||"")))throw new Error("MERCHANT_TRANSFER_IDENTIFIER_INVALID");return id;};

export async function openRepeatMerchantTransferCase({projectId,candidateUid,adminUid,reason}={}){
 if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)throw new Error("MERCHANT_REPEAT_ASSIGNMENT_DISABLED");
 validId(projectId);validId(candidateUid);validId(adminUid);
 return runTransaction(db,async tx=>{
  const projectRef=doc(db,"projects",projectId);
  const projectSnap=await tx.get(projectRef);
  if(!projectSnap.exists())throw new Error("MERCHANT_TRANSFER_PROJECT_MISSING");
  const project=projectSnap.data(),cycleId=merchantCycleId(projectId,project.assignmentCycle);
  const caseRef=doc(db,"merchantTransferCycles",cycleId);
  const auditRef=doc(db,"merchantRecoveryCycles",cycleId);
  const recipientRef=doc(db,"users",candidateUid);
  const historyRef=doc(db,"merchantHistoricalAccess",projectId+"_"+candidateUid);
  const operatorRef=doc(db,"operators",projectId);
  const agreementRef=doc(db,"commissionAgreements",projectId);
  const [oldCase,audit,recipient,history,operator,agreement]=await Promise.all([
   tx.get(caseRef),tx.get(auditRef),tx.get(recipientRef),tx.get(historyRef),
   tx.get(operatorRef),tx.get(agreementRef)
  ]);
  if(oldCase.exists()||history.exists())throw new Error("MERCHANT_TRANSFER_ALREADY_OPEN_OR_FORMER");
  if([audit,recipient,operator,agreement].some(s=>!s.exists()))
   throw new Error("MERCHANT_TRANSFER_REQUIRED_RECORDS_MISSING");
  const payload=buildRepeatMerchantTransferCase({
   projectId,project,operator:operator.data(),agreement:agreement.data(),
   candidate:{...recipient.data(),uid:candidateUid},candidateUid,adminUid,reason
  });
  if(audit.data().status!=="completed"||audit.data().cycleId!==cycleId)
   throw new Error("MERCHANT_TRANSFER_RECOVERY_AUDIT_REQUIRED");
  tx.set(caseRef,{...payload,createdAt:serverTimestamp()});
  return {projectId,cycleId,candidateUid};
 });
}

export async function submitRepeatMerchantConsent({projectId,cycle,role,decision}={}){
 if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)throw new Error("MERCHANT_REPEAT_ASSIGNMENT_DISABLED");
 validId(projectId);
 if(!["accepted","declined"].includes(decision))throw new Error("MERCHANT_CONSENT_INVALID_DECISION");
 const cid=merchantCycleId(projectId,cycle);
 const patch=role==="operator"
   ?{operatorConsent:decision,operatorConsentedAt:serverTimestamp()}
   :role==="recipient"
    ?{recipientConsent:decision,recipientConsentedAt:serverTimestamp()}
    :null;
 if(!patch)throw new Error("MERCHANT_CONSENT_INVALID_ROLE");
 await updateDoc(doc(db,"merchantTransferCycles",cid),patch);
 return cid;
}

/**
 * Financial review is NOT a payment action. Totals are retained in the
 * private document; operator / recipient consent record never leaks balances.
 */
export async function reviewRepeatMerchantFinances({projectId,adminUid}={}){
 if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)throw new Error("MERCHANT_REPEAT_ASSIGNMENT_DISABLED");
 validId(projectId);validId(adminUid);
 const projectSnap=await getDoc(doc(db,"projects",projectId));
 if(!projectSnap.exists())throw new Error("MERCHANT_TRANSFER_PROJECT_MISSING");
 const cycleId=merchantCycleId(projectId,projectSnap.data().assignmentCycle);
 const recoverySnap=await getDoc(doc(db,"merchantRecoveryCycles",cycleId));
 if(!recoverySnap.exists())throw new Error("MERCHANT_TRANSFER_RECOVERY_AUDIT_REQUIRED");
 const oldUid=validId(recoverySnap.data().previousSubscriberId);
 const [current,former]=await Promise.all([
  getProjectPaymentSummary(projectId),
  getProjectPaymentSummary(projectId,{ownerId:oldUid})
 ]);
 for(const summary of [current,former]){
  if(!summary||!["earnedAmount","outstandingAmount"].every(k=>
    Number.isFinite(summary[k])&&summary[k]>=0))
   throw new Error("MERCHANT_TRANSFER_FINANCE_UNAVAILABLE");
 }
 return runTransaction(db,async tx=>{
  const projectRef=doc(db,"projects",projectId);
  const caseRef=doc(db,"merchantTransferCycles",cycleId);
  const agreementRef=doc(db,"commissionAgreements",projectId);
  const reviewRef=doc(db,"merchantTransferCycleFinanceReviews",cycleId);
  const [project,consent,agreement,review]=await Promise.all([
   tx.get(projectRef),tx.get(caseRef),tx.get(agreementRef),tx.get(reviewRef)
  ]);
  if(review.exists())throw new Error("MERCHANT_TRANSFER_ALREADY_REVIEWED");
  const c=consent.exists()?consent.data():null;
  if(!project.exists()||project.data().recoveryAuditId!==cycleId
    ||project.data().assignmentStatus!=="platform_managed"
    ||!c||c.cycleId!==cycleId||c.status!=="awaiting_consents"
    ||c.operatorConsent!=="accepted"||c.recipientConsent!=="accepted"
    ||c.financeClearance!=="pending"||!agreement.exists()
    ||!transferTermsMatchAgreement(c,agreement.data()))
   throw new Error("MERCHANT_TRANSFER_CONSENT_OR_TERMS_CHANGED");
  const reviewedAt=serverTimestamp();
  tx.set(reviewRef,{
   cycleId,projectDocId:projectId,adminUid,reviewedAt,currency:"EGP",
   formerSubscriberId:oldUid,formerSubscriberEarnedAmount:former.earnedAmount,
   formerSubscriberOutstandingAmount:former.outstandingAmount,
   platformEarnedAmount:current.earnedAmount,
   platformOutstandingAmount:current.outstandingAmount
  });
  tx.update(caseRef,{
   financeClearance:"reviewed",financeReviewedAt:reviewedAt,
   financeReviewedBy:adminUid
  });
  return cycleId;
 });
}
