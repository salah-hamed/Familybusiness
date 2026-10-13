import db from "../firebase/firebase-db.js";
import { buildRepeatMerchantRecovery,buildRepeatMerchantAssignment,merchantCycleId,nextMerchantCycle } from "./merchant-assignment-cycle.js";
import { MERCHANT_REPEAT_RECOVERY_ENABLED,MERCHANT_REPEAT_ASSIGNMENT_ENABLED } from "./merchant-cycle-rollout.js";
import { MERCHANT_RECOVERY_REASON } from "./merchant-recovery-policy.js";
import { assessMerchantTransfer } from "./merchant-transfer-preflight.js";
import { snapshotMerchantTransferTerms } from "./transfer-financial-terms.js";
import {
  doc,collection,getDocs,query,where,limit,runTransaction,serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const REASONS=new Set(Object.values(MERCHANT_RECOVERY_REASON));
const requiredId=(value)=>{if(!ID.test(String(value||"")))throw new Error("MERCHANT_CYCLE_ID_INVALID");return value;};

/**
 * Executes only after feature gating AND Rules approval. Never writes any
 * historical period or current operator/customer assets.
 *
 * IMPORTANT: a pre-transaction pending-payment query can race an incoming
 * payment. Before enabling this flag, a trusted billing lock/version MUST
 * be checked atomically and enforced by Rules. No caller can bypass OFF.
 */
export async function executeRepeatMerchantRecovery({projectId,adminUid,reason}={}){
  if(!MERCHANT_REPEAT_RECOVERY_ENABLED)throw new Error("MERCHANT_REPEAT_RECOVERY_DISABLED");
  requiredId(projectId);requiredId(adminUid);
  if(!REASONS.has(reason))throw new Error("MERCHANT_REPEAT_RECOVERY_INVALID_REASON");
  // This guard remains deliberately fail closed even if the rollout flag is
  // changed accidentally without the trusted billing confirmation release.
  throw new Error("MERCHANT_REPEAT_RECOVERY_TRUSTED_BILLING_GATE_REQUIRED");
}

/**
 * Build a new immutable consent case for each cycle. Not reusing the C4B11
 * merchantTransferCases/{projectId} document is essential to audit integrity.
 */
export function buildRepeatMerchantTransferCase({
  projectId,project,operator,agreement,candidate,candidateUid,adminUid,reason
}={}){
  requiredId(projectId);requiredId(adminUid);requiredId(candidateUid);
  const cycle=project?.assignmentCycle;
  const cycleId=merchantCycleId(projectId,cycle);
  if(project?.platformManaged!==true || project?.assignmentStatus!=="platform_managed"
     || project.assignedSubscriberId!=="" || project.recoveryAuditId!==cycleId)
    throw new Error("MERCHANT_REPEAT_TRANSFER_NOT_RECOVERED");
  const inspected=assessMerchantTransfer({
    projectDocId:projectId,project,operator,agreement,candidate,candidateUid
  });
  if(!inspected.canOpenCase)throw new Error("MERCHANT_REPEAT_TRANSFER_NOT_ELIGIBLE");
  if(typeof reason!=="string"||reason.trim().length<15||reason.length>300)
    throw new Error("MERCHANT_REPEAT_TRANSFER_REASON_REQUIRED");
  return {
    cycle,cycleId,projectDocId:projectId,merchantId:project.merchantId,
    originalSubscriberId:project.originalSubscriberId,
    previousSubscriberId:"",proposedSubscriberId:candidateUid,
    status:"awaiting_consents",
    operatorConsent:"pending",recipientConsent:"pending",
    operatorConsentedAt:null,recipientConsentedAt:null,
    ...snapshotMerchantTransferTerms(agreement),
    financeClearance:"pending",cutoverAt:null,
    reason:reason.trim(),createdBy:adminUid,createdAt:null
  };
}

/**
 * Atomic second-or-later transfer. No original audits overwritten.
 * The immutable historical grant for a past recipient MUST be absent
 * to prevent a returning UID's ledger from mixing multiple cycles.
 */
export async function executeRepeatMerchantAssignment({projectId,adminUid}={}){
  if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)
    throw new Error("MERCHANT_REPEAT_ASSIGNMENT_DISABLED");
  requiredId(projectId);requiredId(adminUid);
  const projectRef=doc(db,"projects",projectId);
  return runTransaction(db,async tx=>{
    const projectSnap=await tx.get(projectRef);
    if(!projectSnap.exists())throw new Error("MERCHANT_REPEAT_PROJECT_MISSING");
    const project=projectSnap.data();
    const cycle=project.assignmentCycle,cycleId=merchantCycleId(projectId,cycle);
    const caseRef=doc(db,"merchantTransferCycles",cycleId);
    const recoveryRef=doc(db,"merchantRecoveryCycles",cycleId);
    const financeRef=doc(db,"merchantTransferCycleFinanceReviews",cycleId);
    const witnessRef=doc(db,"merchantAssignmentCycles",cycleId);
    const operatorRef=doc(db,"operators",projectId);
    const agreementRef=doc(db,"commissionAgreements",projectId);
    const [caseSnap,recoverySnap,financeSnap,witnessSnap,operatorSnap,agreementSnap]=await Promise.all([
      tx.get(caseRef),tx.get(recoveryRef),tx.get(financeRef),tx.get(witnessRef),
      tx.get(operatorRef),tx.get(agreementRef)
    ]);
    if(witnessSnap.exists())throw new Error("MERCHANT_REPEAT_CYCLE_ALREADY_ASSIGNED");
    if([caseSnap,recoverySnap,financeSnap,operatorSnap,agreementSnap].some(s=>!s.exists()))
      throw new Error("MERCHANT_REPEAT_ASSIGNMENT_RECORD_MISSING");
    const recipientUid=requiredId(caseSnap.data().proposedSubscriberId);
    const grantRef=doc(db,"merchantHistoricalAccess",`${projectId}_${recipientUid}`);
    const [recipientSnap,formerGrantSnap]=await Promise.all([
      tx.get(doc(db,"users",recipientUid)),tx.get(grantRef)
    ]);
    if(!recipientSnap.exists())throw new Error("MERCHANT_REPEAT_RECIPIENT_NOT_FOUND");
    const approved=buildRepeatMerchantAssignment({
      projectId,adminUid,project,
      recoveryAudit:recoverySnap.data(),
      transferCase:caseSnap.data(),financeReview:financeSnap.data(),
      operator:operatorSnap.data(),agreement:agreementSnap.data(),
      recipient:{...recipientSnap.data(),uid:recipientUid},
      priorRecipientHistoricGrant:formerGrantSnap.exists()?formerGrantSnap.data():null,
      now:new Date()
    });
    const time=serverTimestamp();
    tx.update(projectRef,{...approved.projectPatch,assignmentUpdatedAt:time,cutoverAt:time});
    tx.update(caseRef,{...approved.casePatch,cutoverAt:time});
    tx.set(witnessRef,{...approved.assignmentAudit,completedAt:time});
    return {projectId,cycle,recipientUid};
  });
}
