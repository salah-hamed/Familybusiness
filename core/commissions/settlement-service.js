import db from "../firebase/firebase-db.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  getAggregateFromServer,
  query,
  where,
  orderBy,
  limit,
  sum,
  count,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function clean(value) {
  return String(value || "").trim();
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }
  return Math.round(amount * 100) / 100;
}

async function aggregateAmount(queryRef) {
  const snap = await getAggregateFromServer(queryRef, {
    totalAmount: sum("amount"),
    entryCount: count()
  });

  return {
    totalAmount: Number(snap.data().totalAmount || 0),
    entryCount: Number(snap.data().entryCount || 0)
  };
}

export async function getProjectPaymentSummary(
  projectId,
  { ownerId = "" } = {}
) {
  const pid = clean(projectId);
  const oid = clean(ownerId);
  if (!pid) throw new Error("PROJECT_ID_REQUIRED");

  const ledger = collection(db, "commissionLedger");
  const payments = collection(db, "commissionSettlements");
  const ledgerScope = [
    where("projectId", "==", pid),
    where("sourceType", "==", "project_order")
  ];

  if (oid) {
    ledgerScope.push(where("userId", "==", oid));
  }

  const [earned, confirmed, legacyPaid, pending] = await Promise.all([
    aggregateAmount(query(ledger, ...ledgerScope)),
    aggregateAmount(query(
      payments,
      where("projectId", "==", pid),
      where("status", "==", "confirmed")
    )),
    aggregateAmount(query(
      payments,
      where("projectId", "==", pid),
      where("status", "==", "paid")
    )),
    aggregateAmount(query(
      payments,
      where("projectId", "==", pid),
      where("status", "==", "pending_owner_confirmation")
    ))
  ]);

  const recordedPayments = confirmed.totalAmount + legacyPaid.totalAmount;
  const paidAmount = Math.min(earned.totalAmount, recordedPayments);

  return {
    earnedAmount: earned.totalAmount,
    earnedCount: earned.entryCount,
    paidAmount,
    outstandingAmount: Math.max(0, earned.totalAmount - paidAmount),
    pendingAmount: pending.totalAmount,
    pendingCount: pending.entryCount
  };
}

export async function listProjectPaymentRequests(
  projectId,
  { pageSize = 20 } = {}
) {
  const pid = clean(projectId);
  if (!pid) throw new Error("PROJECT_ID_REQUIRED");

  const size = Math.max(1, Math.min(50, Number(pageSize) || 20));
  const snap = await getDocs(
    query(
      collection(db, "commissionSettlements"),
      where("projectId", "==", pid),
      orderBy("createdAt", "desc"),
      limit(size)
    )
  );

  return snap.docs.map(item => ({
    settlementId: item.id,
    ...item.data()
  }));
}

export async function declareOperatorPayment({
  projectId,
  operatorUid,
  amount,
  paymentMethod,
  paymentReference = "",
  note = ""
}) {
  const pid = clean(projectId);
  const uid = clean(operatorUid);
  const paidAmount = money(amount);
  const method = clean(paymentMethod);
  const reference = clean(paymentReference).slice(0, 200);
  const safeNote = clean(note).slice(0, 500);

  if (!pid || !uid || !method) throw new Error("PAYMENT_FIELDS_REQUIRED");

  const summary = await getProjectPaymentSummary(pid);
  if (summary.pendingCount > 0) throw new Error("PENDING_PAYMENT_EXISTS");
  if (summary.outstandingAmount <= 0) throw new Error("NO_OUTSTANDING_COMMISSIONS");
  if (paidAmount > summary.outstandingAmount) throw new Error("PAYMENT_EXCEEDS_OUTSTANDING");

  const projectRef = doc(db, "projects", pid);
  const stateRef = doc(db, "commissionPaymentStates", pid);
  const settlementRef = doc(collection(db, "commissionSettlements"));

  await runTransaction(db, async transaction => {
    const [projectSnap, stateSnap] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(stateRef)
    ]);

    if (!projectSnap.exists()) throw new Error("PROJECT_NOT_FOUND");
    const project = projectSnap.data();

    if (
      project.operatingModel !== "partner_operated" ||
      !project.operatorId
    ) {
      throw new Error("PROJECT_NOT_PARTNER_OPERATED");
    }

    if (stateSnap.exists() && stateSnap.data().pendingSettlementId) {
      throw new Error("PENDING_PAYMENT_EXISTS");
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

    const createdAt = serverTimestamp();

    transaction.set(settlementRef, {
      settlementId: settlementRef.id,
      projectId: pid,
      ownerId: project.ownerId,
      operatorId: project.operatorId,
      templateId: project.template || project.projectId || "",
      businessName: project.businessName || operator.name || "",
      currency: "EGP",
      amount: paidAmount,
      status: "pending_owner_confirmation",
      paymentMethod: method.slice(0, 80),
      paymentReference: reference,
      note: safeNote,
      declaredAt: createdAt,
      declaredBy: uid,
      createdAt,
      updatedAt: createdAt,
      confirmedAt: null,
      confirmedBy: null,
      rejectedAt: null,
      rejectedBy: null
    });

    transaction.set(stateRef, {
      projectId: pid,
      ownerId: project.ownerId,
      operatorId: project.operatorId,
      pendingSettlementId: settlementRef.id,
      updatedAt: createdAt
    }, { merge: true });
  });

  return settlementRef.id;
}

export async function confirmOwnerPayment({
  settlementId,
  ownerUid
}) {
  const sid = clean(settlementId);
  const uid = clean(ownerUid);
  if (!sid || !uid) throw new Error("PAYMENT_CONFIRMATION_FIELDS_REQUIRED");

  const settlementRef = doc(db, "commissionSettlements", sid);
  const initialSnap = await getDoc(settlementRef);
  if (!initialSnap.exists()) throw new Error("SETTLEMENT_NOT_FOUND");

  const initial = initialSnap.data();
  if (initial.ownerId !== uid) throw new Error("SETTLEMENT_OWNER_MISMATCH");
  if (initial.status !== "pending_owner_confirmation") {
    throw new Error("SETTLEMENT_NOT_PENDING");
  }

  const summary = await getProjectPaymentSummary(initial.projectId, { ownerId: uid });
  if (Number(initial.amount || 0) > summary.outstandingAmount) {
    throw new Error("PAYMENT_EXCEEDS_CURRENT_OUTSTANDING");
  }

  const stateRef = doc(db, "commissionPaymentStates", initial.projectId);

  await runTransaction(db, async transaction => {
    const [settlementSnap, stateSnap] = await Promise.all([
      transaction.get(settlementRef),
      transaction.get(stateRef)
    ]);

    if (!settlementSnap.exists()) throw new Error("SETTLEMENT_NOT_FOUND");
    const settlement = settlementSnap.data();

    if (settlement.ownerId !== uid) throw new Error("SETTLEMENT_OWNER_MISMATCH");
    if (settlement.status !== "pending_owner_confirmation") {
      throw new Error("SETTLEMENT_NOT_PENDING");
    }
    if (
      !stateSnap.exists() ||
      stateSnap.data().pendingSettlementId !== sid
    ) {
      throw new Error("PAYMENT_STATE_MISMATCH");
    }

    const confirmedAt = serverTimestamp();

    transaction.update(settlementRef, {
      status: "confirmed",
      confirmedAt,
      confirmedBy: uid,
      updatedAt: confirmedAt
    });

    transaction.set(stateRef, {
      pendingSettlementId: "",
      updatedAt: confirmedAt
    }, { merge: true });
  });
}

export async function rejectOwnerPayment({
  settlementId,
  ownerUid
}) {
  const sid = clean(settlementId);
  const uid = clean(ownerUid);
  if (!sid || !uid) throw new Error("PAYMENT_CONFIRMATION_FIELDS_REQUIRED");

  const settlementRef = doc(db, "commissionSettlements", sid);

  await runTransaction(db, async transaction => {
    const settlementSnap = await transaction.get(settlementRef);
    if (!settlementSnap.exists()) throw new Error("SETTLEMENT_NOT_FOUND");

    const settlement = settlementSnap.data();
    if (settlement.ownerId !== uid) throw new Error("SETTLEMENT_OWNER_MISMATCH");
    if (settlement.status !== "pending_owner_confirmation") {
      throw new Error("SETTLEMENT_NOT_PENDING");
    }

    const stateRef = doc(db, "commissionPaymentStates", settlement.projectId);
    const stateSnap = await transaction.get(stateRef);

    if (
      !stateSnap.exists() ||
      stateSnap.data().pendingSettlementId !== sid
    ) {
      throw new Error("PAYMENT_STATE_MISMATCH");
    }

    const rejectedAt = serverTimestamp();

    transaction.update(settlementRef, {
      status: "rejected",
      rejectedAt,
      rejectedBy: uid,
      updatedAt: rejectedAt
    });

    transaction.set(stateRef, {
      pendingSettlementId: "",
      updatedAt: rejectedAt
    }, { merge: true });
  });
}

export async function listRecentCommissionSettlements({
  status = "all",
  pageSize = 50
} = {}) {
  const size = Math.max(1, Math.min(100, Number(pageSize) || 50));
  const constraints = [];

  if (status !== "all") {
    constraints.push(where("status", "==", status));
  }

  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(size));

  const snap = await getDocs(
    query(collection(db, "commissionSettlements"), ...constraints)
  );

  return snap.docs.map(item => ({
    settlementId: item.id,
    ...item.data()
  }));
}
