import db from "../firebase/firebase-db.js";
import storage from "../firebase/firebase-storage.js";
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
import {
  paymentStatusCopy,
  requiredSubscriptionPayment,
  validatePaymentProofFile
} from "./payment-policy.js";

export { paymentStatusCopy, requiredSubscriptionPayment, validatePaymentProofFile };

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
