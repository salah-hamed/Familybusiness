export function subscriptionExpiryDate(userData = {}) {
  const value = userData.subscriptionExpiresAt;
  if (!value) return null;

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isSubscriptionActive(userData = {}, now = new Date()) {
  if (
    userData.isActive !== true ||
    userData.subscriptionStatus !== "active"
  ) {
    return false;
  }

  const expiry = subscriptionExpiryDate(userData);

  // Preserve legacy active accounts that predate expiry tracking.
  if (!expiry) {
    return true;
  }

  return expiry.getTime() > now.getTime();
}
