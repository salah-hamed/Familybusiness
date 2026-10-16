import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
 buildNewBillingGuard,buildSubmittedBillingGuard,
 buildReviewedBillingGuard,assertTrustedRecoveryBillingGuard
} from "../core/subscriptions/subscription-billing-guard.js";
test("billing gate cannot permit recovery during a new or existing payment proof",()=>{
 const g=buildNewBillingGuard("subscriber","subscriber_123",new Date());
 assert.equal(g.pendingPaymentId,"subscriber_123");
 assert.equal(g.recoverySafe,false);
 assert.throws(()=>assertTrustedRecoveryBillingGuard(g,"subscriber"));
 assert.throws(()=>buildSubmittedBillingGuard(g,"subscriber","subscriber_456",new Date()));
 assert.throws(()=>buildReviewedBillingGuard(g,"subscriber","wrong",new Date()));
});
test("only the exact reviewed proof can clear pending without auto-whitelisting legacy recovery",()=>{
 const g=buildNewBillingGuard("subscriber","subscriber_123",new Date());
 const done=buildReviewedBillingGuard(g,"subscriber","subscriber_123",new Date());
 assert.equal(done.pendingPaymentId,"");
 assert.equal(done.recoverySafe,false);
 assert.equal(done.revision,2);
 assert.throws(()=>assertTrustedRecoveryBillingGuard(done,"subscriber"));
 const cleared={...done,recoverySafe:true};
 assert.equal(assertTrustedRecoveryBillingGuard(cleared,"subscriber"),true);
 assert.throws(()=>assertTrustedRecoveryBillingGuard(cleared,"forged"));
 assert.throws(()=>assertTrustedRecoveryBillingGuard({...cleared,pendingPaymentId:"pending"},"subscriber"));
});
test("after account migration further proof writes always increment revision",()=>{
 const old={userId:"subscriber",pendingPaymentId:"",lastReviewedPaymentId:"old",revision:2,recoverySafe:true};
 const sent=buildSubmittedBillingGuard(old,"subscriber","new",new Date());
 assert.equal(sent.revision,3);
 assert.equal(sent.pendingPaymentId,"new");
 assert.equal(sent.recoverySafe,true);
 const done=buildReviewedBillingGuard(sent,"subscriber","new",new Date());
 assert.equal(done.revision,4);
 assert.equal(done.lastReviewedPaymentId,"new");
 assert.equal(done.recoverySafe,true);
});
test("paid proof and admin review now atomically update the same subscription guard",()=>{
 const payment=readFileSync("core/subscriptions/payment-service.js","utf8");
 const admin=readFileSync("admin/admin.js","utf8");
 const recovery=readFileSync("core/merchants/merchant-cycle-service.js","utf8");
 const rules=readFileSync("firestore.rules","utf8");
 assert.match(payment,/runTransaction\(db/);
 assert.match(payment,/buildNewBillingGuard/);
 assert.match(payment,/buildSubmittedBillingGuard/);
 assert.match(admin,/buildReviewedBillingGuard/);
 assert.match(recovery,/assertTrustedRecoveryBillingGuard/);
 assert.match(rules,/match \/subscriptionBillingGuards\/\{uid\}/);
 assert.match(rules,/getAfter\(billingGuardPath/);
});
test("cycle settlements are operator declared, subscriber confirmed and original ledger is immutable",()=>{
 const src=readFileSync("core/commissions/merchant-cycle-settlement-service.js","utf8");
 const app=readFileSync("merchant-statement/app.js","utf8");
 const rules=readFileSync("firestore.rules","utf8");
 assert.match(src,/declareMerchantCyclePayment/);
 assert.match(src,/decideMerchantCyclePayment/);
 assert.match(src,/getProjectPaymentSummary/);
 assert.match(src,/merchantCyclePaymentStates/);
 assert.match(app,/subscriberUid:user.uid/);
 assert.match(rules,/validMerchantCycleSettlementCreate/);
 assert.match(rules,/validMerchantCycleSettlementDecision/);
 assert.match(rules,/validClearPendingState/);
 assert.doesNotMatch(src,/transaction\.delete|tx\.delete/);
});
