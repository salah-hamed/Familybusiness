import db from "../firebase/firebase-db.js";
import storage from "../firebase/firebase-storage.js";
import { PLATFORM_BILLING } from "../config/platform-config.js";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  deleteObject,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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

export async function getLatestSubscriptionPayment(userId) {
  const snap = await getDocs(query(
    collection(db, "subscriptionPayments"),
    where("userId", "==", userId),
    orderBy("submittedAt", "desc"),
    limit(1)
  ));
  if (snap.empty) return null;
  const item = snap.docs[0];
  return { paymentId: item.id, ...item.data() };
}

export async function submitSubscriptionPaymentProof({
  user,
  userData,
  paymentReference,
  proofFile
}) {
  if (!user?.uid) throw new Error("AUTH_REQUIRED");

  const reference = String(paymentReference || "").trim();
  if (reference.length < 4 || reference.length > 120) {
    throw new Error("INVALID_PAYMENT_REFERENCE");
  }

  const fileError = validatePaymentProofFile(proofFile);
  if (fileError) throw new Error(fileError);

  const latest = await getLatestSubscriptionPayment(user.uid);
  if (latest?.status === "pending_review") {
    throw new Error("PAYMENT_ALREADY_PENDING");
  }

  const required = requiredSubscriptionPayment(userData);
  const paymentId = `${user.uid}_${Date.now()}`;
  const proofPath = `subscription-proofs/${user.uid}/${paymentId}`;
  const proofRef = ref(storage, proofPath);

  await uploadBytes(proofRef, proofFile, {
    contentType: proofFile.type,
    customMetadata: {
      ownerUid: user.uid,
      paymentId
    }
  });

  try {
    await setDoc(doc(db, "subscriptionPayments", paymentId), {
      paymentId,
      userId: user.uid,
      userEmail: String(user.email || "").trim(),
      paymentType: required.paymentType,
      amount: required.amount,
      currency: required.currency,
      paymentMethod: "instapay",
      paymentReference: reference,
      proofPath,
      status: "pending_review",
      submittedAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: "",
      rejectionReason: ""
    });
  } catch (error) {
    await deleteObject(proofRef).catch(() => {});
    throw error;
  }

  return { paymentId, ...required, status: "pending_review" };
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
