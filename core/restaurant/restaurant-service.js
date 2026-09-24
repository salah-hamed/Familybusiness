import db from "../firebase/firebase-db.js";
import { createOperator, getOperator, updateOperatorContact, ensureOperatorInviteAccess } from "../partners/partner-service.js";
import { proposeCommission, getCommissionAgreement } from "../commissions/commission-service.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function clean(value) {
  return String(value || "").trim();
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function color(value) {
  const v = clean(value);
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#EA580C";
}

export async function getRestaurant(projectId) {
  const snap = await getDoc(doc(db, "restaurants", projectId));
  if (!snap.exists()) return null;
  return { restaurantId: snap.id, ...snap.data() };
}

export async function createOrResumeRestaurantSetup({
  projectId,
  ownerId,
  name,
  contactName = "",
  phone = "",
  whatsapp = "",
  address = "",
  location = "",
  cuisine = "",
  slogan = "",
  logo = "",
  coverImage = "",
  primaryColor = "#EA580C",
  deliveryFee = 0,
  commissionAmount
}) {
  const projectSnap = await getDoc(doc(db, "projects", projectId));

  if (!projectSnap.exists()) throw new Error("PROJECT_NOT_FOUND");

  const project = projectSnap.data();

  if (
    project.ownerId !== ownerId ||
    project.template !== "restaurant" ||
    project.operatingModel !== "partner_operated"
  ) {
    throw new Error("RESTAURANT_PROJECT_MISMATCH");
  }

  let operator = await getOperator(projectId);

  if (!operator) {
    await createOperator({
      projectDocId: projectId,
      ownerId,
      templateId: "restaurant",
      name,
      contactName,
      phone,
      whatsapp
    });
    operator = await getOperator(projectId);
  } else {
    await updateOperatorContact(projectId, {
      name,
      contactName,
      phone,
      whatsapp
    });
  }

  operator = await ensureOperatorInviteAccess(projectId, ownerId);

  const ref = doc(db, "restaurants", projectId);
  const snap = await getDoc(ref);
  const payload = {
    restaurantId: projectId,
    projectId,
    ownerId,
    operatorId: projectId,
    name: clean(name),
    contactName: clean(contactName),
    phone: clean(phone),
    whatsapp: clean(whatsapp || phone),
    address: clean(address),
    location: clean(location),
    cuisine: clean(cuisine),
    slogan: clean(slogan),
    logo: clean(logo),
    coverImage: clean(coverImage),
    primaryColor: color(primaryColor),
    deliveryFee: numberOrZero(deliveryFee),
    currency: "EGP",
    isAcceptingOrders: true,
    updatedAt: serverTimestamp()
  };

  if (!snap.exists()) payload.createdAt = serverTimestamp();

  await setDoc(ref, payload, { merge: true });

  await proposeCommission({
    projectDocId: projectId,
    ownerId,
    operatorId: projectId,
    templateId: "restaurant",
    amount: commissionAmount
  });

  return {
    operator: await getOperator(projectId),
    agreement: await getCommissionAgreement(projectId),
    restaurant: await getRestaurant(projectId)
  };
}

export async function updateRestaurantSettings(projectId, updates = {}) {
  const next = {};

  if ("name" in updates) next.name = clean(updates.name);
  if ("contactName" in updates) next.contactName = clean(updates.contactName);
  if ("phone" in updates) next.phone = clean(updates.phone);
  if ("whatsapp" in updates) next.whatsapp = clean(updates.whatsapp);
  if ("address" in updates) next.address = clean(updates.address);
  if ("location" in updates) next.location = clean(updates.location);
  if ("cuisine" in updates) next.cuisine = clean(updates.cuisine);
  if ("slogan" in updates) next.slogan = clean(updates.slogan);
  if ("logo" in updates) next.logo = clean(updates.logo);
  if ("coverImage" in updates) next.coverImage = clean(updates.coverImage);
  if ("primaryColor" in updates) next.primaryColor = color(updates.primaryColor);
  if ("deliveryFee" in updates) next.deliveryFee = numberOrZero(updates.deliveryFee);
  if ("isAcceptingOrders" in updates) next.isAcceptingOrders = updates.isAcceptingOrders === true;

  if (!Object.keys(next).length) return;

  next.updatedAt = serverTimestamp();
  await updateDoc(doc(db, "restaurants", projectId), next);
}

export async function getRestaurantProjectBundle(projectId) {
  const [projectSnap, restaurant, operator, agreement] = await Promise.all([
    getDoc(doc(db, "projects", projectId)),
    getRestaurant(projectId),
    getOperator(projectId),
    getCommissionAgreement(projectId)
  ]);

  return {
    project: projectSnap.exists() ? { projectDocId: projectSnap.id, ...projectSnap.data() } : null,
    restaurant,
    operator,
    agreement
  };
}
