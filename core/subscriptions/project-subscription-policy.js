/**
 * Pure per-project subscription policy.
 *
 * This module deliberately does not replace the legacy account-level gate yet.
 * Runtime enforcement must only switch after payment review and Firestore Rules
 * support the same project-scoped contract.
 */
export const PROJECT_MONTHLY_SUBSCRIPTION_AMOUNT = 35;
export const PROJECT_LINKING_TRIAL_DAYS = 7;
export const PROJECT_PAYMENT_GRACE_DAYS = 3;
export const PROJECT_SUBSCRIPTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value) {
  if (value == null) return null;
  let date;
  if (typeof value.toDate === "function") date = value.toDate();
  else if (typeof value.toMillis === "function") date = new Date(value.toMillis());
  else if (value instanceof Date) date = value;
  else if (typeof value === "string" || typeof value === "number") date = new Date(value);
  else return null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

function result(phase, allowed, deadline = null, requiresPayment = false) {
  return {
    phase,
    allowed,
    requiresPayment,
    deadline,
    remainingMilliseconds: deadline ? Math.max(0, deadline.getTime() - result.now) : null
  };
}

/**
 * Resolves one project's billing state, independent of all other projects.
 * Expected project fields:
 *   createdAt, linkedAt, subscriptionStatus ("trial" | "active" | "suspended"),
 *   subscriptionExpiresAt, subscriptionPaymentVerified (true after trusted approval)
 */
export function resolveProjectSubscriptionAccess(project = {}, now = new Date()) {
  const when = validDate(now);
  if (!when) throw new Error("INVALID_CURRENT_TIME");

  const finish = (phase, allowed, deadline = null, requiresPayment = !allowed) => ({
    phase,
    allowed,
    requiresPayment,
    deadline,
    remainingMilliseconds: deadline ? Math.max(0, deadline.getTime() - when.getTime()) : null
  });

  if (project.subscriptionStatus === "suspended" || project.isActive === false) {
    return finish("project_suspended", false);
  }

  const expiry = validDate(project.subscriptionExpiresAt);
  if (project.subscriptionStatus === "active"
      && project.subscriptionPaymentVerified === true
      && expiry
      && expiry.getTime() > when.getTime()) {
    return finish("paid", true, expiry, false);
  }

  const createdAt = validDate(project.createdAt);
  if (!createdAt || createdAt.getTime() > when.getTime()) {
    return finish("invalid_project_anchor", false);
  }

  const hasLink = project.linkedAt !== null && project.linkedAt !== undefined;
  const linkedAt = hasLink ? validDate(project.linkedAt) : null;
  if (hasLink && (!linkedAt || linkedAt.getTime() < createdAt.getTime()
      || linkedAt.getTime() > when.getTime())) {
    return finish("invalid_project_link_anchor", false);
  }

  // Once any paid subscription was previously verified, expiry must not
  // reopen onboarding or grace windows.
  if (project.subscriptionPaymentVerified === true || project.lastSubscriptionPaymentId) {
    return finish("payment_required", false);
  }

  const anchor = linkedAt || createdAt;
  const days = linkedAt ? PROJECT_PAYMENT_GRACE_DAYS : PROJECT_LINKING_TRIAL_DAYS;
  const deadline = new Date(anchor.getTime() + days * DAY_MS);
  const allowed = when.getTime() < deadline.getTime();
  return finish(
    linkedAt
      ? (allowed ? "payment_grace" : "payment_grace_expired")
      : (allowed ? "linking_trial" : "linking_trial_expired"),
    allowed,
    deadline,
    !allowed
  );
}

export function requiredProjectSubscriptionPayment(project = {}) {
  return Object.freeze({
    paymentType: project.subscriptionPaymentVerified === true
      || Boolean(project.lastSubscriptionPaymentId) ? "renewal" : "initial",
    amount: PROJECT_MONTHLY_SUBSCRIPTION_AMOUNT,
    currency: "EGP",
    projectDocId: typeof project.projectDocId === "string" ? project.projectDocId : ""
  });
}

export function nextProjectSubscriptionExpiry(approvedAt) {
  const start = validDate(approvedAt);
  if (!start) throw new Error("INVALID_APPROVAL_TIME");
  return new Date(start.getTime() + PROJECT_SUBSCRIPTION_DAYS * DAY_MS);
}
