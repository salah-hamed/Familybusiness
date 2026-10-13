import { transferTermsMatchAgreement } from "./transfer-financial-terms.js";

function validSummary(summary) {
  return summary && ["earnedAmount","paidAmount","outstandingAmount"].every(key=>
    Number.isFinite(summary[key]) && summary[key] >= 0);
}

// A financial REVIEW is never a receipt, settlement, write-off or a reset.
// Old subscriber dues and post-recovery platform dues remain independent.
export function buildMerchantTransferFinanceReview({
  projectId="",project=null,transferCase=null,agreement=null,
  adminUid="",platformSummary=null,historicalSummary=null
}={}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(adminUid)) throw new Error("FINANCE_REVIEW_ADMIN_REQUIRED");
  if (!project || project.platformManaged !== true || project.recoveryAuditId !== projectId
      || project.assignedSubscriberId !== "" || project.assignmentStatus !== "platform_managed") {
    throw new Error("FINANCE_REVIEW_MERCHANT_NOT_RECOVERED");
  }
  if (!transferCase || transferCase.projectDocId !== projectId
      || transferCase.merchantId !== project.merchantId
      || transferCase.originalSubscriberId !== project.originalSubscriberId
      || transferCase.previousSubscriberId !== ""
      || transferCase.status !== "awaiting_consents"
      || transferCase.financeClearance !== "pending"
      || transferCase.operatorConsent !== "accepted"
      || transferCase.recipientConsent !== "accepted"
      || transferCase.operatorConsentedAt == null
      || transferCase.recipientConsentedAt == null
      || !transferTermsMatchAgreement(transferCase,agreement)) {
    throw new Error("FINANCE_REVIEW_TRANSFER_NOT_READY");
  }
  if (!validSummary(platformSummary) || !validSummary(historicalSummary)) {
    throw new Error("FINANCE_REVIEW_BALANCES_UNAVAILABLE");
  }
  return {
    financeClearance:"reviewed",
    financeReviewedBy:adminUid,
    financeSnapshot:{
      currency:"EGP",
      formerSubscriberId:project.originalSubscriberId,
      platformOutstandingAmount:platformSummary.outstandingAmount,
      formerSubscriberOutstandingAmount:historicalSummary.outstandingAmount,
      platformEarnedAmount:platformSummary.earnedAmount,
      formerSubscriberEarnedAmount:historicalSummary.earnedAmount
    }
  };
}
