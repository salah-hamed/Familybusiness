function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function subscriptionExpiryDate(userData = {}) {
  return asDate(userData.subscriptionExpiresAt);
}

export function merchantLinkDeadlineDate(userData = {}) {
  return asDate(userData.merchantLinkDeadlineAt);
}

export function firstPaymentDueDate(userData = {}) {
  return asDate(userData.firstPaymentDueAt);
}

export function isNetworkV2Subscriber(userData = {}) {
  return userData.subscriptionModel === "network_v2";
}

export function subscriptionAccessState(userData = {}, now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);

  if (userData.isActive !== true) {
    return { hasAccess: false, state: userData.subscriptionStatus || "inactive", deadline: null };
  }

  if (!isNetworkV2Subscriber(userData)) {
    const expiry = subscriptionExpiryDate(userData);
    const active = userData.subscriptionStatus === "active"
      && (!expiry || expiry.getTime() > current.getTime());
    return { hasAccess: active, state: active ? "active_paid" : (userData.subscriptionStatus || "inactive"), deadline: expiry };
  }

  if (userData.subscriptionStatus === "active_paid" || userData.subscriptionStatus === "active") {
    const expiry = subscriptionExpiryDate(userData);
    const active = Boolean(expiry && expiry.getTime() > current.getTime());
    return { hasAccess: active, state: active ? "active_paid" : "expired", deadline: expiry };
  }

  if (
    userData.subscriptionStatus === "admin_suspended"
    || userData.subscriptionStatus === "suspended_no_merchant"
    || userData.subscriptionStatus === "suspended_payment_due"
    || userData.subscriptionStatus === "expired"
  ) {
    return { hasAccess: false, state: userData.subscriptionStatus, deadline: null };
  }

  if (userData.firstMerchantLinkedAt) {
    const dueAt = firstPaymentDueDate(userData);
    const hasAccess = Boolean(dueAt && dueAt.getTime() > current.getTime());
    return {
      hasAccess,
      state: hasAccess ? "merchant_linked_payment_due" : "suspended_payment_due",
      deadline: dueAt
    };
  }

  const merchantDeadline = merchantLinkDeadlineDate(userData);
  const hasAccess = Boolean(merchantDeadline && merchantDeadline.getTime() > current.getTime());
  return {
    hasAccess,
    state: hasAccess ? "onboarding_active" : "suspended_no_merchant",
    deadline: merchantDeadline
  };
}

export function isSubscriptionActive(userData = {}, now = new Date()) {
  return subscriptionAccessState(userData, now).hasAccess;
}

export function remainingWholeDays(deadline, now = new Date()) {
  const target = asDate(deadline);
  if (!target) return null;
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 86400000));
}
