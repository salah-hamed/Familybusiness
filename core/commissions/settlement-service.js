import db from "../firebase/firebase-db.js";

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
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SETTLEMENT_ENTRY_LIMIT = 200;

function clean(value) {
  return String(value || "").trim();
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("INVALID_SETTLEMENT_AMOUNT");
  return Math.round(amount * 100) / 100;
}

function toMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds) return Number(value.seconds) * 1000;
  return 0;
}

export async function listProjectOutstandingCommissionEntries(projectId) {
  const pid = clean(projectId);
  if (!pid) throw new Error("PROJECT_ID_REQUIRED");

  const snap = await getDocs(
    query(
      collection(db, "commissionLedger"),
      where("projectId", "==", pid)
    )
  );

  return snap.docs
    .map(item => ({ entryId: item.id, ...item.data() }))
    .filter(entry =>
      entry.sourceType === "project_order" &&
      entry.status === "earned" &&
      !entry.paidAt &&
      !entry.settlementId
    )
    .sort((a, b) => toMillis(a.createdAt || a.earnedAt) - toMillis(b.createdAt || b.earnedAt));
}

export async function createProjectCommissionSettlement({
  projectId,
  adminUid,
  note = ""
}) {
  const pid = clean(projectId);
  const uid = clean(adminUid);
  if (!pid || !uid) throw new Error("SETTLEMENT_FIELDS_REQUIRED");

  const outstanding = await listProjectOutstandingCommissionEntries(pid);
  if (!outstanding.length) throw new Error("NO_OUTSTANDING_COMMISSIONS");

  const selected = outstanding.slice(0, SETTLEMENT_ENTRY_LIMIT);
  const settlementRef = doc(collection(db, "commissionSettlements"));
  const projectRef = doc(db, "projects", pid);

  await runTransaction(db, async transaction => {
    const projectSnap = await transaction.get(projectRef);
    if (!projectSnap.exists()) throw new Error("PROJECT_NOT_FOUND");
    const project = projectSnap.data();

    const freshEntries = [];
    for (const entry of selected) {
      const entryRef = doc(db, "commissionLedger", entry.entryId);
      const snap = await transaction.get(entryRef);
      if (!snap.exists()) throw new Error("COMMISSION_ENTRY_NOT_FOUND");
      const data = snap.data();

      if (
        data.projectId !== pid ||
        data.sourceType !== "project_order" ||
        data.status !== "earned" ||
        data.paidAt ||
        data.settlementId
      ) {
        throw new Error("COMMISSION_ENTRY_NO_LONGER_OUTSTANDING");
      }

      freshEntries.push({
        ref: entryRef,
        entryId: snap.id,
        orderId: data.orderId || data.sourceId || "",
        amount: money(data.amount)
      });
    }

    const amount = money(freshEntries.reduce((sum, entry) => sum + entry.amount, 0));
    const createdAt = serverTimestamp();

    transaction.set(settlementRef, {
      settlementId: settlementRef.id,
      projectId: pid,
      ownerId: project.ownerId,
      operatorId: project.operatorId || "",
      templateId: project.template || project.projectId || "",
      businessName: project.businessName || "",
      currency: "EGP",
      status: "pending",
      entryIds: freshEntries.map(entry => entry.entryId),
      orderIds: freshEntries.map(entry => entry.orderId),
      entryCount: freshEntries.length,
      amount,
      note: clean(note).slice(0, 500),
      createdAt,
      createdBy: uid,
      updatedAt: createdAt,
      paidAt: null,
      paidBy: null,
      paymentMethod: "",
      paymentReference: "",
      voidAt: null,
      voidBy: null
    });

    for (const entry of freshEntries) {
      transaction.update(entry.ref, {
        settlementId: settlementRef.id,
        settlementStatus: "pending",
        settlementCreatedAt: createdAt
      });
    }
  });

  return {
    settlementId: settlementRef.id,
    entryCount: selected.length,
    hasMore: outstanding.length > selected.length
  };
}

export async function markCommissionSettlementPaid({
  settlementId,
  adminUid,
  paymentMethod,
  paymentReference = ""
}) {
  const sid = clean(settlementId);
  const uid = clean(adminUid);
  const method = clean(paymentMethod);
  const reference = clean(paymentReference).slice(0, 200);

  if (!sid || !uid || !method) throw new Error("PAYMENT_FIELDS_REQUIRED");

  const settlementRef = doc(db, "commissionSettlements", sid);

  await runTransaction(db, async transaction => {
    const settlementSnap = await transaction.get(settlementRef);
    if (!settlementSnap.exists()) throw new Error("SETTLEMENT_NOT_FOUND");

    const settlement = settlementSnap.data();
    if (settlement.status !== "pending") throw new Error("SETTLEMENT_NOT_PENDING");

    const entryIds = Array.isArray(settlement.entryIds) ? settlement.entryIds : [];
    if (!entryIds.length) throw new Error("SETTLEMENT_ENTRIES_MISSING");

    const entries = [];
    for (const entryId of entryIds) {
      const entryRef = doc(db, "commissionLedger", entryId);
      const entrySnap = await transaction.get(entryRef);
      if (!entrySnap.exists()) throw new Error("COMMISSION_ENTRY_NOT_FOUND");
      const entry = entrySnap.data();

      if (
        entry.settlementId !== sid ||
        entry.projectId !== settlement.projectId ||
        entry.status !== "earned"
      ) {
        throw new Error("SETTLEMENT_ENTRY_MISMATCH");
      }

      entries.push({ ref: entryRef, amount: money(entry.amount) });
    }

    const ledgerTotal = money(entries.reduce((sum, entry) => sum + entry.amount, 0));
    if (ledgerTotal !== money(settlement.amount)) {
      throw new Error("SETTLEMENT_TOTAL_MISMATCH");
    }

    const paidAt = serverTimestamp();

    transaction.update(settlementRef, {
      status: "paid",
      paidAt,
      paidBy: uid,
      paymentMethod: method.slice(0, 80),
      paymentReference: reference,
      updatedAt: paidAt
    });

    for (const entry of entries) {
      transaction.update(entry.ref, {
        status: "paid",
        paidAt,
        settlementStatus: "paid"
      });
    }
  });
}

export async function voidCommissionSettlement({
  settlementId,
  adminUid,
  note = ""
}) {
  const sid = clean(settlementId);
  const uid = clean(adminUid);
  if (!sid || !uid) throw new Error("SETTLEMENT_FIELDS_REQUIRED");

  const settlementRef = doc(db, "commissionSettlements", sid);

  await runTransaction(db, async transaction => {
    const settlementSnap = await transaction.get(settlementRef);
    if (!settlementSnap.exists()) throw new Error("SETTLEMENT_NOT_FOUND");

    const settlement = settlementSnap.data();
    if (settlement.status !== "pending") throw new Error("SETTLEMENT_NOT_PENDING");

    const entryIds = Array.isArray(settlement.entryIds) ? settlement.entryIds : [];
    const entries = [];

    for (const entryId of entryIds) {
      const entryRef = doc(db, "commissionLedger", entryId);
      const entrySnap = await transaction.get(entryRef);
      if (!entrySnap.exists()) continue;
      entries.push({ ref: entryRef, data: entrySnap.data() });
    }

    const voidAt = serverTimestamp();

    transaction.update(settlementRef, {
      status: "void",
      voidAt,
      voidBy: uid,
      note: clean(note || settlement.note).slice(0, 500),
      updatedAt: voidAt
    });

    for (const entry of entries) {
      if (entry.data.settlementId !== sid || entry.data.status === "paid") continue;
      transaction.update(entry.ref, {
        settlementId: deleteField(),
        settlementStatus: deleteField(),
        settlementCreatedAt: deleteField()
      });
    }
  });
}

export async function listRecentCommissionSettlements({ pageSize = 100 } = {}) {
  const size = Math.max(1, Math.min(100, Number(pageSize) || 100));
  const snap = await getDocs(
    query(
      collection(db, "commissionSettlements"),
      orderBy("createdAt", "desc"),
      limit(size)
    )
  );

  return snap.docs.map(item => ({ settlementId: item.id, ...item.data() }));
}
