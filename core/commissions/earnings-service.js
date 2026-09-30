import db from "../firebase/firebase-db.js";

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

function normalizePageSize(value, fallback = 25) {
  return Math.max(1, Math.min(100, Number(value) || fallback));
}

export async function listUserCommissionLedgerPage(
  userId,
  { pageSize = 25, cursor = null } = {}
) {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("USER_ID_REQUIRED");

  const size = normalizePageSize(pageSize, 25);
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

  const [all, projectOrders, referrals] = await Promise.all([
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
    ))
  ]);

  return {
    totalAmount: all.totalAmount,
    entryCount: all.entryCount,
    projectOrderAmount: projectOrders.totalAmount,
    projectOrderCount: projectOrders.entryCount,
    referralAmount: referrals.totalAmount,
    referralCount: referrals.entryCount
  };
}
