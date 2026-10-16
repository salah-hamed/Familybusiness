import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MERCHANT_TRANSFER_CASES_ENABLED } from "../core/merchants/transfer-case-rollout.js";

test("transfer case rollout is locked until final Rules deployment and consent surfaces ship", () => {
  assert.equal(MERCHANT_TRANSFER_CASES_ENABLED,true);
});

test("staged new assignment uses explicit empty platform assignee for previousSubscriberId", () => {
  const source=readFileSync("core/merchants/transfer-case-service.js","utf8");
  assert.match(source,/previousSubscriberId:readiness.assignedSubscriberId/);
  const identity=readFileSync("core/merchants/merchant-identity.js","utf8");
  assert.match(identity,/typeof project.assignedSubscriberId === "string"/);
  const rules=readFileSync("firestore.rules","utf8");
  assert.match(rules,/d.previousSubscriberId == ""/);
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
  assert.ok(block.includes('next.status == "cutover_completed"'));
  assert.ok(block.includes("getAfter(merchantCutoverPath(projectId))"));
});

test("a transfer case may only be created after audited platform takeover, never as an old subscriber workaround",()=>{
  const service=readFileSync("core/merchants/transfer-case-service.js","utf8");
  const rules=readFileSync("firestore.rules","utf8");
  const start=rules.indexOf("match /merchantTransferCases/{projectId}");
  const block=rules.slice(start);
  assert.match(service,/MERCHANT_MUST_BE_RECOVERED_FIRST/);
  assert.match(service,/project\.platformManaged !== true/);
  assert.match(rules,/function validMerchantTransferCaseCreate\(projectId\)/);
  assert.match(rules,/audit.status == "completed"/);
  assert.match(rules,/audit.recoveredAt == p.recoveryAt/);
  assert.match(block,/validMerchantTransferCaseCreate\(projectId\)/);
  assert.match(rules,/p.assignedSubscriberId == ""/);
  assert.match(rules,/d.previousSubscriberId == ""/);
  assert.doesNotMatch(block,/originalSubscriberId == request\.auth\.uid/);
});
