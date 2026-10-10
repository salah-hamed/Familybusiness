import db from "../firebase/firebase-db.js";
import { getCommissionAgreement, getEffectiveCommissionSnapshot, getProjectCommissionLedgerId } from "../commissions/commission-service.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  startAfter,
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


function isMissingCompositeIndexError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("failed-precondition") && message.includes("index");
}

function orderCreatedAtMillis(docSnap) {
  const value = docSnap.data()?.createdAt;
  if (typeof value?.toMillis === "function") return value.toMillis();
  return Number(value?.seconds || 0) * 1000;
}

async function loadProjectOrderDocsWithoutCompositeIndex(projectId, templateType) {
  const snap = await getDocs(
    query(
      collection(db, "orders"),
      where("projectId", "==", projectId),
      where("templateType", "==", templateType)
    )
  );

  return snap.docs
    .filter(item => item.data().templateType === templateType)
    .sort((a, b) => orderCreatedAtMillis(b) - orderCreatedAtMillis(a));
}

function fallbackPageFromDocs(docs, { size, cursor = null, statuses = null } = {}) {
  const filtered = statuses
    ? docs.filter(item => statuses.includes(item.data().status))
    : docs;

  const cursorIndex = cursor
    ? filtered.findIndex(item => item.id === cursor.id)
    : -1;
  const start = cursor ? (cursorIndex >= 0 ? cursorIndex + 1 : filtered.length) : 0;
  const pageDocs = filtered.slice(start, start + size);

  return {
    orders: pageDocs.map(item => ({ orderId: item.id, ...item.data() })),
    nextCursor: pageDocs.length ? pageDocs[pageDocs.length - 1] : null,
    hasMore: start + pageDocs.length < filtered.length
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

export async function listRestaurantOrdersPage(
  projectId,
  { pageSize = 50, templateType = "restaurant", cursor = null } = {}
) {
  const size = Math.max(1, Math.min(100, Number(pageSize) || 50));
  const constraints = [
    where("projectId", "==", projectId),
    where("templateType", "==", templateType),
    orderBy("createdAt", "desc")
  ];

  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(size));

  try {
    const snap = await getDocs(query(collection(db, "orders"), ...constraints));

    return {
      orders: snap.docs.map(item => ({ orderId: item.id, ...item.data() })),
      nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length === size
    };
  } catch (error) {
    if (!isMissingCompositeIndexError(error)) throw error;
    const docs = await loadProjectOrderDocsWithoutCompositeIndex(projectId, templateType);
    return fallbackPageFromDocs(docs, { size, cursor });
  }
}

export async function listRestaurantOperationalOrders(
  projectId,
  { templateType = "restaurant" } = {}
) {
  const activeStatuses = ["new","accepted","preparing","ready","assigned","out_for_delivery"];

  try {
    const snap = await getDocs(
      query(
        collection(db, "orders"),
        where("projectId", "==", projectId),
        where("templateType", "==", templateType),
        where("status", "in", activeStatuses),
        orderBy("createdAt", "desc")
      )
    );

    return snap.docs.map(item => ({ orderId: item.id, ...item.data() }));
  } catch (error) {
    if (!isMissingCompositeIndexError(error)) throw error;
    const docs = await loadProjectOrderDocsWithoutCompositeIndex(projectId, templateType);
    return docs
      .filter(item => activeStatuses.includes(item.data().status))
      .map(item => ({ orderId: item.id, ...item.data() }));
  }
}

export function subscribeRestaurantOperationalOrders(
  projectId,
  onChange,
  onError = null,
  { templateType = "restaurant" } = {}
) {
  const activeStatuses = ["new","accepted","preparing","ready","assigned","out_for_delivery"];
  const liveQuery = query(
    collection(db, "orders"),
    where("projectId", "==", projectId),
    where("templateType", "==", templateType),
    where("status", "in", activeStatuses),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    liveQuery,
    snap => onChange?.(snap.docs.map(item => ({ orderId: item.id, ...item.data() }))),
    error => onError?.(error)
  );
}

export async function listRestaurantHistoryPage(
  projectId,
  { pageSize = 50, templateType = "restaurant", cursor = null } = {}
) {
  const size = Math.max(1, Math.min(100, Number(pageSize) || 50));
  const historyStatuses = ["delivered","canceled"];
  const constraints = [
    where("projectId", "==", projectId),
    where("templateType", "==", templateType),
    where("status", "in", historyStatuses),
    orderBy("createdAt", "desc")
  ];

  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(size));

  try {
    const snap = await getDocs(query(collection(db, "orders"), ...constraints));

    return {
      orders: snap.docs.map(item => ({ orderId: item.id, ...item.data() })),
      nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length === size
    };
  } catch (error) {
    if (!isMissingCompositeIndexError(error)) throw error;
    const docs = await loadProjectOrderDocsWithoutCompositeIndex(projectId, templateType);
    return fallbackPageFromDocs(docs, { size, cursor, statuses: historyStatuses });
  }
}

export async function countRestaurantDeliveredOrders(
  projectId,
  { templateType = "restaurant" } = {}
) {
  try {
    const snap = await getCountFromServer(
      query(
        collection(db, "orders"),
        where("projectId", "==", projectId),
        where("templateType", "==", templateType),
        where("status", "==", "delivered")
      )
    );
    return snap.data().count;
  } catch (error) {
    if (!isMissingCompositeIndexError(error)) throw error;
    const docs = await loadProjectOrderDocsWithoutCompositeIndex(projectId, templateType);
    return docs.filter(item => item.data().status === "delivered").length;
  }
}

export async function listRestaurantOrders(projectId, options = {}) {
  const all = [];
  let cursor = options.cursor || null;

  while (true) {
    const page = await listRestaurantOrdersPage(projectId, {
      ...options,
      cursor
    });

    all.push(...page.orders);

    if (!page.hasMore || !page.nextCursor) {
      break;
    }

    if (cursor && page.nextCursor.id === cursor.id) {
      throw new Error("ORDER_PAGINATION_STALLED");
    }

    cursor = page.nextCursor;
  }

  return all;
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

  if (nextStatus === "assigned") {
    if (!order.assignedWorkerId) throw new Error("RIDER_REQUIRED_BEFORE_ASSIGNMENT");

    const agreementRef = doc(db, "commissionAgreements", projectId);
    const ledgerRef = doc(db, "commissionLedger", getProjectCommissionLedgerId(orderId));

    try {
      await runTransaction(db, async transaction => {
        const freshOrderSnap = await transaction.get(orderRef);
        const agreementSnap = await transaction.get(agreementRef);

        if (!freshOrderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
        if (!agreementSnap.exists()) throw new Error("AGREEMENT_NOT_FOUND");

        const freshOrder = freshOrderSnap.data();
        const commission = getEffectiveCommissionSnapshot(agreementSnap.data());

        if (freshOrder.projectId !== projectId || freshOrder.templateType !== templateType) {
          throw new Error("ORDER_PROJECT_MISMATCH");
        }

        if (freshOrder.status !== "ready" || !freshOrder.assignedWorkerId) {
          throw new Error("ORDER_NOT_READY_FOR_DELIVERY_ASSIGNMENT");
        }

        if (!commission) throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

        const earnedAt = serverTimestamp();

        transaction.update(orderRef, {
          status: "assigned",
          statusUpdatedAt: earnedAt,
          statusUpdatedBy: actorUid,
          commissionEligible: true,
          commissionLocked: true,
          commissionAmount: commission.amount,
          commissionAgreementVersion: commission.version,
          commissionTrigger: "delivery_assignment",
          commissionEarnedAt: earnedAt
        });

        if (freshOrder.trackingToken) {
          transaction.update(
            trackingRef(freshOrder.trackingToken),
            trackingPatchFromOrder(freshOrder, { status: "assigned" })
          );
        }

        transaction.set(ledgerRef, {
          userId: agreementSnap.data().ownerId,
          projectId,
          orderId,
          sourceType: "project_order",
          sourceId: orderId,
          agreementId: projectId,
          agreementVersion: commission.version,
          amount: commission.amount,
          currency: "EGP",
          status: "earned",
          trigger: "delivery_assignment",
          createdAt: earnedAt,
          earnedAt,
          paidAt: null
        });
      });

      return;
    } catch (error) {
      if (String(error?.code || "").toLowerCase() !== "permission-denied") {
        throw error;
      }

      // Production compatibility until the new Firestore Rules are deployed.
      const batch = writeBatch(db);
      batch.update(orderRef, {
        status: "assigned",
        statusUpdatedAt: serverTimestamp(),
        statusUpdatedBy: actorUid
      });

      if (order.trackingToken) {
        batch.update(trackingRef(order.trackingToken), trackingPatchFromOrder(order, {
          status: "assigned"
        }));
      }

      await batch.commit();
      return;
    }
  }

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

  if (order.commissionLocked === true) {
    const batch = writeBatch(db);
    batch.update(orderRef, {
      status: "delivered",
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: actorUid,
      deliveredAt: serverTimestamp()
    });

    if (order.trackingToken) {
      batch.update(trackingRef(order.trackingToken), {
        ...trackingPatchFromOrder(order, { status: "delivered" }),
        deliveredAt: serverTimestamp()
      });
    }

    await batch.commit();
    return;
  }

  // Legacy compatibility for orders already in flight before FB-LAUNCH01.
  const agreementRef = doc(db, "commissionAgreements", projectId);
  const ledgerRef = doc(db, "commissionLedger", getProjectCommissionLedgerId(orderId));

  await runTransaction(db, async transaction => {
    const freshOrderSnap = await transaction.get(orderRef);
    const agreementSnap = await transaction.get(agreementRef);

    if (!freshOrderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
    if (!agreementSnap.exists()) throw new Error("AGREEMENT_NOT_FOUND");

    const freshOrder = freshOrderSnap.data();
    const commission = getEffectiveCommissionSnapshot(agreementSnap.data());

    if (freshOrder.projectId !== projectId || freshOrder.templateType !== templateType) {
      throw new Error("ORDER_PROJECT_MISMATCH");
    }
    if (!allowedNextRestaurantStatuses(freshOrder.status).includes("delivered")) {
      throw new Error("INVALID_STATUS_TRANSITION");
    }
    if (!freshOrder.assignedWorkerId) throw new Error("RIDER_REQUIRED_BEFORE_DELIVERY");
    if (!commission) throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

    const earnedAt = serverTimestamp();

    transaction.update(orderRef, {
      status: "delivered",
      statusUpdatedAt: earnedAt,
      statusUpdatedBy: actorUid,
      deliveredAt: earnedAt,
      commissionEligible: true,
      commissionLocked: true,
      commissionAmount: commission.amount,
      commissionAgreementVersion: commission.version
    });

    if (freshOrder.trackingToken) {
      transaction.update(trackingRef(freshOrder.trackingToken), {
        ...trackingPatchFromOrder(freshOrder, { status: "delivered" }),
        deliveredAt: serverTimestamp()
      });
    }

    transaction.set(ledgerRef, {
      userId: agreementSnap.data().ownerId,
      projectId,
      orderId,
      sourceType: "project_order",
      sourceId: orderId,
      agreementId: projectId,
      agreementVersion: commission.version,
      amount: commission.amount,
      currency: "EGP",
      status: "earned",
      trigger: "legacy_delivery",
      createdAt: earnedAt,
      earnedAt,
      paidAt: null
    });
  });
}
