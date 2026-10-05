import db from "../firebase/firebase-db.js";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  runTransaction,
  where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  buildPaymentCode,
  buildWhatsAppProofMessage,
  buildWhatsAppProofUrl,
  paymentStatusCopy,
  requiredSubscriptionPayment,
  normalizePaymentReference,
  paymentReferenceClaimId
} from "./payment-policy.js";

export {
  buildPaymentCode,
  buildWhatsAppProofMessage,
  buildWhatsAppProofUrl,
  paymentStatusCopy,
  requiredSubscriptionPayment,
  normalizePaymentReference,
  paymentReferenceClaimId
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

  const reference = normalizePaymentReference(paymentReference);
  const referenceClaimId = paymentReferenceClaimId(reference);
  if (!referenceClaimId) {
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

  const paymentRef = doc(db, "subscriptionPayments", paymentId);
  const claimRef = doc(db, "paymentReferenceClaims", referenceClaimId);

  await runTransaction(db, async transaction => {
    const claimSnap = await transaction.get(claimRef);
    if (claimSnap.exists()) {
      throw new Error("PAYMENT_REFERENCE_ALREADY_USED");
    }

    transaction.set(paymentRef, {
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

    transaction.set(claimRef, {
      referenceId: referenceClaimId,
      paymentReference: reference,
      paymentId,
      userId: user.uid,
      status: "pending_review",
      createdAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: ""
    });
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
