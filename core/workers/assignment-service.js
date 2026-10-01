import db from "../firebase/firebase-db.js";
import { isWorkerRoleAllowedForTemplate } from "./worker-service.js";

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

async function authorizeActor(transaction, project, actorUid) {
  if (
    project.ownerId === actorUid &&
    project.operatingModel === "owner_operated"
  ) {
    return "owner";
  }

  if (
    project.operatingModel === "partner_operated" &&
    project.operatorId
  ) {
    const operatorRef = doc(db, "operators", project.operatorId);
    const operatorSnap = await transaction.get(operatorRef);

    if (!operatorSnap.exists()) {
      throw new Error("OPERATOR_NOT_FOUND");
    }

    const operator = operatorSnap.data();

    if (
      operator.authUid === actorUid &&
      operator.status === "active" &&
      operator.agreementStatus === "accepted" &&
      operator.isActive === true
    ) {
      return "operator";
    }
  }

  throw new Error("PROJECT_ACCESS_DENIED");
}

export async function assignWorkerToOrder({
  projectId,
  orderId,
  workerId,
  actorUid
}) {
  if (!projectId || !orderId || !workerId || !actorUid) {
    throw new Error("ASSIGNMENT_FIELDS_REQUIRED");
  }

  const projectRef = doc(db, "projects", projectId);
  const orderRef = doc(db, "orders", orderId);
  const workerRef = doc(db, "workers", workerId);
  const assignmentRef = doc(collection(db, "workerAssignments"));

  let result = null;

  await runTransaction(db, async (transaction) => {
    const projectSnap = await transaction.get(projectRef);
    const orderSnap = await transaction.get(orderRef);
    const workerSnap = await transaction.get(workerRef);

    if (!projectSnap.exists()) throw new Error("PROJECT_NOT_FOUND");
    if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");
    if (!workerSnap.exists()) throw new Error("WORKER_NOT_FOUND");

    const project = projectSnap.data();
    const order = orderSnap.data();
    const worker = workerSnap.data();

    const actorType = await authorizeActor(transaction, project, actorUid);

    if (order.projectId !== projectId) {
      throw new Error("ORDER_PROJECT_MISMATCH");
    }

    if (worker.projectId !== projectId || worker.isActive !== true) {
      throw new Error("WORKER_PROJECT_MISMATCH");
    }

    if (!isWorkerRoleAllowedForTemplate(project.template, worker.role)) {
      throw new Error("INVALID_WORKER_ROLE");
    }

    const assignedAt = serverTimestamp();

    transaction.update(orderRef, {
      assignedWorkerId: workerId,
      assignedWorkerName: worker.name,
      assignedWorkerRole: worker.role,
      assignedWorkerWhatsapp: worker.whatsapp || worker.phone || "",
      assignedAt,
      assignmentUpdatedAt: assignedAt
    });

    transaction.set(assignmentRef, {
      assignmentId: assignmentRef.id,
      projectId,
      orderId,
      workerId,
      workerName: worker.name,
      workerRole: worker.role,
      actorUid,
      actorType,
      eventType: "assigned",
      createdAt: assignedAt
    });

    result = {
      workerId,
      workerName: worker.name,
      workerRole: worker.role,
      workerWhatsapp: worker.whatsapp || worker.phone || "",
      templateId: project.template,
      order
    };
  });

  return result;
}

export async function clearWorkerAssignment({
  projectId,
  orderId,
  actorUid
}) {
  if (!projectId || !orderId || !actorUid) {
    throw new Error("ASSIGNMENT_FIELDS_REQUIRED");
  }

  const projectRef = doc(db, "projects", projectId);
  const orderRef = doc(db, "orders", orderId);
  const assignmentRef = doc(collection(db, "workerAssignments"));

  await runTransaction(db, async (transaction) => {
    const projectSnap = await transaction.get(projectRef);
    const orderSnap = await transaction.get(orderRef);

    if (!projectSnap.exists()) throw new Error("PROJECT_NOT_FOUND");
    if (!orderSnap.exists()) throw new Error("ORDER_NOT_FOUND");

    const project = projectSnap.data();
    const order = orderSnap.data();

    const actorType = await authorizeActor(transaction, project, actorUid);

    if (order.projectId !== projectId) {
      throw new Error("ORDER_PROJECT_MISMATCH");
    }

    const previousWorkerId = order.assignedWorkerId || "";

    transaction.update(orderRef, {
      assignedWorkerId: "",
      assignedWorkerName: "",
      assignedWorkerRole: "",
      assignedWorkerWhatsapp: "",
      assignedAt: null,
      assignmentUpdatedAt: serverTimestamp()
    });

    transaction.set(assignmentRef, {
      assignmentId: assignmentRef.id,
      projectId,
      orderId,
      workerId: previousWorkerId,
      actorUid,
      actorType,
      eventType: "unassigned",
      createdAt: serverTimestamp()
    });
  });
}
