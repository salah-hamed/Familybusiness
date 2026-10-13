import db from "../firebase/firebase-db.js";
import { assessMerchantTransfer } from "./merchant-transfer-preflight.js";
import { MERCHANT_TRANSFER_CASES_ENABLED } from "./transfer-case-rollout.js";
import { snapshotMerchantTransferTerms } from "./transfer-financial-terms.js";
import { buildMerchantTransferFinanceReview } from "./transfer-finance-review.js";
import { getProjectPaymentSummary } from "../commissions/settlement-service.js";

import {
  doc, getDoc, runTransaction, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const UID = /^[A-Za-z0-9_-]{1,128}$/;

export function buildMerchantTransferCase({
  projectDocId, project, operator, agreement, candidate, candidateUid,
  adminUid, reason
}) {
  if (!UID.test(String(adminUid || ""))) throw new Error("ADMIN_UID_REQUIRED");
  // New assignment starts only AFTER the platform has recovered the shop;
  // it cannot bypass paid subscriber allocation while the old one is active.
  if (!project || project.platformManaged !== true
      || project.assignmentStatus !== "platform_managed"
      || project.assignedSubscriberId !== ""
      || project.recoveryAuditId !== projectDocId
      || !project.recoveryAt) {
    throw new Error("MERCHANT_MUST_BE_RECOVERED_FIRST");
  }
  const safeReason=String(reason || "").trim();
  if (safeReason.length < 15 || safeReason.length > 300) {
    throw new Error("TRANSFER_REASON_REQUIRED");
  }
  const readiness=assessMerchantTransfer({
    projectDocId,project,operator,agreement,candidate,candidateUid
  });
  if (!readiness.canOpenCase) throw new Error("MERCHANT_NOT_ELIGIBLE_FOR_CASE");

  return {
    projectDocId,
    merchantId:readiness.merchantId,
    originalSubscriberId:readiness.originalSubscriberId,
    previousSubscriberId:readiness.assignedSubscriberId,
    proposedSubscriberId:candidateUid,
    status:"awaiting_consents",
    operatorConsent:"pending",
    recipientConsent:"pending",
    operatorConsentedAt:null,
    recipientConsentedAt:null,
    ...snapshotMerchantTransferTerms(agreement),
    financeClearance:"pending",
    cutoverAt:null,
    reason:safeReason,
    createdBy:adminUid,
    createdAt:serverTimestamp()
  };
}

// Creates a consent CASE only. Never updates the running project, ownership,
// orders, ledger, settlement, client links or entitlement.
export async function openMerchantTransferCase({projectDocId,candidateUid,adminUid,reason}) {
  if (!MERCHANT_TRANSFER_CASES_ENABLED) throw new Error("MERCHANT_TRANSFER_CASES_DISABLED");
  if (!UID.test(projectDocId) || !UID.test(candidateUid)) throw new Error("INVALID_TRANSFER_IDENTIFIERS");

  const caseRef=doc(db,"merchantTransferCases",projectDocId);
  const projectRef=doc(db,"projects",projectDocId);
  const operatorRef=doc(db,"operators",projectDocId);
  const agreementRef=doc(db,"commissionAgreements",projectDocId);
  const recipientRef=doc(db,"users",candidateUid);

  await runTransaction(db,async transaction=>{
    const [existing,project,operator,agreement,candidate]=await Promise.all([
      transaction.get(caseRef),
      transaction.get(projectRef),
      transaction.get(operatorRef),
      transaction.get(agreementRef),
      transaction.get(recipientRef)
    ]);
    if (existing.exists()) throw new Error("TRANSFER_CASE_ALREADY_EXISTS");
    const payload=buildMerchantTransferCase({
      projectDocId,
      project:project.exists()?project.data():null,
      operator:operator.exists()?operator.data():null,
      agreement:agreement.exists()?agreement.data():null,
      candidate:candidate.exists()?candidate.data():null,
      candidateUid,adminUid,reason
    });
    transaction.set(caseRef,payload);
  });
  return projectDocId;
}

export async function submitMerchantTransferConsent(projectDocId,role,decision) {
  if (!MERCHANT_TRANSFER_CASES_ENABLED) throw new Error("MERCHANT_TRANSFER_CASES_DISABLED");
  if (!UID.test(projectDocId)) throw new Error("INVALID_TRANSFER_IDENTIFIERS");
  if (!["accepted","declined"].includes(decision)) throw new Error("INVALID_TRANSFER_CONSENT");

  const patch=role === "operator"
    ? {operatorConsent:decision,operatorConsentedAt:serverTimestamp()}
    : role === "recipient"
      ? {recipientConsent:decision,recipientConsentedAt:serverTimestamp()}
      : null;
  if (!patch) throw new Error("INVALID_TRANSFER_ROLE");
  await updateDoc(doc(db,"merchantTransferCases",projectDocId),patch);
}

export async function loadMerchantTransferCase(projectDocId) {
  if (!MERCHANT_TRANSFER_CASES_ENABLED) return null;
  if (!UID.test(projectDocId)) throw new Error("INVALID_TRANSFER_IDENTIFIERS");
  const snap=await getDoc(doc(db,"merchantTransferCases",projectDocId));
  return snap.exists()?{caseId:snap.id,...snap.data()}:null;
}

/**
 * Financial RECONCILIATION ONLY. This never marks a debt as paid or
 * moves old commissions. Only an authenticated Admin can submit the
 * Firestore write (checked independently by Rules).
 */
export async function reviewMerchantTransferFinance({projectDocId,adminUid}) {
  if (!MERCHANT_TRANSFER_CASES_ENABLED) throw new Error("MERCHANT_TRANSFER_CASES_DISABLED");
  if (!UID.test(String(projectDocId||"")) || !UID.test(String(adminUid||""))) {
    throw new Error("INVALID_TRANSFER_IDENTIFIERS");
  }
  const projectRef=doc(db,"projects",projectDocId);
  const caseRef=doc(db,"merchantTransferCases",projectDocId);
  const agreementRef=doc(db,"commissionAgreements",projectDocId);
  const reviewRef=doc(db,"merchantTransferFinanceReviews",projectDocId);
  const projectSnap=await getDoc(projectRef);
  if (!projectSnap.exists() || projectSnap.data().platformManaged !== true) {
    throw new Error("FINANCE_REVIEW_MERCHANT_NOT_RECOVERED");
  }
  const originalUid=String(projectSnap.data().originalSubscriberId||"");
  if (!UID.test(originalUid)) throw new Error("FINANCE_REVIEW_OLD_SUBSCRIBER_MISSING");
  // These totals are a dated REVIEW SNAPSHOT, not a payment confirmation.
  // A separate server-verified settlement/reconciliation is required
  // before any payment is counted as completed.
  const [platformSummary,historicalSummary]=await Promise.all([
    getProjectPaymentSummary(projectDocId),
    getProjectPaymentSummary(projectDocId,{ownerId:originalUid})
  ]);
  await runTransaction(db,async tx=>{
    const [projectSnap2,caseSnap,agreementSnap,existingReview]=await Promise.all([
      tx.get(projectRef),tx.get(caseRef),tx.get(agreementRef),tx.get(reviewRef)
    ]);
    if (existingReview.exists()) throw new Error("FINANCE_REVIEW_ALREADY_RECORDED");
    const payload=buildMerchantTransferFinanceReview({
      projectId:projectDocId,
      project:projectSnap2.exists()?projectSnap2.data():null,
      transferCase:caseSnap.exists()?caseSnap.data():null,
      agreement:agreementSnap.exists()?agreementSnap.data():null,
      adminUid,platformSummary,historicalSummary
    });
    const reviewedAt=serverTimestamp();
    // The operator/recipient may read the consent case; they must NEVER read
    // the former subscriber's balances. Amounts live in an admin-only document.
    const {financeSnapshot,...publicReview}=payload;
    tx.set(reviewRef,{
      projectDocId,adminUid,reviewedAt,...financeSnapshot
    });
    tx.update(caseRef,{...publicReview,financeReviewedAt:reviewedAt});
  });
}
