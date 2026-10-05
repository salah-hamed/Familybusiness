import db from "../firebase/firebase-db.js";
import { getProjectPaymentSummary } from "./settlement-service.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const ALLOWED_REVERSAL_REASONS = Object.freeze([
  "customer_canceled_after_dispatch",
  "delivery_failed",
  "duplicate_order",
  "operator_error",
  "other"
]);

function clean(value) {
  return String(value || "").trim();
}

function reversalIdForOrder(orderId) {
  return `project_order_${clean(orderId)}`;
}

export function commissionReversalId(orderId) {
  const id = clean(orderId);
  if (!id) throw new Error("ORDER_ID_REQUIRED");
  return reversalIdForOrder(id);
}

export async function requestCommissionReversal({
  projectId,
  orderId,
  operatorUid,
  reasonCode,
  note = ""
}) {
  const pid = clean(projectId);
  const oid = clean(orderId);
  const uid = clean(operatorUid);
  const reason = clean(reasonCode);
  const safeNote = clean(note).slice(0, 500);

  if (!pid || !oid || !uid || !reason) {
    throw new Error("REVERSAL_FIELDS_REQUIRED");
  }
  if (!ALLOWED_REVERSAL_REASONS.includes(reason)) {
    throw new Error("INVALID_REVERSAL_REASON");
  }

  const summary = await getProjectPaymentSummary(pid);
  const orderRef = doc(db, "orders", oid);
  const projectRef = doc(db, "projects", pid);
  const ledgerRef = doc(db, "commissionLedger", `project_order_${oid}`);
  const reversalRef = doc(db, "commissionReversals", reversalIdForOrder(oid));

  await runTransaction(db, async transaction => {
    const [orderSnap, projectSnap, ledgerSnap, reversalSnap] = await Promise.all([
      transaction.get(orderRef),
      transaction.get(projectRef),
      transaction.get(ledgerRef),
      transaction.get(reversalRef)
    ]);

    if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
    if (!projectSnap.exists()) throw new Error("PROJECT_NOT_FOUND");
    if (!ledgerSnap.exists()) throw new Error("COMMISSION_LEDGER_NOT_FOUND");
    if (reversalSnap.exists()) throw new Error("REVERSAL_ALREADY_EXISTS");

    const order = orderSnap.data();
    const project = projectSnap.data();
    const ledger = ledgerSnap.data();

    if (order.projectId !== pid || ledger.projectId !== pid || ledger.orderId !== oid) {
      throw new Error("REVERSAL_PROJECT_MISMATCH");
    }
    if (order.status !== "canceled") {
      throw new Error("ORDER_MUST_BE_CANCELED_FIRST");
    }
    if (order.commissionLocked !== true || Number(order.commissionAmount || 0) <= 0) {
      throw new Error("ORDER_HAS_NO_EARNED_COMMISSION");
    }
    if (ledger.status !== "earned") {
      throw new Error("COMMISSION_NOT_REVERSIBLE");
    }
    if (
      project.operatingModel !== "partner_operated" ||
      !project.operatorId
    ) {
      throw new Error("PROJECT_NOT_PARTNER_OPERATED");
    }

    const operatorRef = doc(db, "operators", project.operatorId);
    const operatorSnap = await transaction.get(operatorRef);
    if (!operatorSnap.exists()) throw new Error("OPERATOR_NOT_FOUND");

    const operator = operatorSnap.data();
    if (
      operator.authUid !== uid ||
      operator.status !== "active" ||
      operator.isActive !== true
    ) {
      throw new Error("OPERATOR_ACCESS_DENIED");
    }

    const amount = Number(ledger.amount || 0);
    if (summary.outstandingAmount < amount) {
      throw new Error("REVERSAL_EXCEEDS_OUTSTANDING");
    }

    const requestedAt = serverTimestamp();

    transaction.set(reversalRef, {
      reversalId: reversalRef.id,
      projectId: pid,
      orderId: oid,
      ledgerEntryId: ledgerRef.id,
      ownerId: project.ownerId,
      operatorId: project.operatorId,
      amount,
      currency: ledger.currency || "EGP",
      reasonCode: reason,
      note: safeNote,
      status: "pending_owner_confirmation",
      requestedAt,
      requestedBy: uid,
      createdAt: requestedAt,
      updatedAt: requestedAt,
      confirmedAt: null,
      confirmedBy: null,
      rejectedAt: null,
      rejectedBy: null
    });
  });

  return reversalRef.id;
}

export async function confirmCommissionReversal({
  reversalId,
  ownerUid
}) {
  const rid = clean(reversalId);
  const uid = clean(ownerUid);
  if (!rid || !uid) throw new Error("REVERSAL_CONFIRMATION_FIELDS_REQUIRED");

  const reversalRef = doc(db, "commissionReversals", rid);
  const initialSnap = await getDoc(reversalRef);
  if (!initialSnap.exists()) throw new Error("REVERSAL_NOT_FOUND");

  const initial = initialSnap.data();
  if (initial.ownerId !== uid) throw new Error("REVERSAL_OWNER_MISMATCH");
  if (initial.status !== "pending_owner_confirmation") {
    throw new Error("REVERSAL_NOT_PENDING");
  }

  const summary = await getProjectPaymentSummary(initial.projectId, { ownerId: uid });
  if (summary.outstandingAmount < Number(initial.amount || 0)) {
    throw new Error("REVERSAL_EXCEEDS_CURRENT_OUTSTANDING");
  }

  const ledgerRef = doc(db, "commissionLedger", initial.ledgerEntryId);

  await runTransaction(db, async transaction => {
    const [reversalSnap, ledgerSnap] = await Promise.all([
      transaction.get(reversalRef),
      transaction.get(ledgerRef)
    ]);

    if (!reversalSnap.exists()) throw new Error("REVERSAL_NOT_FOUND");
    if (!ledgerSnap.exists()) throw new Error("COMMISSION_LEDGER_NOT_FOUND");

    const reversal = reversalSnap.data();
    const ledger = ledgerSnap.data();

    if (reversal.ownerId !== uid) throw new Error("REVERSAL_OWNER_MISMATCH");
    if (reversal.status !== "pending_owner_confirmation") {
      throw new Error("REVERSAL_NOT_PENDING");
    }
    if (
      ledger.projectId !== reversal.projectId ||
      ledger.orderId !== reversal.orderId ||
      ledger.status !== "earned" ||
      Number(ledger.amount || 0) !== Number(reversal.amount || 0)
    ) {
      throw new Error("REVERSAL_LEDGER_MISMATCH");
    }

    const confirmedAt = serverTimestamp();

    transaction.update(reversalRef, {
      status: "confirmed",
      confirmedAt,
      confirmedBy: uid,
      updatedAt: confirmedAt
    });

    transaction.update(ledgerRef, {
      status: "reversed",
      reversedAt: confirmedAt,
      reversalId: rid,
      reversalReason: reversal.reasonCode,
      reversalConfirmedBy: uid
    });
  });
}

export async function rejectCommissionReversal({
  reversalId,
  ownerUid
}) {
  const rid = clean(reversalId);
  const uid = clean(ownerUid);
  if (!rid || !uid) throw new Error("REVERSAL_CONFIRMATION_FIELDS_REQUIRED");

  const reversalRef = doc(db, "commissionReversals", rid);

  await runTransaction(db, async transaction => {
    const reversalSnap = await transaction.get(reversalRef);
    if (!reversalSnap.exists()) throw new Error("REVERSAL_NOT_FOUND");

    const reversal = reversalSnap.data();
    if (reversal.ownerId !== uid) throw new Error("REVERSAL_OWNER_MISMATCH");
    if (reversal.status !== "pending_owner_confirmation") {
      throw new Error("REVERSAL_NOT_PENDING");
    }

    const rejectedAt = serverTimestamp();

    transaction.update(reversalRef, {
      status: "rejected",
      rejectedAt,
      rejectedBy: uid,
      updatedAt: rejectedAt
    });
  });
}

export async function listProjectCommissionReversals(
  projectId,
  { pageSize = 20 } = {}
) {
  const pid = clean(projectId);
  if (!pid) throw new Error("PROJECT_ID_REQUIRED");

  const size = Math.max(1, Math.min(50, Number(pageSize) || 20));
  const snap = await getDocs(
    query(
      collection(db, "commissionReversals"),
      where("projectId", "==", pid),
      orderBy("createdAt", "desc"),
      limit(size)
    )
  );

  return snap.docs.map(item => ({
    reversalId: item.id,
    ...item.data()
  }));
}
