import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLATFORM_MERCHANT_RECOVERY_ENABLED } from "../core/merchants/platform-recovery-rollout.js";

const service=readFileSync("core/merchants/platform-recovery-service.js","utf8");
const admin=readFileSync("admin/admin.js","utf8");
const rules=readFileSync("firestore.rules","utf8");

test("actual admin merchant recovery is feature-flagged OFF pending one final rules deployment",()=>{
  assert.equal(PLATFORM_MERCHANT_RECOVERY_ENABLED,false);
  assert.match(service,/if \(!PLATFORM_MERCHANT_RECOVERY_ENABLED\)/);
  assert.match(admin,/PLATFORM_MERCHANT_RECOVERY_ENABLED && !merchant.platformManaged/);
});

test("one transaction preserves original identity and creates permanent audit",()=>{
  const start=service.indexOf("await runTransaction");
  const tx=service.slice(start);
  assert.match(tx,/transaction.get\(projectRef\)/);
  assert.match(tx,/transaction.get\(ownerRef\)/);
  assert.match(tx,/transaction.get\(operatorRef\)/);
  assert.match(tx,/transaction.get\(agreementRef\)/);
  assert.match(tx,/transaction.get\(auditRef\)/);
  assert.match(tx,/transaction.update\(projectRef/);
  assert.match(tx,/transaction.set\(auditRef/);
  assert.match(tx,/assignmentStatus:"platform_managed"/);
  assert.match(tx,/recoveryAt:at/);
  assert.match(tx,/previousSubscriberId:allocatedUid/);
  assert.doesNotMatch(tx,/transaction\.update\(ownerRef/);
  assert.doesNotMatch(tx,/transaction\.update\(operatorRef/);
  assert.doesNotMatch(tx,/transaction\.update\(agreementRef/);
  assert.doesNotMatch(tx,/transaction\.delete/);
  assert.doesNotMatch(tx,/commissionLedger|commissionSettlements|orders|workers|ownerId:ownerUid/);
});

test("platform recovery does not ask former subscriber to approve or deny",()=>{
  assert.doesNotMatch(service,/oldSubscriberConsent|subscriberApproval|awaiting_subscriber_approval/);
  assert.match(admin,/recover-platform-merchant/);
  assert.match(admin,/بدون موافقة المشترك القديم/);
});

test("bounded pending proof query and index prevent recovering during unreviewed payment",()=>{
  assert.match(service,/where\("userId","==",allocatedUid\)/);
  assert.match(service,/where\("status","==","pending_review"\)/);
  assert.match(service,/limit\(1\)/);
  assert.match(service,/RECOVERY_PAYMENT_REVIEW_REQUIRED/);
  const indexes=JSON.parse(readFileSync("firestore.indexes.json","utf8")).indexes;
  assert.ok(indexes.some(x=>x.collectionGroup==="subscriptionPayments"
    && x.fields.some(f=>f.fieldPath==="userId")
    && x.fields.some(f=>f.fieldPath==="status")));
});

test("server authorization rejects fake violations and dates, not merely hidden UI",()=>{
  assert.match(rules,/validVerifiedRecoveryCause/);
  assert.match(rules,/merchantViolations/);
  assert.match(rules,/confirmedByAdminUid == request.auth.uid/);
  assert.match(rules,/subscriber\.subscriptionExpiresAt <= request\.time/);
  assert.match(rules,/subscriber\.firstMerchantLinkedAt \+ duration\.value\(3, 'd'\) <= request\.time/);
  assert.match(rules,/allow update, delete: if false/);
});
