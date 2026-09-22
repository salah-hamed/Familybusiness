import db from "../firebase/firebase-db.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const WORKER_ROLES = Object.freeze({
  RIDER: "rider",
  CLEANER: "cleaner",
  PICKUP_AGENT: "pickup_agent",
  DELIVERY_AGENT: "delivery_agent"
});

const ALLOWED_ROLES = new Set(Object.values(WORKER_ROLES));

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  const digits = normalizeText(value).replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;

  return digits;
}

async function assertProjectActor(projectId, actorUid) {
  if (!projectId || !actorUid) {
    throw new Error("PROJECT_ACTOR_REQUIRED");
  }

  const projectRef = doc(db, "projects", projectId);
  const projectSnap = await getDoc(projectRef);

  if (!projectSnap.exists()) {
    throw new Error("PROJECT_NOT_FOUND");
  }

  const project = projectSnap.data();

  if (project.ownerId === actorUid) {
    return project;
  }

  if (
    project.operatingModel === "partner_operated" &&
    project.operatorId
  ) {
    const operatorSnap = await getDoc(
      doc(db, "operators", project.operatorId)
    );

    if (operatorSnap.exists()) {
      const operator = operatorSnap.data();

      if (
        operator.authUid === actorUid &&
        operator.status === "active" &&
        operator.agreementStatus === "accepted" &&
        operator.isActive === true
      ) {
        return project;
      }
    }
  }

  throw new Error("PROJECT_ACCESS_DENIED");
}

export async function createWorker({
  projectId,
  actorUid,
  name,
  role,
  phone = "",
  whatsapp = ""
}) {
  const project = await assertProjectActor(projectId, actorUid);
  const normalizedName = normalizeText(name);
  const normalizedRole = normalizeText(role);
  const normalizedPhone = normalizePhone(phone);
  const normalizedWhatsapp = normalizePhone(whatsapp || phone);

  if (!normalizedName) {
    throw new Error("WORKER_NAME_REQUIRED");
  }

  if (!ALLOWED_ROLES.has(normalizedRole)) {
    throw new Error("INVALID_WORKER_ROLE");
  }

  if (!normalizedWhatsapp) {
    throw new Error("WORKER_WHATSAPP_REQUIRED");
  }

  const workerRef = doc(collection(db, "workers"));

  await setDoc(workerRef, {
    workerId: workerRef.id,
    ownerId: project.ownerId,
    projectId,
    templateId: project.template,
    name: normalizedName,
    role: normalizedRole,
    phone: normalizedPhone,
    whatsapp: normalizedWhatsapp,
    isActive: true,
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return workerRef.id;
}

export async function listProjectWorkers(projectId, {
  role = "",
  activeOnly = true
} = {}) {
  const snap = await getDocs(
    query(
      collection(db, "workers"),
      where("projectId", "==", projectId)
    )
  );

  return snap.docs
    .map(workerDoc => ({
      workerId: workerDoc.id,
      ...workerDoc.data()
    }))
    .filter(worker => !role || worker.role === role)
    .filter(worker => !activeOnly || worker.isActive === true)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
}

export async function updateWorker({
  workerId,
  projectId,
  actorUid,
  updates = {}
}) {
  await assertProjectActor(projectId, actorUid);

  const workerRef = doc(db, "workers", workerId);
  const workerSnap = await getDoc(workerRef);

  if (!workerSnap.exists()) {
    throw new Error("WORKER_NOT_FOUND");
  }

  const worker = workerSnap.data();

  if (worker.projectId !== projectId) {
    throw new Error("WORKER_PROJECT_MISMATCH");
  }

  const next = {};

  if ("name" in updates) {
    const name = normalizeText(updates.name);
    if (!name) throw new Error("WORKER_NAME_REQUIRED");
    next.name = name;
  }

  if ("role" in updates) {
    const role = normalizeText(updates.role);
    if (!ALLOWED_ROLES.has(role)) throw new Error("INVALID_WORKER_ROLE");
    next.role = role;
  }

  if ("phone" in updates) next.phone = normalizePhone(updates.phone);
  if ("whatsapp" in updates) {
    const whatsapp = normalizePhone(updates.whatsapp);
    if (!whatsapp) throw new Error("WORKER_WHATSAPP_REQUIRED");
    next.whatsapp = whatsapp;
  }
  if ("isActive" in updates) next.isActive = updates.isActive === true;

  if (!Object.keys(next).length) return;

  next.updatedAt = serverTimestamp();

  await updateDoc(workerRef, next);
}

export async function setWorkerActive({
  workerId,
  projectId,
  actorUid,
  isActive
}) {
  return updateWorker({
    workerId,
    projectId,
    actorUid,
    updates: { isActive }
  });
}
