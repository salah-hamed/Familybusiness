import { assessMerchantCutoverReadiness } from "./merchant-cutover-readiness.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validMoney = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
function millis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return NaN;
}

/**
 * Pure, auditable contract for ONE platform-managed -> incoming subscriber
 * reassignment. No ledger, settlement, ownerId, projectDocId or merchantId
 * is changed; the old subscriber has no consent or veto role.
 */
export function buildMerchantCutoverMutation({
  projectId, adminUid, project, recoveryAudit, transferCase, operator,
  agreement, recipient, financeReview, at
} = {}) {
  if (!ID.test(String(projectId || "")) || !ID.test(String(adminUid || "")) ||
      !ID.test(String(transferCase?.proposedSubscriberId || ""))) {
    throw new Error("CUTOVER_INVALID_IDENTIFIERS");
  }
  if (!financeReview || financeReview.projectDocId !== projectId ||
      financeReview.adminUid !== transferCase.financeReviewedBy ||
      financeReview.reviewedAt == null ||
      financeReview.formerSubscriberId !== project?.originalSubscriberId ||
      financeReview.currency !== "EGP" ||
      !validMoney(financeReview.platformEarnedAmount) ||
      !validMoney(financeReview.platformOutstandingAmount) ||
      !validMoney(financeReview.formerSubscriberEarnedAmount) ||
      !validMoney(financeReview.formerSubscriberOutstandingAmount) ||
      financeReview.platformOutstandingAmount > financeReview.platformEarnedAmount ||
      financeReview.formerSubscriberOutstandingAmount > financeReview.formerSubscriberEarnedAmount) {
    throw new Error("CUTOVER_PRIVATE_FINANCE_REVIEW_REQUIRED");
  }
  const report = assessMerchantCutoverReadiness({
    projectId, project, recoveryAudit, transferCase, operator, agreement,
    recipient, recipientUid:transferCase.proposedSubscriberId,
    platformSummary:{
      earnedAmount:financeReview.platformEarnedAmount, paidAmount:0,
      outstandingAmount:financeReview.platformOutstandingAmount
    },
    historicalSummary:{
      earnedAmount:financeReview.formerSubscriberEarnedAmount, paidAmount:0,
      outstandingAmount:financeReview.formerSubscriberOutstandingAmount
    },
    now:at instanceof Date ? at : new Date()
  });
  if (!report.prerequisitesMet ||
      !Number.isFinite(millis(financeReview.reviewedAt)) ||
      millis(financeReview.reviewedAt) !== millis(transferCase.financeReviewedAt)) {
    throw new Error("CUTOVER_PREREQUISITES_STALE");
  }
  if (project.ownerId !== project.originalSubscriberId ||
      transferCase.financeReviewedBy !== financeReview.adminUid ||
      project.operatorId !== projectId ||
      project.isActive !== true || project.status !== "active") {
    throw new Error("CUTOVER_IDENTITY_OR_RUNTIME_INVALID");
  }
  const recipientUid = transferCase.proposedSubscriberId;
  return {
    projectPatch:{
      platformManaged:true,
      assignmentStatus:"assigned_to_new_subscriber",
      assignedSubscriberId:recipientUid,
      assignmentUpdatedAt:at,
      cutoverAuditId:projectId,
      cutoverAt:at,
      cutoverAdminUid:adminUid
    },
    casePatch:{
      status:"cutover_completed",
      cutoverAt:at,
      cutoverBy:adminUid,
      cutoverAuditId:projectId
    },
    audit:{
      projectDocId:projectId, merchantId:project.merchantId,
      originalSubscriberId:project.originalSubscriberId,
      previousSubscriberId:"",
      assignedSubscriberId:recipientUid,
      recoveryAuditId:projectId,financeReviewId:projectId,
      commissionAmount:transferCase.commissionAmount,
      commissionVersion:transferCase.commissionVersion,
      commissionCurrency:transferCase.commissionCurrency,
      status:"completed",completedBy:adminUid,completedAt:at
    }
  };
}
