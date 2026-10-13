import db from "../firebase/firebase-db.js";
import { buildMerchantCutoverMutation } from "./merchant-cutover-execution.js";
import { MERCHANT_CUTOVER_ENABLED } from "./merchant-cutover-rollout.js";
import { MERCHANT_TRANSFER_CASES_ENABLED } from "./transfer-case-rollout.js";
import {
  doc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * One atomic transfer, no old-subscriber veto or rewriting financial history.
 * The incoming subscriber's Auth UID is the users/{uid} DOCUMENT ID.
 * Permanently disabled pending final Rules publish and release sign-off.
 */
export async function executeMerchantCutover({projectId, adminUid}) {
  if (!MERCHANT_CUTOVER_ENABLED || !MERCHANT_TRANSFER_CASES_ENABLED) {
    throw new Error("MERCHANT_CUTOVER_DISABLED");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(projectId||"")) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(String(adminUid||""))) {
    throw new Error("CUTOVER_INVALID_IDENTIFIERS");
  }
  const projectRef=doc(db,"projects",projectId);
  const caseRef=doc(db,"merchantTransferCases",projectId);
  const recoveryRef=doc(db,"merchantRecoveries",projectId);
  const financeRef=doc(db,"merchantTransferFinanceReviews",projectId);
  const auditRef=doc(db,"merchantAssignmentCutovers",projectId);
  const operatorRef=doc(db,"operators",projectId);
  const agreementRef=doc(db,"commissionAgreements",projectId);

  return runTransaction(db,async tx=>{
    const [projectSnap,caseSnap,recoverySnap,financeSnap,existingAudit,operatorSnap,agreementSnap]=
      await Promise.all([
        tx.get(projectRef),tx.get(caseRef),tx.get(recoveryRef),tx.get(financeRef),
        tx.get(auditRef),tx.get(operatorRef),tx.get(agreementRef)
      ]);
    if (existingAudit.exists()) throw new Error("CUTOVER_ALREADY_COMPLETED");
    if ([projectSnap,caseSnap,recoverySnap,financeSnap,operatorSnap,agreementSnap].some(s=>!s.exists())) {
      throw new Error("CUTOVER_REQUIRED_RECORD_MISSING");
    }
    const transferCase=caseSnap.data();
    const recipientUid=transferCase.proposedSubscriberId;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(recipientUid||""))) {
      throw new Error("CUTOVER_INVALID_RECIPIENT");
    }
    const recipientSnap=await tx.get(doc(db,"users",recipientUid));
    if (!recipientSnap.exists()) throw new Error("CUTOVER_RECIPIENT_MISSING");
    // No writes before ALL read/validation is completed. Every conflicting
    // project/case/recipient edit forces a Firestore transaction retry.
    const at=serverTimestamp();
    const mutations=buildMerchantCutoverMutation({
      projectId,adminUid,project:projectSnap.data(),recoveryAudit:recoverySnap.data(),
      transferCase,operator:operatorSnap.data(),agreement:agreementSnap.data(),
      recipient:{...recipientSnap.data(),uid:recipientUid},
      financeReview:financeSnap.data(),at:new Date()
    });
    tx.update(projectRef,{
      ...mutations.projectPatch,assignmentUpdatedAt:at,cutoverAt:at
    });
    tx.update(caseRef,{...mutations.casePatch,cutoverAt:at});
    tx.set(auditRef,{...mutations.audit,completedAt:at});
    return {projectId,recipientUid};
  });
}
