import { MERCHANT_REPEAT_ASSIGNMENT_ENABLED } from "../merchants/merchant-cycle-rollout.js";
import {
  PLATFORM_COMMISSION_BENEFICIARY,
  isVerifiedPlatformManagedMerchant,
  isVerifiedAssignedAfterCutover
} from "../merchants/merchant-commission-beneficiary.js";

/**
 * Finance account is keyed by the beneficiary of NEW earnings, not the
 * historical project's immutable ownerId. Old payments keep their ownerId.
 * This is a presentation helper, NEVER an authorization check.
 */
export function resolveMerchantFinancePeriod(project) {
  if (!project || !project.ownerId) throw new Error("PROJECT_REQUIRED");
  if (project.platformManaged === true) {
    if (isVerifiedAssignedAfterCutover(project)) {
      return {
        beneficiaryId: project.assignedSubscriberId,
        platformPeriod: false,
        assignmentPeriod: true,
        canDeclarePayment: MERCHANT_REPEAT_ASSIGNMENT_ENABLED,
        requiresExternalVerification: !MERCHANT_REPEAT_ASSIGNMENT_ENABLED,
        settlementLabel: "عمولات المشترك الحالي — تسوية منفصلة عن كل الفترات السابقة"
      };
    }
    if (!isVerifiedPlatformManagedMerchant(project)) {
      throw new Error("MERCHANT_RECOVERY_AUDIT_REQUIRED");
    }
    return {
      beneficiaryId: PLATFORM_COMMISSION_BENEFICIARY,
      platformPeriod: true,
      canDeclarePayment: false,
      requiresExternalVerification: true,
      settlementLabel: "مستحقات المنصة من التشغيل بعد الاسترداد"
    };
  }
  if (project.assignmentStatus === "platform_managed") {
    throw new Error("MERCHANT_RECOVERY_STATE_MISMATCH");
  }
  if (project.assignedSubscriberId && project.assignedSubscriberId !== project.ownerId) {
    // Future incoming-subscriber settlement remains blocked until cutover.
    throw new Error("REASSIGNMENT_SETTLEMENT_NOT_ENABLED");
  }
  return {
    beneficiaryId: project.ownerId,
    platformPeriod: false,
    canDeclarePayment: true,
    requiresExternalVerification: false,
    settlementLabel: "العمولة المستحقة للمشترك"
  };
}
