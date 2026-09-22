import db from "../firebase/firebase-db.js";
import { createOperator, getOperator, updateOperatorContact } from "../partners/partner-service.js";
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

export async function getSupermarket(projectId) {
  const snap = await getDoc(doc(db, "supermarkets", projectId));
  if (!snap.exists()) return null;
  return { supermarketId: snap.id, ...snap.data() };
}

export async function createOrResumeSupermarketSetup({
  projectId,
  ownerId,
  name,
  contactName = "",
  phone = "",
  whatsapp = "",
  email,
  address = "",
  location = "",
  deliveryFee = 0,
  commissionAmount
}) {
  const projectSnap = await getDoc(doc(db, "projects", projectId));

  if (!projectSnap.exists()) throw new Error("PROJECT_NOT_FOUND");

  const project = projectSnap.data();

  if (
    project.ownerId !== ownerId ||
    project.template !== "supermarket" ||
    project.operatingModel !== "partner_operated"
  ) {
    throw new Error("SUPERMARKET_PROJECT_MISMATCH");
  }

  let operator = await getOperator(projectId);

  if (!operator) {
    await createOperator({
      projectDocId: projectId,
      ownerId,
      templateId: "supermarket",
      name,
      contactName,
      phone,
      whatsapp,
      email
    });
    operator = await getOperator(projectId);
  } else {
    await updateOperatorContact(projectId, {
      name,
      contactName,
      phone,
      whatsapp,
      email
    });
  }

  const supermarketRef = doc(db, "supermarkets", projectId);
  const supermarketSnap = await getDoc(supermarketRef);
  const supermarketPayload = {
    supermarketId: projectId,
    projectId,
    ownerId,
    operatorId: projectId,
    name: clean(name),
    contactName: clean(contactName),
    phone: clean(phone),
    whatsapp: clean(whatsapp || phone),
    email: clean(email).toLowerCase(),
    address: clean(address),
    location: clean(location),
    deliveryFee: numberOrZero(deliveryFee),
    currency: "EGP",
    isAcceptingOrders: true,
    updatedAt: serverTimestamp()
  };

  if (!supermarketSnap.exists()) {
    supermarketPayload.createdAt = serverTimestamp();
  }

  await setDoc(supermarketRef, supermarketPayload, { merge: true });

  await proposeCommission({
    projectDocId: projectId,
    ownerId,
    operatorId: projectId,
    templateId: "supermarket",
    amount: commissionAmount
  });

  return {
    operator: await getOperator(projectId),
    agreement: await getCommissionAgreement(projectId),
    supermarket: await getSupermarket(projectId)
  };
}

export async function updateSupermarketSettings(projectId, updates = {}) {
  const next = {};

  if ("name" in updates) next.name = clean(updates.name);
  if ("contactName" in updates) next.contactName = clean(updates.contactName);
  if ("phone" in updates) next.phone = clean(updates.phone);
  if ("whatsapp" in updates) next.whatsapp = clean(updates.whatsapp);
  if ("address" in updates) next.address = clean(updates.address);
  if ("location" in updates) next.location = clean(updates.location);
  if ("deliveryFee" in updates) next.deliveryFee = numberOrZero(updates.deliveryFee);
  if ("isAcceptingOrders" in updates) next.isAcceptingOrders = updates.isAcceptingOrders === true;

  if (!Object.keys(next).length) return;

  next.updatedAt = serverTimestamp();

  await updateDoc(doc(db, "supermarkets", projectId), next);
}

export async function getSupermarketProjectBundle(projectId) {
  const [projectSnap, supermarket, operator, agreement] = await Promise.all([
    getDoc(doc(db, "projects", projectId)),
    getSupermarket(projectId),
    getOperator(projectId),
    getCommissionAgreement(projectId)
  ]);

  return {
    project: projectSnap.exists() ? { projectDocId: projectSnap.id, ...projectSnap.data() } : null,
    supermarket,
    operator,
    agreement
  };
}
