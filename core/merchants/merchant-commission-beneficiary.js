/**
 * Commission beneficiary is distinct from the immutable original Firestore
 * ownerId. Historic project IDs, agreements and earned ledger rows are never
 * reassigned when the platform recovers a physical merchant.
 *
 * This is a pure client-side projection: final authorization and beneficiary
 * equality MUST be checked independently by Firestore Rules at ledger create.
 */
export const PLATFORM_COMMISSION_BENEFICIARY = "__fb_platform_commissions__";

export function isVerifiedPlatformManagedMerchant(project = {}) {
  return project.platformManaged === true
    && project.assignmentStatus === "platform_managed"
    && project.assignedSubscriberId === ""
    && typeof project.recoveryAuditId === "string"
    && project.recoveryAuditId.length > 0
    && project.recoveryAt != null
    && project.recoveryAdminUid != null;
}

export function resolveCommissionBeneficiary(project = {}, agreement = {}) {
  if (!project.ownerId || !agreement.ownerId || project.ownerId !== agreement.ownerId) {
    throw new Error("COMMISSION_AGREEMENT_PROJECT_OWNER_MISMATCH");
  }

  if (project.platformManaged === true) {
    if (!isVerifiedPlatformManagedMerchant(project)) {
      throw new Error("MERCHANT_RECOVERY_AUDIT_REQUIRED");
    }
    return PLATFORM_COMMISSION_BENEFICIARY;
  }

  if (project.assignmentStatus === "platform_managed") {
    throw new Error("MERCHANT_RECOVERY_STATE_MISMATCH");
  }

  const assigned = project.assignedSubscriberId || project.ownerId;
  if (assigned !== project.ownerId) {
    // The future incoming-subscriber cutover needs its own beneficiary epoch,
    // rules, and agreement. Never silently pay their orders to the old owner.
    throw new Error("SUBSCRIBER_REASSIGNMENT_ROUTING_NOT_ENABLED");
  }

  return project.ownerId;
}

/**
 * Financial periods are different from current access:
 * previously earned entries keep their original userId forever.
 */
export function isPreviouslyEarnedCommissionPreserved(entry, snapshot) {
  return entry?.userId === snapshot?.userId
    && entry?.amount === snapshot?.amount
    && entry?.projectId === snapshot?.projectId
    && entry?.orderId === snapshot?.orderId;
}
