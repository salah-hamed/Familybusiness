import { isSubscriptionActive, subscriptionExpiryDate } from "./subscription-service.js";

// New accounts must opt in at registration and pass server-side Firestore Rules.
// Existing users without accessModel keep the previous paid-access policy.
export const MERCHANT_TRIAL_ACCESS_MODEL = "merchant_trial_v1";
export const REGISTRATION_TRIAL_DAYS = 7;
export const FIRST_MERCHANT_GRACE_DAYS = 3;
export const MONTHLY_TRIAL_SUBSCRIPTION_AMOUNT = 59;

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

export function resolveSubscriptionAccess(user = {}, now = new Date()) {
  const when = validDate(now);
  if (!when) throw new Error("INVALID_CURRENT_TIME");

  const result = (phase, allowed, deadline = null) => ({
    phase,
    allowed,
    requiresPayment: !allowed,
    deadline,
    remainingMilliseconds: deadline ? Math.max(0, deadline.getTime() - when.getTime()) : null
  });

  if (isSubscriptionActive(user, when)) {
    return result("paid", true, subscriptionExpiryDate(user));
  }

  if (user.accessModel !== MERCHANT_TRIAL_ACCESS_MODEL) {
    // Never grant free access to a legacy account with missing/new fake metadata.
    return result("legacy_requires_activation", false);
  }

  if (user.isActive !== true || !["trial", "active"].includes(user.subscriptionStatus)) {
    return result("account_inactive", false);
  }

  // Once the paid subscription expired, old onboarding/grace windows must not reopen.
  if (user.initialActivationPaid === true || user.lastSubscriptionPaymentId) {
    return result("payment_required", false);
  }

  const createdAt = validDate(user.createdAt);
  if (!createdAt || createdAt.getTime() > when.getTime()) {
    return result("invalid_trial_anchor", false);
  }

  const hasFirstMerchant = user.firstMerchantLinkedAt !== null
    && user.firstMerchantLinkedAt !== undefined;
  const linkedAt = hasFirstMerchant ? validDate(user.firstMerchantLinkedAt) : null;
  if (hasFirstMerchant && (!linkedAt || linkedAt.getTime() < createdAt.getTime() || linkedAt.getTime() > when.getTime())) {
    return result("invalid_merchant_anchor", false);
  }

  const start = linkedAt || createdAt;
  const durationDays = linkedAt ? FIRST_MERCHANT_GRACE_DAYS : REGISTRATION_TRIAL_DAYS;
  const deadline = new Date(start.getTime() + durationDays * DAY_MS);
  const allowed = when.getTime() < deadline.getTime();
  return result(linkedAt ? (allowed ? "merchant_grace" : "merchant_grace_expired")
    : (allowed ? "setup_trial" : "setup_trial_expired"), allowed, deadline);
}

export function requiredMerchantTrialPayment(user = {}) {
  if (user.accessModel !== MERCHANT_TRIAL_ACCESS_MODEL) return null;
  return Object.freeze({
    paymentType: user.initialActivationPaid === true || Boolean(user.lastSubscriptionPaymentId)
      ? "renewal" : "initial",
    amount: MONTHLY_TRIAL_SUBSCRIPTION_AMOUNT,
    currency: "EGP"
  });
}
