import {
  assignWorkerToOrder
} from "./assignment-service.js";

import {
  buildWorkerWhatsAppUrl
} from "../whatsapp/dispatch-service.js";

export async function assignWorkerAndPrepareWhatsApp({
  projectId,
  orderId,
  workerId,
  actorUid
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

  const whatsappUrl = buildWorkerWhatsAppUrl({
    templateId: assignment.templateId,
    orderId,
    order: assignment.order,
    worker
  });

  return {
    ...assignment,
    whatsappUrl
  };
}

export async function assignWorkerAndOpenWhatsApp(payload) {
  const result = await assignWorkerAndPrepareWhatsApp(payload);
  window.open(result.whatsappUrl, "_blank", "noopener");
  return result;
}
