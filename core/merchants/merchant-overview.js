import { resolveMerchantIdentity } from "./merchant-identity.js";

// Read-only central network projection. Historical ownerId and project IDs
// remain unchanged until an audited reassignment protocol is implemented.
export function projectMerchantOverview(project = {}, projectDocId = "") {
  const identity = resolveMerchantIdentity(project, projectDocId);
  const runtimeProjectId = String(projectDocId || project.projectDocId || "");
  // An explicit empty assignee means platform-managed, NOT original owner.
  const assigned = identity.assignedSubscriberId;
  const status = identity.assignmentStatus || "assigned_to_subscriber";
  return {
    merchantId: identity.merchantId,
    legacy: identity.isLegacyIdentity,
    originalSubscriberId: identity.originalSubscriberId,
    assignedSubscriberId: assigned,
    assignmentStatus: status,
    platformManaged: identity.platformManaged,
    linkedAt: identity.linkedAt,
    runtimeProjectId,
    displayState: status === "merchant_closed" ? "مغلق"
      : status === "merchant_paused" ? "موقوف"
      : status === "platform_managed" ? "تحت إدارة المنصة"
      : status === "unassigned" ? "بدون مشترك"
      : status === "reassignment_pending" ? "ينتظر إعادة التخصيص"
      : status === "assigned_to_new_subscriber" ? "مُخصص لمشترك جديد"
      : "مُخصص للمشترك"
  };
}
