export const PLATFORM_BILLING = Object.freeze({
  currency: "EGP",
  initialActivationFee: 350,
  monthlyRenewalFee: 59,
  subscriptionDays: 30,
  instapayAccount: "",
  paymentWhatsapp: "201508830993",
  supportWhatsapp: "201508830993",
  supportWhatsappDisplay: "01508830993"
});

export const REFERRAL_CONFIG = Object.freeze({
  qualifiedReferralReward: 50,
  currency: "EGP"
});

export function formatEgp(amount) {
  return `${Number(amount || 0).toLocaleString("ar-EG")} جنيه`;
}


export const LAUNCH_PROMO = Object.freeze({
  campaignId: "launch50",
  limit: 50,
  subscriptionDays: 30,
  selectionMode: "admin_selected"
});
