/**
 * Pure project-scoped billing guard transitions.
 * These helpers are intentionally not wired to Firestore until matching Rules
 * and admin approval transactions are deployed together.
 */
const ID = /^[A-Za-z0-9_-]{1,180}$/;

function assertId(value, code) {
  if (!ID.test(String(value || ""))) throw new Error(code);
}

export function buildNewProjectBillingGuard(projectDocId, ownerId, paymentId, at) {
  assertId(projectDocId, "PROJECT_BILLING_GUARD_INVALID_PROJECT");
  assertId(ownerId, "PROJECT_BILLING_GUARD_INVALID_OWNER");
  assertId(paymentId, "PROJECT_BILLING_GUARD_INVALID_PAYMENT");
  return {
    projectDocId,
    ownerId,
    pendingPaymentId: paymentId,
    lastReviewedPaymentId: "",
    revision: 1,
    updatedAt: at
  };
}

export function buildSubmittedProjectBillingGuard(guard, projectDocId, ownerId, paymentId, at) {
  assertId(projectDocId, "PROJECT_BILLING_GUARD_INVALID_PROJECT");
  assertId(ownerId, "PROJECT_BILLING_GUARD_INVALID_OWNER");
  assertId(paymentId, "PROJECT_BILLING_GUARD_INVALID_PAYMENT");
  if (!guard || guard.projectDocId !== projectDocId || guard.ownerId !== ownerId
      || guard.pendingPaymentId !== "" || !Number.isSafeInteger(guard.revision)
      || guard.revision < 1) {
    throw new Error("PROJECT_BILLING_GUARD_PENDING_OR_MISSING");
  }
  return { ...guard, pendingPaymentId: paymentId, revision: guard.revision + 1, updatedAt: at };
}

export function buildReviewedProjectBillingGuard(guard, projectDocId, ownerId, paymentId, at) {
  if (!guard || guard.projectDocId !== projectDocId || guard.ownerId !== ownerId
      || guard.pendingPaymentId !== paymentId || !Number.isSafeInteger(guard.revision)
      || guard.revision < 1) {
    throw new Error("PROJECT_BILLING_GUARD_PAYMENT_CHANGED");
  }
  return {
    ...guard,
    pendingPaymentId: "",
    lastReviewedPaymentId: paymentId,
    revision: guard.revision + 1,
    updatedAt: at
  };
}
