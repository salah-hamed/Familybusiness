export const PLATFORM_BILLING = Object.freeze({
  currency: "EGP",
  initialActivationFee: 220,
  monthlyRenewalFee: 59,
  subscriptionDays: 30
});

export const REFERRAL_CONFIG = Object.freeze({
  qualifiedReferralReward: 50,
  currency: "EGP"
});

export function formatEgp(amount) {
  return `${Number(amount || 0).toLocaleString("ar-EG")} جنيه`;
}
