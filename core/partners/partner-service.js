import db from "../firebase/firebase-db.js";

import {
  doc,
  getDoc,
  runTransaction,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const OPERATOR_AUTH_DOMAIN = "familybusiness.local";
const OPERATOR_AUTH_PREFIX = "operator.";

function createInviteToken() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function buildOperatorAuthEmail(inviteToken) {
  const token = String(inviteToken || "").trim().toLowerCase();
  if (!token) return "";
  return `${OPERATOR_AUTH_PREFIX}${token}@${OPERATOR_AUTH_DOMAIN}`;
}

export function getOperatorInviteToken(operator = {}) {
  const email = String(operator.authLoginEmail || "").trim().toLowerCase();
  const prefix = OPERATOR_AUTH_PREFIX;
  const suffix = `@${OPERATOR_AUTH_DOMAIN}`;

  if (!email.startsWith(prefix) || !email.endsWith(suffix)) return "";

  return email.slice(prefix.length, -suffix.length);
}

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
  whatsapp = ""
}) {
  const operatorId = getOperatorDocId(projectDocId);
  const operatorRef = doc(db, "operators", operatorId);
  const projectRef = doc(db, "projects", projectDocId);
  const normalizedName = String(name || "").trim();
  const normalizedWhatsapp = String(whatsapp || phone || "").trim();
  const inviteToken = createInviteToken();
  const authLoginEmail = buildOperatorAuthEmail(inviteToken);

  if (!normalizedName) {
    throw new Error("OPERATOR_NAME_REQUIRED");
  }

  if (!normalizedWhatsapp) {
    throw new Error("OPERATOR_WHATSAPP_REQUIRED");
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
      whatsapp: normalizedWhatsapp,
      email: "",
      authLoginEmail,
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

export async function ensureOperatorInviteAccess(operatorId, ownerId) {
  const operatorRef = doc(db, "operators", operatorId);
  const operatorSnap = await getDoc(operatorRef);

  if (!operatorSnap.exists()) {
    throw new Error("OPERATOR_NOT_FOUND");
  }

  const operator = operatorSnap.data();

  if (operator.ownerId !== ownerId) {
    throw new Error("OPERATOR_OWNER_MISMATCH");
  }

  if (operator.authLoginEmail) {
    return {
      operatorId,
      ...operator
    };
  }

  if (operator.authUid) {
    return {
      operatorId,
      ...operator
    };
  }

  const authLoginEmail = buildOperatorAuthEmail(createInviteToken());

  await updateDoc(operatorRef, {
    authLoginEmail,
    updatedAt: serverTimestamp()
  });

  return {
    operatorId,
    ...operator,
    authLoginEmail
  };
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
  if ("whatsapp" in updates) {
    const whatsapp = String(updates.whatsapp || "").trim();
    if (!whatsapp) throw new Error("OPERATOR_WHATSAPP_REQUIRED");
    allowed.whatsapp = whatsapp;
  }

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
  if (!authUser?.uid || !authUser?.email) {
    throw new Error("OPERATOR_AUTH_REQUIRED");
  }

  const operatorRef = doc(db, "operators", operatorId);
  const operatorSnap = await getDoc(operatorRef);

  if (!operatorSnap.exists()) {
    throw new Error("OPERATOR_NOT_FOUND");
  }

  const operator = operatorSnap.data();
  const actualEmail = String(authUser.email || "").trim().toLowerCase();
  const inviteLoginEmail = String(operator.authLoginEmail || "").trim().toLowerCase();
  const legacyEmail = String(operator.email || "").trim().toLowerCase();
  const expectedEmail = inviteLoginEmail || legacyEmail;

  if (!expectedEmail || expectedEmail !== actualEmail) {
    throw new Error("OPERATOR_INVITE_MISMATCH");
  }

  if (!inviteLoginEmail && authUser.emailVerified !== true) {
    throw new Error("VERIFIED_OPERATOR_EMAIL_REQUIRED");
  }

  if (operator.authUid && operator.authUid !== authUser.uid) {
    throw new Error("OPERATOR_ALREADY_CLAIMED");
  }

  if (operator.authUid === authUser.uid) {
    return;
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
