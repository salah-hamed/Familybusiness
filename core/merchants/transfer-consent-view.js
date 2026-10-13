import { formatMerchantTransferTerms } from "./transfer-financial-terms.js";

const UID = /^[A-Za-z0-9_-]{1,128}$/;

export function identifyTransferConsentRole(transferCase, operator, currentUid) {
  const uid = String(currentUid || "");
  if (!UID.test(uid) || !transferCase ||
      transferCase.status !== "awaiting_consents") return null;

  // The subscriber who previously introduced the shop does not grant,
  // withhold, or even review the new assignment consent.
  if (uid === transferCase.originalSubscriberId
      || (transferCase.previousSubscriberId && uid === transferCase.previousSubscriberId)) return null;

  if (transferCase.proposedSubscriberId === uid &&
      transferCase.recipientConsent === "pending") return "recipient";

  if (operator?.authUid === uid
      && transferCase.operatorConsent === "pending") return "operator";

  return null;
}

export function merchantTransferConsentLink(origin, projectDocId, cycle = null) {
  if (!UID.test(String(projectDocId || ""))) throw new Error("INVALID_TRANSFER_IDENTIFIERS");
  const url = new URL("merchant-transfer/", origin);
  url.searchParams.set("project", projectDocId);
  if(cycle!=null){
    if(!Number.isSafeInteger(cycle)||cycle<2||cycle>9999)
      throw new Error("INVALID_TRANSFER_CYCLE");
    url.searchParams.set("cycle",String(cycle));
  }
  return url.toString();
}

export function summarizeTransferConsent(transferCase, role) {
  if (!transferCase) throw new Error("TRANSFER_CASE_NOT_FOUND");
  if (!["recipient","operator"].includes(role)) throw new Error("TRANSFER_CONSENT_UNAVAILABLE");
  const terms = formatMerchantTransferTerms(transferCase);
  return role === "operator"
    ? `تأكيد استمرار إدارة المحل مع مشترك جديد دون تغيير رابط العملاء أو الطلبات السابقة. ${terms}`
    : `الموافقة على إدارة هذا النشاط مستقبلًا وفق العمولة التالية، من غير الحصول على أرباح المشترك السابق. ${terms}`;
}
