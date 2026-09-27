import db from "../firebase/firebase-db.js";
import { getCommissionAgreement, getEffectiveCommissionAmount } from "../commissions/commission-service.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  onSnapshot,
  updateDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const STATUS_FLOW = Object.freeze({
  new: ["accepted", "canceled"],
  accepted: ["preparing", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["assigned", "canceled"],
  assigned: ["out_for_delivery", "canceled"],
  out_for_delivery: ["delivered", "canceled"],
  delivered: [],
  canceled: []
});

function clean(value) {
  return String(value || "").trim();
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_MONEY_VALUE");
  return Math.round(n * 100) / 100;
}

function randomTrackingToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

function trackingRef(token) {
  return doc(db, "orderTracking", token);
}

function trackingPatchFromOrder(order = {}, overrides = {}) {
  return {
    status: overrides.status ?? order.status,
    items: overrides.items ?? order.items ?? [],
    subtotal: overrides.subtotal ?? order.subtotal ?? 0,
    deliveryFee: overrides.deliveryFee ?? order.deliveryFee ?? 0,
    total: overrides.total ?? order.total ?? order.price ?? 0,
    updatedAt: serverTimestamp()
  };
}

export function allowedNextRestaurantStatuses(status) {
  return STATUS_FLOW[status] || [];
}

function normalizeRequestedLines(lines = []) {
  const merged = new Map();

  for (const line of lines) {
    const itemId = clean(line?.itemId);
    const quantity = Math.floor(Number(line?.quantity || 0));
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) continue;
    merged.set(itemId, Math.min(99, (merged.get(itemId) || 0) + quantity));
  }

  const normalized = [...merged.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
  if (normalized.length > 50) throw new Error("TOO_MANY_ORDER_LINES");
  return normalized;
}

async function loadRequestedMenu(projectId, lines = []) {
  const ids = [...new Set(lines.map(line => clean(line?.itemId)).filter(Boolean))];
  if (!ids.length) return new Map();
  if (ids.length > 50) throw new Error("TOO_MANY_ORDER_LINES");

  const snaps = await Promise.all(
    ids.map(itemId => getDoc(doc(db, "restaurants", projectId, "menu", itemId)))
  );

  return new Map(
    snaps
      .filter(snap => snap.exists())
      .map(snap => ({ itemId: snap.id, ...snap.data() }))
      .filter(item => item.isActive === true && item.isAvailable === true)
      .map(item => [item.itemId, item])
  );
}

export async function createRestaurantOrder({
  projectId,
  templateType = "restaurant",
  customerName,
  customerPhone,
  customerAddress,
  location = "",
  notes = "",
  cart = []
}) {
  if (!["restaurant","bakery"].includes(templateType)) {
    throw new Error("FOOD_TEMPLATE_NOT_SUPPORTED");
  }

  const restaurantSnap = await getDoc(doc(db, "restaurants", projectId));
  if (!restaurantSnap.exists()) throw new Error("RESTAURANT_NOT_FOUND");

  const restaurant = restaurantSnap.data();
  if (restaurant.isAcceptingOrders !== true) throw new Error("RESTAURANT_NOT_ACCEPTING_ORDERS");

  const requestedLines = normalizeRequestedLines(cart);
  const available = await loadRequestedMenu(projectId, requestedLines);

  const items = requestedLines.map(line => {
    const item = available.get(line.itemId);
    const quantity = Math.max(0, Math.min(99, Math.floor(Number(line.quantity || 0))));
    if (!item || quantity <= 0) return null;
    const unitPrice = money(item.price);
    return {
      itemId: item.itemId,
      name: item.name,
      unit: clean(item.unit || "قطعة"),
      quantity,
      unitPrice,
      subtotal: money(quantity * unitPrice)
    };
  }).filter(Boolean);

  if (!items.length) throw new Error("EMPTY_CART");
  if (!clean(customerName)) throw new Error("CUSTOMER_NAME_REQUIRED");
  if (!clean(customerPhone)) throw new Error("CUSTOMER_PHONE_REQUIRED");
  if (!clean(customerAddress)) throw new Error("CUSTOMER_ADDRESS_REQUIRED");

  if (items.length !== requestedLines.length) {
    throw new Error("ORDER_ITEM_UNAVAILABLE");
  }

  const subtotal = money(items.reduce((sum,item) => sum + item.subtotal, 0));
  const deliveryFee = money(restaurant.deliveryFee || 0);
  const total = money(subtotal + deliveryFee);
  const trackingToken = randomTrackingToken();

  const orderRef = doc(collection(db, "orders"));
  const publicTrackingRef = trackingRef(trackingToken);
  const batch = writeBatch(db);

  batch.set(orderRef, {
    projectId,
    providerId: projectId,
    templateType,
    serviceType: templateType === "bakery" ? "bakery_delivery" : "restaurant_delivery",
    status: "new",
    customerName: clean(customerName),
    customerPhone: clean(customerPhone),
    customerAddress: clean(customerAddress),
    location: clean(location),
    notes: clean(notes),
    items,
    subtotal,
    deliveryFee,
    total,
    price: total,
    pricingLocked: false,
    commissionEligible: false,
    commissionLocked: false,
    commissionAmount: 0,
    trackingToken,
    createdAt: serverTimestamp()
  });

  batch.set(publicTrackingRef, {
    trackingToken,
    orderId: orderRef.id,
    projectId,
    templateType,
    status: "new",
    items,
    subtotal,
    deliveryFee,
    total,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  let trackingEnabled = true;

  try {
    await batch.commit();
  } catch (error) {
    const code = String(error?.code || "");
    if (!code.includes("permission-denied")) throw error;

    const legacyBatch = writeBatch(db);
    legacyBatch.set(orderRef, {
      projectId,
      providerId: projectId,
      templateType,
      serviceType: templateType === "bakery" ? "bakery_delivery" : "restaurant_delivery",
      status: "new",
      customerName: clean(customerName),
      customerPhone: clean(customerPhone),
      customerAddress: clean(customerAddress),
      location: clean(location),
      notes: clean(notes),
      items,
      subtotal,
      deliveryFee,
      total,
      price: total,
      pricingLocked: false,
      commissionEligible: false,
      commissionLocked: false,
      commissionAmount: 0,
      createdAt: serverTimestamp()
    });
    await legacyBatch.commit();
    trackingEnabled = false;
  }

  return {
    orderId: orderRef.id,
    trackingToken: trackingEnabled ? trackingToken : "",
    trackingEnabled,
    subtotal,
    deliveryFee,
    total
  };
}

export async function acceptRestaurantOrder({ projectId, orderId, actorUid, templateType = "restaurant" }) {
  const orderRef = doc(db, "orders", orderId);
  const [orderSnap, restaurantSnap] = await Promise.all([
    getDoc(orderRef),
    getDoc(doc(db, "restaurants", projectId))
  ]);

  if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
  if (!restaurantSnap.exists()) throw new Error("RESTAURANT_NOT_FOUND");

  const order = orderSnap.data();

  if (
    order.projectId !== projectId ||
    order.templateType !== templateType ||
    order.status !== "new"
  ) {
    throw new Error("ORDER_NOT_ACCEPTABLE");
  }

  const requestedLines = normalizeRequestedLines(order.items || []);
  const menu = await loadRequestedMenu(projectId, requestedLines);

  const items = requestedLines.map(line => {
    const item = menu.get(line.itemId);
    const quantity = Math.max(0, Math.min(99, Math.floor(Number(line.quantity || 0))));
    if (!item || quantity <= 0) throw new Error("ORDER_ITEM_UNAVAILABLE");
    const unitPrice = money(item.price);
    return {
      itemId: item.itemId,
      name: item.name,
      unit: clean(item.unit || "قطعة"),
      quantity,
      unitPrice,
      subtotal: money(quantity * unitPrice)
    };
  });

  const subtotal = money(items.reduce((sum,item) => sum + item.subtotal, 0));
  const deliveryFee = money(restaurantSnap.data().deliveryFee || 0);
  const total = money(subtotal + deliveryFee);

  const batch = writeBatch(db);

  batch.update(orderRef, {
    items,
    subtotal,
    deliveryFee,
    total,
    price: total,
    pricingLocked: true,
    pricingLockedAt: serverTimestamp(),
    pricingLockedBy: actorUid,
    status: "accepted",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: actorUid
  });

  if (order.trackingToken) {
    batch.update(trackingRef(order.trackingToken), trackingPatchFromOrder(order, {
      status: "accepted",
      items,
      subtotal,
      deliveryFee,
      total
    }));
  }

  await batch.commit();

  return { subtotal, deliveryFee, total };
}

export async function listRestaurantOrders(projectId, { pageSize = 50, templateType = "restaurant" } = {}) {
  const snap = await getDocs(
    query(
      collection(db, "orders"),
      where("projectId", "==", projectId),
      where("templateType", "==", templateType),
      limit(Math.max(1, Math.min(100, Number(pageSize) || 50)))
    )
  );

  return snap.docs
    .map(item => ({ orderId: item.id, ...item.data() }))
    .sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function getRestaurantOrderTracking(trackingToken, templateType = "restaurant") {
  const token = clean(trackingToken);
  if (!token) return null;

  const snap = await getDoc(trackingRef(token));
  if (!snap.exists()) return null;

  const data = snap.data();
  if (data.templateType !== templateType) return null;

  return { trackingToken: token, ...data };
}

export function subscribeRestaurantOrderTracking(trackingToken, onChange, onError = null, templateType = "restaurant") {
  const token = clean(trackingToken);
  if (!token) return () => {};

  return onSnapshot(
    trackingRef(token),
    snap => {
      if (!snap.exists()) return onChange?.(null);
      const data = { trackingToken: token, ...snap.data() };
      onChange?.(data.templateType === templateType ? data : null);
    },
    error => onError?.(error)
  );
}

export async function changeRestaurantOrderStatus({ projectId, orderId, actorUid, nextStatus, templateType = "restaurant" }) {
  const orderRef = doc(db, "orders", orderId);
  const orderSnap = await getDoc(orderRef);

  if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");

  const order = orderSnap.data();

  if (order.projectId !== projectId || order.templateType !== templateType) {
    throw new Error("ORDER_PROJECT_MISMATCH");
  }

  if (!allowedNextRestaurantStatuses(order.status).includes(nextStatus)) {
    throw new Error("INVALID_STATUS_TRANSITION");
  }

  if (nextStatus === "accepted") throw new Error("USE_ACCEPT_RESTAURANT_ORDER");

  if (nextStatus !== "delivered") {
    const batch = writeBatch(db);

    batch.update(orderRef, {
      status: nextStatus,
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: actorUid
    });

    if (order.trackingToken) {
      batch.update(trackingRef(order.trackingToken), trackingPatchFromOrder(order, {
        status: nextStatus
      }));
    }

    await batch.commit();
    return;
  }

  if (!order.assignedWorkerId) throw new Error("RIDER_REQUIRED_BEFORE_DELIVERY");

  const agreement = await getCommissionAgreement(projectId);
  const effectiveAmount = getEffectiveCommissionAmount(agreement || {});
  if (effectiveAmount == null) throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

  const ledgerRef = doc(db, "commissionLedger", `project_order_${orderId}`);
  const agreementRef = doc(db, "commissionAgreements", projectId);

  await runTransaction(db, async transaction => {
    const freshOrderSnap = await transaction.get(orderRef);
    const agreementSnap = await transaction.get(agreementRef);

    if (!freshOrderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
    if (!agreementSnap.exists()) throw new Error("AGREEMENT_NOT_FOUND");

    const freshOrder = freshOrderSnap.data();
    const freshAgreement = agreementSnap.data();
    const amount = getEffectiveCommissionAmount(freshAgreement);

    if (freshOrder.projectId !== projectId || freshOrder.templateType !== templateType) {
      throw new Error("ORDER_PROJECT_MISMATCH");
    }
    if (!allowedNextRestaurantStatuses(freshOrder.status).includes("delivered")) {
      throw new Error("INVALID_STATUS_TRANSITION");
    }
    if (!freshOrder.assignedWorkerId) throw new Error("RIDER_REQUIRED_BEFORE_DELIVERY");
    if (amount == null) throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

    transaction.update(orderRef, {
      status: "delivered",
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: actorUid,
      deliveredAt: serverTimestamp(),
      commissionEligible: true,
      commissionLocked: true,
      commissionAmount: amount,
      commissionAgreementVersion: Number(freshAgreement.acceptedVersion || freshAgreement.version || 1)
    });

    if (freshOrder.trackingToken) {
      transaction.update(trackingRef(freshOrder.trackingToken), {
        ...trackingPatchFromOrder(freshOrder, { status: "delivered" }),
        deliveredAt: serverTimestamp()
      });
    }

    transaction.set(ledgerRef, {
      userId: freshAgreement.ownerId,
      projectId,
      orderId,
      sourceType: "project_order",
      sourceId: orderId,
      agreementId: projectId,
      agreementVersion: Number(freshAgreement.acceptedVersion || freshAgreement.version || 1),
      amount,
      currency: "EGP",
      status: "earned",
      earnedAt: serverTimestamp(),
      paidAt: null
    });
  });
}
