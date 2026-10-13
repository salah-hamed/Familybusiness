// Immutable commission quote for both incoming subscriber and physical shop.
// A consent to manage a merchant is NOT consent to an unspecified percentage.
export function snapshotMerchantTransferTerms(agreement = {}) {
  const amount = Number(agreement.currentAmount);
  const version = Number(agreement.acceptedVersion);
  if (agreement.status !== "accepted" || agreement.currency !== "EGP"
      || agreement.currentAmount == null
      || !Number.isFinite(amount) || amount < 0
      || !Number.isSafeInteger(version) || version <= 0) {
    throw new Error("TRANSFER_COMMISSION_TERMS_NOT_ACCEPTED");
  }
  return Object.freeze({
    commissionAmount: Math.round(amount * 100) / 100,
    commissionVersion: version,
    commissionCurrency: "EGP"
  });
}

export function transferTermsMatchAgreement(transferCase = {}, agreement = {}) {
  try {
    const terms = snapshotMerchantTransferTerms(agreement);
    return transferCase.commissionAmount === terms.commissionAmount
      && transferCase.commissionVersion === terms.commissionVersion
      && transferCase.commissionCurrency === terms.commissionCurrency;
  } catch {
    return false;
  }
}

export function formatMerchantTransferTerms(transferCase = {}) {
  if (!Number.isFinite(transferCase.commissionAmount)
      || transferCase.commissionAmount < 0
      || !Number.isSafeInteger(transferCase.commissionVersion)
      || transferCase.commissionVersion <= 0
      || transferCase.commissionCurrency !== "EGP") {
    throw new Error("TRANSFER_FINANCIAL_TERMS_MISSING");
  }
  return `العمولة المتفق عليها عن كل طلب مؤهل: ${transferCase.commissionAmount.toLocaleString("ar-EG")} جنيه (إصدار الاتفاق ${transferCase.commissionVersion}).`;
}
