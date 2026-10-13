import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MERCHANT_TRANSFER_CASES_ENABLED } from "../core/merchants/transfer-case-rollout.js";

test("transfer case rollout is locked until final Rules deployment and consent surfaces ship", () => {
  assert.equal(MERCHANT_TRANSFER_CASES_ENABLED,false);
});

test("merchant consent requests never edit operational project or finance history", () => {
  const source=readFileSync("core/merchants/transfer-case-service.js","utf8");
  const start=source.indexOf("export async function openMerchantTransferCase");
  const end=source.indexOf("export async function submitMerchantTransferConsent",start);
  const op=source.slice(start,end);
  assert.ok(op.length > 400);
  for (const forbidden of [
    'transaction.update(projectRef',
    'transaction.update(operatorRef',
    'transaction.update(agreementRef',
    'commissionLedger','commissionSettlements','orders','transferOwnership',
    'assignedSubscriberId:','ownerId:'
  ]) {
    assert.equal(op.includes(forbidden),false,forbidden);
  }
  assert.match(op,/transaction\.get\(projectRef\)/);
  assert.match(op,/transaction\.set\(caseRef,payload\)/);
  assert.match(source,/MERCHANT_TRANSFER_CASES_DISABLED/);
});

test("new Rules are deny-by-default for financial cutover and require independent consents",()=>{
  const rules=readFileSync("firestore.rules","utf8");
  const start=rules.indexOf("match /merchantTransferCases/{projectId}");
  assert.ok(start>=0);
  const end=rules.indexOf("match /{document=**}",start);
  const block=rules.slice(start,end);
  assert.match(block,/operatorData\(projectId\)\.authUid == request\.auth\.uid/);
  assert.match(block,/resource\.data\.proposedSubscriberId == request\.auth\.uid/);
  assert.match(block,/resource\.data\.operatorConsent == "pending"/);
  assert.match(block,/resource\.data\.recipientConsent == "pending"/);
  assert.match(block,/allow delete: if false/);
  assert.equal(block.includes('request.resource.data.status == "cutover_completed"'),false);
});
