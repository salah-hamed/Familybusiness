import { isQualifyingMerchantLink, resolveMerchantIdentity } from "./merchant-identity.js";

const ACTIVE_TEMPLATES = new Set(["supermarket","restaurant","bakery","laundry"]);

// This preflight is intentionally READ ONLY. Ownership in historical orders,
// historical ledger entries and settlement records never change merely
// because a merchant is being evaluated for a new subscriber.
export function assessMerchantTransfer({
  projectDocId = "",
  project = null,
  operator = null,
  agreement = null,
  candidate = null,
  candidateUid = ""
} = {}) {
  const identity = resolveMerchantIdentity(project || {}, projectDocId);
  const assignedUid = identity.assignedSubscriberId;
  const checks = [
    {
      code:"project",
      passed:Boolean(project && projectDocId && ACTIVE_TEMPLATES.has(project.template)
        && project.operatingModel === "partner_operated"),
      label:"نشاط موجود ويعمل بنموذج المحل المشغّل"
    },
    {
      code:"destination",
      passed:Boolean(/^[A-Za-z0-9_-]{1,128}$/.test(candidateUid) && candidate && candidate.uid === candidateUid
        && candidateUid !== assignedUid
        && candidateUid !== identity.originalSubscriberId
        && candidate.isActive === true
        && candidate.subscriptionStatus === "active"),
      label:"المشترك الجديد مختلف، وحسابه مفعل ومدفوع"
    },
    {
      code:"operator",
      passed:isQualifyingMerchantLink(operator || {}, agreement || {}),
      label:"المحل المشغّل فعل حسابه ووافق على اتفاق العمولة الحالي"
    },
    {
      code:"merchantIdentity",
      passed:Boolean(identity.merchantId),
      label:identity.isLegacyIdentity
        ? "للنشاط هوية توافقية قديمة؛ لا تنشئ ID بديلًا تلقائيًا"
        : "للنشاط معرّف مركزي ثابت"
    }
  ];

  return {
    merchantId:identity.merchantId,
    projectDocId,
    originalSubscriberId:identity.originalSubscriberId,
    assignedSubscriberId:assignedUid,
    candidateUid,
    identityNeedsBackfill:identity.isLegacyIdentity,
    checks,
    canOpenCase:checks.every(check => check.passed) && !identity.isLegacyIdentity,
    // A fresh merchant and destination consent + financial closeout are still
    // required after this evaluation; never advertise it as ready to cut over.
    canTransferNow:false,
    outstandingChecks:[
      "موافقة جديدة موثقة من المحل والمشترك الجديد",
      "إقفال الطلبات المفتوحة وفصل مستحقات المشترك القديم",
      "تثبيت رصيد العمولات والتسويات قبل تغيير المستفيد",
      "تفعيل صلاحيات المشترك الجديد وروابط الإدارة دون تغيير سجل الطلبات"
    ]
  };
}

export function formatMerchantTransferPreflight(report) {
  const lines = [
    `فحص إعادة التخصيص (بدون نقل فعلي) — ${report.projectDocId}`,
    ...report.checks.map(c => `${c.passed ? "✅" : "❌"} ${c.label}`),
    `الهوية المركزية: ${report.merchantId || "غير موجودة"}`,
    report.canOpenCase
      ? "مبدئيًا يمكن البدء في مراجعة طلب نقل رسمي."
      : "لا يمكن بدء طلب نقل حاليًا قبل استكمال الشروط أعلاه.",
    "ما زال مطلوبًا قبل أي نقل فعلي:",
    ...report.outstandingChecks.map(v => `• ${v}`)
  ];
  return lines.join("\n");
}
