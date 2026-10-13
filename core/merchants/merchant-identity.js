// Central merchant identity is additive. Existing project document IDs remain the
// runtime identity for customer links, orders, operators and commission ledgers.
export const MERCHANT_ASSIGNMENT_STATUS = Object.freeze({
  ASSIGNED_TO_SUBSCRIBER: "assigned_to_subscriber",
  PLATFORM_MANAGED: "platform_managed",
  UNASSIGNED: "unassigned",
  REASSIGNMENT_PENDING: "reassignment_pending",
  ASSIGNED_TO_NEW_SUBSCRIBER: "assigned_to_new_subscriber",
  MERCHANT_PAUSED: "merchant_paused",
  MERCHANT_CLOSED: "merchant_closed"
});

export function createMerchantId(secureCrypto = globalThis.crypto) {
  if (!secureCrypto || typeof secureCrypto.getRandomValues !== "function") {
    throw new Error("SECURE_RANDOM_REQUIRED");
  }

  const bytes = new Uint8Array(16);
  secureCrypto.getRandomValues(bytes);
  return "m_" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function buildInitialMerchantIdentity(subscriberId, merchantId = createMerchantId()) {
  if (typeof subscriberId !== "string" || !subscriberId.trim()) {
    throw new Error("SUBSCRIBER_ID_REQUIRED");
  }
  if (!/^m_[a-f0-9]{32}$/.test(merchantId)) {
    throw new Error("INVALID_MERCHANT_ID");
  }

  return {
    merchantId,
    originalSubscriberId: subscriberId,
    assignedSubscriberId: subscriberId,
    assignmentStatus: MERCHANT_ASSIGNMENT_STATUS.ASSIGNED_TO_SUBSCRIBER,
    platformManaged: false,
    linkedAt: null,
    assignmentUpdatedAt: null
  };
}

// Read-only projection for unmigrated projects. Never write these fallback IDs
// into an existing record without a separate, audited migration.
export function resolveMerchantIdentity(project = {}, projectDocId = "") {
  const legacyId = projectDocId || project.projectDocId
    || (project.ownerId && project.projectId ? `${project.ownerId}_${project.projectId}` : "");
  const ownerId = project.ownerId || "";

  return {
    merchantId: project.merchantId || (legacyId ? `legacy_${legacyId}` : ""),
    originalSubscriberId: project.originalSubscriberId || ownerId,
    assignedSubscriberId: typeof project.assignedSubscriberId === "string" ? project.assignedSubscriberId : ownerId,
    assignmentStatus: project.assignmentStatus || MERCHANT_ASSIGNMENT_STATUS.ASSIGNED_TO_SUBSCRIBER,
    platformManaged: project.platformManaged === true,
    linkedAt: project.linkedAt ?? null,
    assignmentUpdatedAt: project.assignmentUpdatedAt ?? null,
    isLegacyIdentity: !project.merchantId
  };
}

// Only a claimed operator with an accepted commission agreement can qualify.
// A project created or an invitation sent is not a linked physical merchant.
export function isQualifyingMerchantLink(operator = {}, agreement = {}) {
  return Boolean(
    operator.authUid
    && operator.status === "active"
    && operator.isActive === true
    && operator.agreementStatus === "accepted"
    && agreement.status === "accepted"
    && Number.isFinite(Number(agreement.acceptedVersion))
    && Number(agreement.acceptedVersion) > 0
  );
}
