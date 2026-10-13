import { isQualifyingMerchantLink, resolveMerchantIdentity } from "./merchant-identity.js";

export const MERCHANT_RECOVERY_REASON = Object.freeze({
  OVERDUE_RENEWAL: "overdue_renewal",
  CONFIRMED_VIOLATION: "confirmed_violation"
});

export const MERCHANT_RECOVERY_STATUS = Object.freeze({
  SUBSCRIBER_ASSIGNED: "assigned_to_subscriber",
  PLATFORM_MANAGED: "platform_managed"
});

const ACTIVE_MERCHANT_TEMPLATES = new Set(["supermarket", "restaurant", "bakery", "laundry"]);

function dateFrom(value) {
  if (value && typeof value.toDate === "function") value = value.toDate();
  if (value && typeof value.toMillis === "function") value = value.toMillis();
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

/**
 * A subscriber has no right to veto platform recovery, but the recovery
 * decision requires a trusted, auditable cause. This function is pure and
 * never reads/writes Firebase or changes merchant/operator/financial data.
 *
 * IMPORTANT: an eligible result is NOT permission to perform a takeover.
 * The future cutover must atomically change project entitlements, direct
 * NEW commission entries away from the original subscriber and retain
 * PREVIOUS ledger/settlement entries under that subscriber's UID.
 */
export function assessPlatformMerchantRecovery({
  project = null,
  projectDocId = "",
  subscriber = null,
  operator = null,
  agreement = null,
  reason = "",
  violation = null,
  hasUnreviewedRenewalPayment = false,
  now = new Date()
} = {}) {
  const when = dateFrom(now);
  if (!when) throw new Error("INVALID_CURRENT_TIME");

  const identity = resolveMerchantIdentity(project || {}, projectDocId);
  const isMerchant = Boolean(project && projectDocId &&
    ACTIVE_MERCHANT_TEMPLATES.has(project.template) &&
    project.operatingModel === "partner_operated" &&
    project.ownerId === identity.originalSubscriberId &&
    Boolean(identity.assignedSubscriberId) &&
    subscriber?.uid === identity.assignedSubscriberId &&
    project.isActive === true && project.status === "active");

  const operatorReady = isQualifyingMerchantLink(operator || {}, agreement || {});
  const alreadyRecovered = identity.platformManaged ||
    identity.assignmentStatus === MERCHANT_RECOVERY_STATUS.PLATFORM_MANAGED;

  const expiry = dateFrom(subscriber?.subscriptionExpiresAt);
  // No automatic seizure of legacy lifetime/free-grant users, unlinked
  // trial accounts, or accounts whose paid expiry is unprovable.
  const paidPreviously = subscriber?.initialActivationPaid === true ||
    Boolean(subscriber?.lastSubscriptionPaymentId);
  const renewalOverdue = Boolean(paidPreviously && expiry &&
    when.getTime() >= expiry.getTime() &&
    !hasUnreviewedRenewalPayment);

  const verifiedViolation = Boolean(
    violation && violation.status === "confirmed" &&
    typeof violation.reasonCode === "string" &&
    /^[a-z][a-z0-9_]{2,63}$/.test(violation.reasonCode) &&
    typeof violation.evidenceReference === "string" &&
    violation.evidenceReference.trim().length >= 8 &&
    typeof violation.confirmedByAdminUid === "string" &&
    violation.confirmedByAdminUid.length >= 1 &&
    dateFrom(violation.confirmedAt) &&
    dateFrom(violation.confirmedAt).getTime() <= when.getTime()
  );
  const triggerValid = reason === MERCHANT_RECOVERY_REASON.OVERDUE_RENEWAL
    ? renewalOverdue
    : reason === MERCHANT_RECOVERY_REASON.CONFIRMED_VIOLATION
      ? verifiedViolation : false;

  const checks = [
    {code: "merchant", passed: isMerchant, label: "النشاط يعمل مع محل مشغّل ومخصص لصاحب الاشتراك الأصلي"},
    {code: "shop_running", passed: operatorReady, label: "المحل المشغّل ما زال نشطًا واتفاق العمولة مقبول"},
    {code: "not_recovered", passed: !alreadyRecovered, label: "النشاط ليس تحت إدارة المنصة بالفعل"},
    {code: "cause", passed: triggerValid,
      label: reason === MERCHANT_RECOVERY_REASON.OVERDUE_RENEWAL
        ? "تأكد تأخر تجديد الاشتراك المدفوع، ولا توجد دفعة تجديد معلقة للمراجعة"
        : "المخالفة موثقة ومؤكدة من الإدارة"}
  ];

  return {
    merchantId: identity.merchantId,
    projectDocId,
    originalSubscriberId: identity.originalSubscriberId,
    previousSubscriberId: identity.assignedSubscriberId,
    reason,
    subscriptionExpiresAt: expiry,
    checks,
    eligibleForRecovery: checks.every(x => x.passed),
    oldSubscriberApprovalRequired: false,
    operatorShutdownRequired: false,
    // NEVER return true until secure entitlement + commission routing and
    // old-beneficiary settlement isolation are implemented end to end.
    mayApplyTakeoverNow: false,
    deferredSafetyRequirements: [
      "استمرار استقبال الطلبات تحت إدارة المنصة دون الرجوع لاشتراك المشترك القديم",
      "تغيير مستفيد العمولات المستقبلية فقط وقت النقل، دون المساس بالسجلات القديمة",
      "منع المشترك القديم من تعديل المشروع بعد النقل، مع السماح له بمشاهدة حقوقه السابقة",
      "تسجيل قرار الاسترداد والسبب والتوقيت وUID المسؤول بدون حذف"
    ]
  };
}
