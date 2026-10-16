import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { identifyTransferConsentRole, merchantTransferConsentLink, summarizeTransferConsent } from "../core/merchants/transfer-consent-view.js";
import { MERCHANT_TRANSFER_CASES_ENABLED } from "../core/merchants/transfer-case-rollout.js";

const sample={
  projectDocId:"owner_supermarket",originalSubscriberId:"owner",
  previousSubscriberId:"", proposedSubscriberId:"incoming",
  status:"awaiting_consents",operatorConsent:"pending",recipientConsent:"pending",
  commissionAmount:6,commissionVersion:1,commissionCurrency:"EGP"
};
const operator={authUid:"physical_shop",status:"active"};

test("disabled consent UI cannot submit before final Firestore Rules rollout",()=>{
  assert.equal(MERCHANT_TRANSFER_CASES_ENABLED,false);
  const source=readFileSync("merchant-transfer/app.js","utf8");
  assert.match(source,/repeatCycle \? !MERCHANT_REPEAT_ASSIGNMENT_ENABLED : !MERCHANT_TRANSFER_CASES_ENABLED/);
  assert.match(source,/onAuthStateChanged\(auth/);
});

test("old subscriber has no veto and receives no role or invitation",()=>{
  const details={...sample,previousSubscriberId:"previous"};
  assert.equal(identifyTransferConsentRole(details,operator,"owner"),null);
  assert.equal(identifyTransferConsentRole(details,operator,"previous"),null);
  assert.equal(identifyTransferConsentRole(details,operator,"outsider"),null);
});

test("the physical shop and incoming subscriber may independently record one choice",()=>{
  assert.equal(identifyTransferConsentRole(sample,operator,"physical_shop"),"operator");
  assert.equal(identifyTransferConsentRole(sample,operator,"incoming"),"recipient");
  assert.equal(identifyTransferConsentRole({...sample,operatorConsent:"accepted"},operator,"physical_shop"),null);
  assert.equal(identifyTransferConsentRole({...sample,recipientConsent:"declined"},operator,"incoming"),null);
  assert.equal(identifyTransferConsentRole({...sample,status:"canceled"},operator,"incoming"),null);
  assert.match(summarizeTransferConsent(sample,"recipient"),/من غير الحصول على أرباح المشترك السابق/);
  assert.match(summarizeTransferConsent(sample,"recipient"),/٦ جنيه/);
  assert.match(summarizeTransferConsent(sample,"operator"),/العمولة المتفق عليها/);
});

test("safe transfer link stays within the repository and rejects path traversal",()=>{
  const link=merchantTransferConsentLink("https://salah-hamed.github.io/Familybusiness/","owner_supermarket");
  assert.equal(link,"https://salah-hamed.github.io/Familybusiness/merchant-transfer/?project=owner_supermarket");
  for(const p of ["../admin","../../evil","spaces here",""]) {
    assert.throws(()=>merchantTransferConsentLink("https://example.com/Familybusiness/",p));
  }
});

test("admin and approval UI cannot directly assign ownership or ledger beneficiary",()=>{
  const admin=readFileSync("admin/admin.js","utf8");
  const app=readFileSync("merchant-transfer/app.js","utf8");
  assert.match(admin,/MERCHANT_TRANSFER_CASES_ENABLED && merchant.assignmentStatus === "platform_managed"/);
  assert.match(admin,/openMerchantTransferCase\(/);
  assert.match(app,/submitMerchantTransferConsent\(/);
  assert.match(readFileSync("merchant-transfer/index.html","utf8"),/لا ينقل أرباحًا سابقة/);
  for(const disallowed of ["ownerId:","assignedSubscriberId:","transaction.update(","commissionLedger","commissionSettlements"]) {
    assert.equal(app.includes(disallowed),false,disallowed);
  }
});
