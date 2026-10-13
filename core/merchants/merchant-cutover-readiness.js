import { isQualifyingMerchantLink } from "./merchant-identity.js";
import { isVerifiedPlatformManagedMerchant } from "./merchant-commission-beneficiary.js";
import { transferTermsMatchAgreement } from "./transfer-financial-terms.js";

function asMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") value = value.toDate();
  if (value instanceof Date) return value.getTime();
  return NaN;
}

function isMoneySummary(value) {
  return value && ["earnedAmount","paidAmount","outstandingAmount"].every(key =>
    Number.isFinite(value[key]) && value[key] >= 0);
}

/**
 * Read-only final checks. Approval by the old subscriber is deliberately not
 * among them. No client-side result can authorize Firestore transfer writes.
 */
export function assessMerchantCutoverReadiness({
  projectId = "", project = null, recoveryAudit = null,
  transferCase = null, operator = null, agreement = null,
  recipient = null, recipientUid = "", platformSummary = null,
  historicalSummary = null, now = new Date()
} = {}) {
  const consent = transferCase || {};
  const business = project || {};
  const recovery = recoveryAudit || {};
  const target = recipient || {};
  const when = asMillis(now);
  const expiresAt = asMillis(target.subscriptionExpiresAt);
  const candidatePaid = target.isActive === true
    && target.subscriptionStatus === "active"
    && (target.subscriptionExpiresAt == null
      || (Number.isFinite(expiresAt) && expiresAt > when));

  const checks = [
    {code:"platformRecovery", passed:Boolean(
      isVerifiedPlatformManagedMerchant(business)
      && business.recoveryAuditId === projectId
      && recovery.status === "completed"
      && recovery.projectDocId === projectId
      && recovery.merchantId === business.merchantId
      && recovery.originalSubscriberId === business.originalSubscriberId
      && recovery.recoveredAt != null
      && asMillis(recovery.recoveredAt) === asMillis(business.recoveryAt)
    ), label:"الاسترداد موثق والمحل ما زال تحت إدارة المنصة"},
    {code:"identity", passed:Boolean(
      consent.projectDocId === projectId
      && consent.merchantId === business.merchantId
      && consent.originalSubscriberId === business.originalSubscriberId
      && consent.previousSubscriberId === ""
      && consent.proposedSubscriberId === recipientUid
      && recipientUid !== business.originalSubscriberId
      && consent.status === "awaiting_consents"
    ), label:"هوية النشاط والمشترك المستلم مطابقة لسجل التخصيص"},
    {code:"operator",passed:isQualifyingMerchantLink(operator || {}, agreement || {}),
      label:"المحل المشغّل نشط واتفاق العمولة مقبول"},
    {code:"consent",passed:Boolean(
      consent.operatorConsent === "accepted"
      && consent.recipientConsent === "accepted"
      && consent.operatorConsentedAt != null
      && consent.recipientConsentedAt != null
    ),label:"صاحب المحل والمشترك الجديد وافقا؛ لا يلزم موافقة المشترك القديم"},
    {code:"terms",passed:transferTermsMatchAgreement(consent,agreement || {}),
      label:"قيمة العمولة وإصدار الاتفاق لم يتغيرا بعد الموافقتين"},
    {code:"recipient",passed:Boolean(recipientUid
      && recipientUid === target.uid && candidatePaid),
      label:"حساب المشترك الجديد فعّال وفترة اشتراكه سارية"},
    {code:"history",passed:Boolean(isMoneySummary(platformSummary)
      && isMoneySummary(historicalSummary)),
      label:"مستحقات المنصة والحقوق القديمة منفصلة ومتاحة للمراجعة"},
    {code:"finance",passed:consent.financeClearance === "reviewed"
      && consent.financeReviewedAt != null
      && typeof consent.financeReviewedBy === "string"
      && consent.financeReviewedBy.length > 0,
      label:"راجع المسؤول الفترات المالية وسجل اعتماد المراجعة دون اعتبار الديون مسددة"}
  ];

  return {
    projectId,
    merchantId:business.merchantId || "",
    prospectiveSubscriberUid:recipientUid,
    checks,
    prerequisitesMet:checks.every(item=>item.passed),
    oldSubscriberApprovalRequired:false,
    // A reviewed checklist is not authorization. Real cutover needs
    // an independent atomic project+case transaction and production Rules.
    canExecuteCutoverNow:false
  };
}

export function formatMerchantCutoverReadiness(report) {
  return [
    "فحص تسليم المحل (قراءة فقط؛ لا يتم النقل):",
    ...report.checks.map(item=>`${item.passed ? "✅" : "❌"} ${item.label}`),
    report.prerequisitesMet
      ? "الشروط الإدارية متاحة، لكن التنفيذ الفعلي مقفول حتى اعتماد النقل الذري وقواعد الأمان."
      : "فيه شروط ناقصة؛ المحل يظل شغال تحت إدارة المنصة بدون تغيير صلاحيات أو عمولات."
  ].join("\n");
}
