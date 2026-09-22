import db from "../firebase/firebase-db.js";

import {
  doc,
  getDoc,
  runTransaction,
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
  const operatorRef = doc(db, "operators", operatorId);
  const projectRef = doc(db, "projects", projectDocId);
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedName) {
    throw new Error("OPERATOR_NAME_REQUIRED");
  }

  if (!normalizedEmail) {
    throw new Error("OPERATOR_EMAIL_REQUIRED");
  }

  await runTransaction(db, async (transaction) => {
    const projectSnap = await transaction.get(projectRef);
    const operatorSnap = await transaction.get(operatorRef);

    if (!projectSnap.exists()) {
      throw new Error("PROJECT_NOT_FOUND");
    }

    if (operatorSnap.exists()) {
      throw new Error("OPERATOR_ALREADY_EXISTS");
    }

    const project = projectSnap.data();

    if (
      project.ownerId !== ownerId ||
      project.template !== templateId ||
      project.operatingModel !== "partner_operated"
    ) {
      throw new Error("PARTNER_PROJECT_MISMATCH");
    }

    transaction.set(operatorRef, {
      operatorId,
      projectId: projectDocId,
      ownerId,
      templateId,
      name: normalizedName,
      contactName: String(contactName || "").trim(),
      phone: String(phone || "").trim(),
      whatsapp: String(whatsapp || "").trim(),
      email: normalizedEmail,
      authUid: "",
      status: "pending_invite",
      agreementStatus: "not_proposed",
      isActive: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(projectRef, {
      operatorId,
      partnerSetupStatus: "partner_linked"
    });
  });

  return operatorId;
}

export async function updateOperatorContact(operatorId, updates = {}) {
  const operatorRef = doc(db, "operators", operatorId);
  const operatorSnap = await getDoc(operatorRef);

  if (!operatorSnap.exists()) {
    throw new Error("OPERATOR_NOT_FOUND");
  }

  const operator = operatorSnap.data();
  const allowed = {};

  if ("name" in updates) allowed.name = String(updates.name || "").trim();
  if ("contactName" in updates) allowed.contactName = String(updates.contactName || "").trim();
  if ("phone" in updates) allowed.phone = String(updates.phone || "").trim();
  if ("whatsapp" in updates) allowed.whatsapp = String(updates.whatsapp || "").trim();

  if ("email" in updates) {
    const email = String(updates.email || "").trim().toLowerCase();

    if (operator.authUid && email !== String(operator.email || "").trim().toLowerCase()) {
      throw new Error("OPERATOR_EMAIL_LOCKED");
    }

    allowed.email = email;
  }

  if (!Object.keys(allowed).length) return;

  allowed.updatedAt = serverTimestamp();

  await updateDoc(operatorRef, allowed);
}

export async function claimOperatorAccess(operatorId, authUser) {
  if (!authUser?.uid || !authUser?.email || authUser.emailVerified !== true) {
    throw new Error("VERIFIED_OPERATOR_EMAIL_REQUIRED");
  }

  const operatorRef = doc(db, "operators", operatorId);
  const operatorSnap = await getDoc(operatorRef);

  if (!operatorSnap.exists()) {
    throw new Error("OPERATOR_NOT_FOUND");
  }

  const operator = operatorSnap.data();

  if (
    String(operator.email || "").trim().toLowerCase() !==
    String(authUser.email).trim().toLowerCase()
  ) {
    throw new Error("OPERATOR_EMAIL_MISMATCH");
  }

  if (operator.authUid && operator.authUid !== authUser.uid) {
    throw new Error("OPERATOR_ALREADY_CLAIMED");
  }

  await updateDoc(operatorRef, {
    authUid: authUser.uid,
    status: operator.agreementStatus === "accepted" ? "active" : "pending_agreement",
    updatedAt: serverTimestamp()
  });
}

export function operatorCanOperate(operator = {}) {
  return (
    operator.isActive === true &&
    operator.status === "active" &&
    operator.agreementStatus === "accepted"
  );
}
