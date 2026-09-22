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

export function allowedNextSupermarketStatuses(status) {
  return STATUS_FLOW[status] || [];
}

export async function createSupermarketOrder({
  projectId,
  customerName,
  customerPhone,
  customerAddress,
  location = "",
  notes = "",
  cart = []
}) {
  const supermarketSnap = await getDoc(doc(db, "supermarkets", projectId));

  if (!supermarketSnap.exists()) throw new Error("SUPERMARKET_NOT_FOUND");

  const supermarket = supermarketSnap.data();

  if (supermarket.isAcceptingOrders !== true) {
    throw new Error("SUPERMARKET_NOT_ACCEPTING_ORDERS");
  }

  const productSnap = await getDocs(
    collection(db, "supermarkets", projectId, "products")
  );

  const available = new Map(
    productSnap.docs
      .map(item => ({ productId: item.id, ...item.data() }))
      .filter(item => item.isActive === true && item.inStock === true)
      .map(item => [item.productId, item])
  );

  const items = cart
    .map(line => {
      const product = available.get(line.productId);
      const quantity = Math.max(0, Math.min(99, Math.floor(Number(line.quantity || 0))));

      if (!product || quantity <= 0) return null;

      const unitPrice = money(product.price);
      return {
        productId: product.productId,
        name: product.name,
        quantity,
        unitPrice,
        subtotal: money(quantity * unitPrice)
      };
    })
    .filter(Boolean);

  if (!items.length) throw new Error("EMPTY_CART");
  if (items.length > 50) throw new Error("TOO_MANY_ORDER_LINES");
  if (!clean(customerName)) throw new Error("CUSTOMER_NAME_REQUIRED");
  if (!clean(customerPhone)) throw new Error("CUSTOMER_PHONE_REQUIRED");
  if (!clean(customerAddress)) throw new Error("CUSTOMER_ADDRESS_REQUIRED");

  const subtotal = money(items.reduce((sum, item) => sum + item.subtotal, 0));
  const deliveryFee = money(supermarket.deliveryFee || 0);
  const total = money(subtotal + deliveryFee);

  const ref = await addDoc(collection(db, "orders"), {
    projectId,
    providerId: projectId,
    templateType: "supermarket",
    serviceType: "supermarket_delivery",
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

  return {
    orderId: ref.id,
    subtotal,
    deliveryFee,
    total
  };
}

export async function acceptSupermarketOrder({
  projectId,
  orderId,
  actorUid
}) {
  const orderRef = doc(db, "orders", orderId);
  const [orderSnap, supermarketSnap, productsSnap] = await Promise.all([
    getDoc(orderRef),
    getDoc(doc(db, "supermarkets", projectId)),
    getDocs(collection(db, "supermarkets", projectId, "products"))
  ]);

  if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
  if (!supermarketSnap.exists()) throw new Error("SUPERMARKET_NOT_FOUND");

  const order = orderSnap.data();

  if (
    order.projectId !== projectId ||
    order.templateType !== "supermarket" ||
    order.status !== "new"
  ) {
    throw new Error("ORDER_NOT_ACCEPTABLE");
  }

  const catalog = new Map(
    productsSnap.docs
      .map(item => ({ productId: item.id, ...item.data() }))
      .filter(item => item.isActive === true && item.inStock === true)
      .map(item => [item.productId, item])
  );

  const items = (order.items || []).map(line => {
    const product = catalog.get(line.productId);
    const quantity = Math.max(0, Math.min(99, Math.floor(Number(line.quantity || 0))));

    if (!product || quantity <= 0) {
      throw new Error("ORDER_PRODUCT_UNAVAILABLE");
    }

    const unitPrice = money(product.price);

    return {
      productId: product.productId,
      name: product.name,
      quantity,
      unitPrice,
      subtotal: money(quantity * unitPrice)
    };
  });

  if (!items.length) throw new Error("EMPTY_CART");

  const subtotal = money(items.reduce((sum, item) => sum + item.subtotal, 0));
  const deliveryFee = money(supermarketSnap.data().deliveryFee || 0);
  const total = money(subtotal + deliveryFee);

  await updateDoc(orderRef, {
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

  return { subtotal, deliveryFee, total };
}

export async function listSupermarketOrders(projectId) {
  const snap = await getDocs(
    query(collection(db, "orders"), where("projectId", "==", projectId), where("templateType", "==", "supermarket"))
  );

  return snap.docs
    .map(item => ({ orderId: item.id, ...item.data() }))
    .filter(item => item.templateType === "supermarket")
    .sort((a, b) => {
      const at = a.createdAt?.seconds || 0;
      const bt = b.createdAt?.seconds || 0;
      return bt - at;
    });
}

export async function changeSupermarketOrderStatus({
  projectId,
  orderId,
  actorUid,
  nextStatus
}) {
  const orderRef = doc(db, "orders", orderId);
  const orderSnap = await getDoc(orderRef);

  if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");

  const order = orderSnap.data();

  if (order.projectId !== projectId || order.templateType !== "supermarket") {
    throw new Error("ORDER_PROJECT_MISMATCH");
  }

  if (!allowedNextSupermarketStatuses(order.status).includes(nextStatus)) {
    throw new Error("INVALID_STATUS_TRANSITION");
  }

  if (nextStatus === "accepted") {
    throw new Error("USE_ACCEPT_SUPERMARKET_ORDER");
  }

  if (nextStatus !== "delivered") {
    await updateDoc(orderRef, {
      status: nextStatus,
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: actorUid
    });
    return;
  }

  if (!order.assignedWorkerId) {
    throw new Error("RIDER_REQUIRED_BEFORE_DELIVERY");
  }

  const agreement = await getCommissionAgreement(projectId);
  const effectiveAmount = getEffectiveCommissionAmount(agreement || {});

  if (effectiveAmount == null) {
    throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");
  }

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

    if (freshOrder.projectId !== projectId || freshOrder.templateType !== "supermarket") {
      throw new Error("ORDER_PROJECT_MISMATCH");
    }

    if (!allowedNextSupermarketStatuses(freshOrder.status).includes("delivered")) {
      throw new Error("INVALID_STATUS_TRANSITION");
    }

    if (!freshOrder.assignedWorkerId) {
      throw new Error("RIDER_REQUIRED_BEFORE_DELIVERY");
    }

    if (amount == null) throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

    transaction.update(orderRef, {
      status: "delivered",
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: actorUid,
      deliveredAt: serverTimestamp(),
      commissionEligible: true,
      commissionLocked: true,
      commissionAmount: amount,
      commissionAgreementVersion: Number(freshAgreement.version || 1)
    });

    transaction.set(ledgerRef, {
      userId: freshAgreement.ownerId,
      projectId,
      orderId,
      sourceType: "project_order",
      sourceId: orderId,
      agreementId: projectId,
      agreementVersion: Number(freshAgreement.version || 1),
      amount,
      currency: "EGP",
      status: "earned",
      createdAt: serverTimestamp(),
      paidAt: null
    });
  });
}
