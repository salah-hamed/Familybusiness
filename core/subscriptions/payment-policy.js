import { PLATFORM_BILLING } from "../config/platform-config.js";

function clean(value) {
  return String(value || "").trim();
}

export function requiredSubscriptionPayment(userData = {}) {
  const initialPaid = userData.initialActivationPaid === true || Boolean(userData.activatedAt);
  return {
    paymentType: initialPaid ? "renewal" : "initial",
    amount: initialPaid ? PLATFORM_BILLING.monthlyRenewalFee : PLATFORM_BILLING.initialActivationFee,
    currency: PLATFORM_BILLING.currency
  };
}

export function buildPaymentCode(userId, timestamp = Date.now()) {
  const uidPart = clean(userId).replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase() || "USER";
  const timePart = Number(timestamp).toString(36).slice(-6).toUpperCase();
  return `FB-${uidPart}-${timePart}`;
}

export function normalizeWhatsappNumber(value) {
  return clean(value).replace(/[^0-9]/g, "");
}

export function buildWhatsAppProofMessage({
  paymentCode,
  paymentType,
  amount,
  currency = "EGP",
  paymentReference,
  userEmail = ""
} = {}) {
  const typeLabel = paymentType === "renewal" ? "تجديد اشتراك" : "أول تفعيل";
  return [
    "إثبات اشتراك Family Business",
    `كود الدفع: ${clean(paymentCode)}`,
    `نوع الاشتراك: ${typeLabel}`,
    `المبلغ: ${Number(amount || 0)} ${currency}`,
    `مرجع InstaPay: ${clean(paymentReference)}`,
    userEmail ? `البريد: ${clean(userEmail)}` : "",
    "",
    "سأرفق Screenshot التحويل في هذه المحادثة."
  ].filter(Boolean).join("\n");
}

export function buildWhatsAppProofUrl(phone, message) {
  const normalized = normalizeWhatsappNumber(phone);
  if (!normalized) return "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(String(message || ""))}`;
}

export function paymentStatusCopy(payment = null) {
  if (!payment) return "";
  if (payment.status === "pending_review") {
    return `تم تسجيل الدفعة${payment.paymentCode ? ` بكود ${payment.paymentCode}` : ""}. أرسل Screenshot التحويل على واتساب ثم انتظر مراجعة الإدارة.`;
  }
  if (payment.status === "approved") {
    return "تم اعتماد الدفعة وتفعيل الاشتراك.";
  }
  if (payment.status === "rejected") {
    return payment.rejectionReason
      ? `تم رفض الإثبات: ${payment.rejectionReason}`
      : "تعذر اعتماد الإثبات. راجع بيانات التحويل وتواصل معنا على واتساب.";
  }
  return "";
}
