import db from "../firebase/firebase-db.js";
import { getProjectPaymentSummary } from "./settlement-service.js";

import {
  collection,
  query,
  where,
  orderBy,
  startAfter,
  limit,
  getDocs,
  getAggregateFromServer,
  sum,
  count
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function normalizePageSize(value, fallback = 50) {
  return Math.max(1, Math.min(100, Number(value) || fallback));
}

export async function listUserCommissionLedgerPage(
  userId,
  { pageSize = 50, cursor = null } = {}
) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("USER_ID_REQUIRED");

  const size = normalizePageSize(pageSize, 50);
  const constraints = [
    where("userId", "==", uid),
    orderBy("createdAt", "desc")
  ];

  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(size));

  const snap = await getDocs(
    query(collection(db, "commissionLedger"), ...constraints)
  );

  return {
    entries: snap.docs.map(item => ({ entryId: item.id, ...item.data() })),
    nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === size
  };
}

async function aggregateLedger(queryRef) {
  const snap = await getAggregateFromServer(queryRef, {
    totalAmount: sum("amount"),
    entryCount: count()
  });

  return {
    totalAmount: Number(snap.data().totalAmount || 0),
    entryCount: Number(snap.data().entryCount || 0)
  };
}

export async function getUserEarningsSummary(userId) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("USER_ID_REQUIRED");

  const base = collection(db, "commissionLedger");

  const [all, projectOrders, referrals, reversedProjectOrders] = await Promise.all([
    aggregateLedger(query(base, where("userId", "==", uid))),
    aggregateLedger(query(
      base,
      where("userId", "==", uid),
      where("sourceType", "==", "project_order")
    )),
    aggregateLedger(query(
      base,
      where("userId", "==", uid),
      where("sourceType", "==", "referral")
    )),
    aggregateLedger(query(
      base,
      where("userId", "==", uid),
      where("sourceType", "==", "project_order"),
      where("status", "==", "reversed")
    ))
  ]);

  const netProjectOrderAmount = Math.max(
    0,
    projectOrders.totalAmount - reversedProjectOrders.totalAmount
  );
  const netProjectOrderCount = Math.max(
    0,
    projectOrders.entryCount - reversedProjectOrders.entryCount
  );

  return {
    totalAmount: Math.max(0, all.totalAmount - reversedProjectOrders.totalAmount),
    entryCount: Math.max(0, all.entryCount - reversedProjectOrders.entryCount),
    projectOrderAmount: netProjectOrderAmount,
    projectOrderCount: netProjectOrderCount,
    referralAmount: referrals.totalAmount,
    referralCount: referrals.entryCount
  };
}

export async function getProjectCommissionSummary(userId, projectId) {
  const uid = String(userId || "").trim();
  const pid = String(projectId || "").trim();
  if (!uid) throw new Error("USER_ID_REQUIRED");
  if (!pid) throw new Error("PROJECT_ID_REQUIRED");

  const summary = await getProjectPaymentSummary(pid, { ownerId: uid });

  return {
    completedOrderCount: summary.earnedCount,
    earnedAmount: summary.earnedAmount,
    paidAmount: summary.paidAmount,
    outstandingAmount: summary.outstandingAmount,
    pendingPaymentAmount: summary.pendingAmount,
    pendingPaymentCount: summary.pendingCount
  };
}
