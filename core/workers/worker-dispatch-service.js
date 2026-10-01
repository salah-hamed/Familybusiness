import {
  assignWorkerToOrder,
  clearWorkerAssignment
} from "./assignment-service.js";

import {
  buildWorkerWhatsAppUrl
} from "../whatsapp/dispatch-service.js";

export async function assignWorkerAndPrepareWhatsApp({
  projectId,
  orderId,
  workerId,
  actorUid,
  businessName = ""
}) {
  const assignment = await assignWorkerToOrder({
    projectId,
    orderId,
    workerId,
    actorUid
  });

  const worker = {
    name: assignment.workerName,
    role: assignment.workerRole,
    whatsapp: assignment.workerWhatsapp
  };

  try {
    const whatsappUrl = buildWorkerWhatsAppUrl({
      templateId: assignment.templateId,
      orderId,
      order: assignment.order,
      worker,
      businessName
    });

    return {
      ...assignment,
      whatsappUrl
    };
  } catch (error) {
    try {
      await clearWorkerAssignment({ projectId, orderId, actorUid });
    } catch (rollbackError) {
      console.error("WORKER_ASSIGNMENT_ROLLBACK_FAILED", rollbackError);
    }
    throw error;
  }
}

export async function rollbackPreparedAssignment({
  projectId,
  orderId,
  actorUid
}) {
  await clearWorkerAssignment({ projectId, orderId, actorUid });
}
