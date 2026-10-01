import { PLATFORM_BILLING } from "../config/platform-config.js";

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = new Set(["image/jpeg","image/png","image/webp"]);

export function requiredSubscriptionPayment(userData = {}) {
  const initialPaid = userData.initialActivationPaid === true || Boolean(userData.activatedAt);
  return {
    paymentType: initialPaid ? "renewal" : "initial",
    amount: initialPaid ? PLATFORM_BILLING.monthlyRenewalFee : PLATFORM_BILLING.initialActivationFee,
    currency: PLATFORM_BILLING.currency
  };
}

export function validatePaymentProofFile(file) {
  if (!file) return "ارفع صورة إيصال التحويل أولًا.";
  if (!ALLOWED_PROOF_TYPES.has(String(file.type || "").toLowerCase())) {
    return "صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP.";
  }
  if (!Number.isFinite(Number(file.size)) || Number(file.size) <= 0) {
    return "ملف الإثبات غير صالح.";
  }
  if (Number(file.size) > MAX_PROOF_BYTES) {
    return "حجم صورة الإثبات يجب ألا يزيد عن 5 MB.";
  }
  return "";
}

export function paymentStatusCopy(payment = null) {
  if (!payment) return "";
  if (payment.status === "pending_review") {
    return "تم استلام إثبات التحويل وهو الآن بانتظار مراجعة الإدارة.";
  }
  if (payment.status === "approved") {
    return "تم اعتماد الدفعة وتفعيل الاشتراك.";
  }
  if (payment.status === "rejected") {
    return payment.rejectionReason
      ? `تم رفض الإثبات: ${payment.rejectionReason}`
      : "تعذر اعتماد الإثبات. راجع بيانات التحويل وارفع إثباتًا جديدًا.";
  }
  return "";
}
