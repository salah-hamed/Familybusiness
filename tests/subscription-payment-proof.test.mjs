import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  paymentStatusCopy,
  requiredSubscriptionPayment,
  validatePaymentProofFile
} from "../core/subscriptions/payment-service.js";

test("subscription payment amount is derived from activation history", () => {
  assert.deepEqual(
    requiredSubscriptionPayment({ initialActivationPaid: false }),
    { paymentType: "initial", amount: 350, currency: "EGP" }
  );
  assert.deepEqual(
    requiredSubscriptionPayment({ initialActivationPaid: true }),
    { paymentType: "renewal", amount: 59, currency: "EGP" }
  );
});

test("payment proof validation restricts type and size", () => {
  assert.equal(validatePaymentProofFile(null), "ارفع صورة إيصال التحويل أولًا.");
  assert.match(validatePaymentProofFile({type:"text/plain",size:10}), /صيغة/);
  assert.match(validatePaymentProofFile({type:"image/jpeg",size:6*1024*1024}), /5 MB/);
  assert.equal(validatePaymentProofFile({type:"image/png",size:1000}), "");
});

test("payment review copy handles pending and rejected states", () => {
  assert.match(paymentStatusCopy({status:"pending_review"}), /بانتظار مراجعة/);
  assert.match(paymentStatusCopy({status:"rejected",rejectionReason:"الصورة غير واضحة"}), /الصورة غير واضحة/);
});

test("workspace exposes a bounded InstaPay proof submission flow", () => {
  const html=readFileSync("workspace/index.html","utf8");
  const source=readFileSync("workspace/app.js","utf8");
  const config=readFileSync("core/config/platform-config.js","utf8");

  assert.match(html,/id="paymentProofFile"/);
  assert.match(html,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html,/id="paymentReference"/);
  assert.match(source,/submitSubscriptionPaymentProof/);
  assert.match(source,/PLATFORM_BILLING\.instapayAccount/);
  assert.match(config,/instapayAccount/);
});

test("proof files stay outside Firestore documents", () => {
  const source=readFileSync("core/subscriptions/payment-service.js","utf8");
  assert.match(source,/uploadBytes/);
  assert.match(source,/proofPath/);
  assert.doesNotMatch(source,/readAsDataURL|base64/);
});
