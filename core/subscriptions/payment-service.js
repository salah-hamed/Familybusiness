import db from "../firebase/firebase-db.js";
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
  buildPaymentCode,
  buildWhatsAppProofMessage,
  buildWhatsAppProofUrl,
  paymentStatusCopy,
  requiredSubscriptionPayment
} from "./payment-policy.js";

export {
  buildPaymentCode,
  buildWhatsAppProofMessage,
  buildWhatsAppProofUrl,
  paymentStatusCopy,
  requiredSubscriptionPayment
};

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

export async function prepareSubscriptionPaymentWhatsApp({
  user,
  userData,
  paymentReference
}) {
  if (!user?.uid) throw new Error("AUTH_REQUIRED");

  const reference = String(paymentReference || "").trim();
  if (reference.length < 4 || reference.length > 120) {
    throw new Error("INVALID_PAYMENT_REFERENCE");
  }

  const latest = await getLatestSubscriptionPayment(user.uid);
  if (latest?.status === "pending_review") {
    throw new Error("PAYMENT_ALREADY_PENDING");
  }

  const required = requiredSubscriptionPayment(userData);
  const timestamp = Date.now();
  const paymentId = `${user.uid}_${timestamp}`;
  const paymentCode = buildPaymentCode(user.uid, timestamp);

  await setDoc(doc(db, "subscriptionPayments", paymentId), {
    paymentId,
    paymentCode,
    userId: user.uid,
    userEmail: String(user.email || "").trim(),
    paymentType: required.paymentType,
    amount: required.amount,
    currency: required.currency,
    paymentMethod: "instapay",
    paymentReference: reference,
    proofChannel: "whatsapp",
    status: "pending_review",
    submittedAt: serverTimestamp(),
    whatsappPreparedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: "",
    rejectionReason: ""
  });

  return {
    paymentId,
    paymentCode,
    ...required,
    paymentReference: reference,
    proofChannel: "whatsapp",
    status: "pending_review"
  };
}
