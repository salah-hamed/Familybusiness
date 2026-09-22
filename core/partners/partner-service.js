import db from "../firebase/firebase-db.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function getOperatorDocId(projectDocId) {
  return projectDocId;
}

export async function getOperator(projectDocId) {
  const ref = doc(db, "operators", getOperatorDocId(projectDocId));
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    operatorId: snap.id,
    ...snap.data()
  };
}

export async function createOperator({
  projectDocId,
  ownerId,
  templateId,
  name,
  contactName = "",
  phone = "",
  whatsapp = "",
  email = ""
}) {
  const operatorId = getOperatorDocId(projectDocId);
  const ref = doc(db, "operators", operatorId);
  const existing = await getDoc(ref);

  if (existing.exists()) {
    throw new Error("OPERATOR_ALREADY_EXISTS");
  }

  const payload = {
    operatorId,
    projectId: projectDocId,
    ownerId,
    templateId,
    name: String(name || "").trim(),
    contactName: String(contactName || "").trim(),
    phone: String(phone || "").trim(),
    whatsapp: String(whatsapp || "").trim(),
    email: String(email || "").trim().toLowerCase(),
    authUid: "",
    status: "pending_invite",
    agreementStatus: "not_proposed",
    isActive: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (!payload.name) {
    throw new Error("OPERATOR_NAME_REQUIRED");
  }

  await setDoc(ref, payload);

  return operatorId;
}

export async function updateOperatorContact(operatorId, updates = {}) {
  const allowed = {};

  if ("name" in updates) allowed.name = String(updates.name || "").trim();
  if ("contactName" in updates) allowed.contactName = String(updates.contactName || "").trim();
  if ("phone" in updates) allowed.phone = String(updates.phone || "").trim();
  if ("whatsapp" in updates) allowed.whatsapp = String(updates.whatsapp || "").trim();
  if ("email" in updates) allowed.email = String(updates.email || "").trim().toLowerCase();

  if (!Object.keys(allowed).length) return;

  allowed.updatedAt = serverTimestamp();

  await updateDoc(doc(db, "operators", operatorId), allowed);
}

export function operatorCanOperate(operator = {}) {
  return (
    operator.isActive === true &&
    operator.status === "active" &&
    operator.agreementStatus === "accepted"
  );
}
