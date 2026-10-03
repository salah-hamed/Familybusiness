import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPaymentCode,
  buildWhatsAppProofMessage,
  buildWhatsAppProofUrl,
  paymentStatusCopy,
  requiredSubscriptionPayment
} from "../core/subscriptions/payment-policy.js";

test("subscription payment amount is derived from activation history", () => {
  assert.deepEqual(
    requiredSubscriptionPayment({ initialActivationPaid: false }),
    { paymentType: "initial", amount: 350, currency: "EGP" }
  );
  assert.deepEqual(
    requiredSubscriptionPayment({ activatedAt: new Date() }),
    { paymentType: "renewal", amount: 59, currency: "EGP" }
  );
});

test("payment code is compact and tied to user/timestamp", () => {
  const code = buildPaymentCode("user_ABC123", 1700000000000);
  assert.match(code, /^FB-[A-Z0-9]+-[A-Z0-9]+$/);
  assert.ok(code.length <= 40);
});

test("WhatsApp proof message includes reconciliation fields", () => {
  const message = buildWhatsAppProofMessage({
    paymentCode: "FB-ABC123-XYZ999",
    paymentType: "initial",
    amount: 350,
    paymentReference: "REF-12345",
    userEmail: "user@example.com"
  });
  assert.match(message, /FB-ABC123-XYZ999/);
  assert.match(message, /350 EGP/);
  assert.match(message, /REF-12345/);
  assert.match(message, /Screenshot/);
});

test("WhatsApp URL is generated only when payment number exists", () => {
  assert.equal(buildWhatsAppProofUrl("", "hello"), "");
  const url = buildWhatsAppProofUrl("+20 100 000 0000", "hello world");
  assert.match(url, /^https:\/\/wa\.me\/201000000000\?text=/);
});

test("payment review copy explains WhatsApp review states", () => {
  assert.match(
    paymentStatusCopy({status:"pending_review",paymentCode:"FB-TEST-123"}),
    /واتساب/
  );
  assert.match(
    paymentStatusCopy({status:"rejected",rejectionReason:"الصورة غير واضحة"}),
    /الصورة غير واضحة/
  );
});

test("workspace uses WhatsApp proof handoff and has no Storage upload input", () => {
  const html=readFileSync("workspace/index.html","utf8");
  const source=readFileSync("workspace/app.js","utf8");
  const config=readFileSync("core/config/platform-config.js","utf8");
  const service=readFileSync("core/subscriptions/payment-service.js","utf8");

  assert.match(html,/سجّل الدفعة وافتح واتساب/);
  assert.doesNotMatch(html,/type="file"|paymentProofFile/);
  assert.match(html,/reopenPaymentWhatsappBtn/);
  assert.match(source,/prepareSubscriptionPaymentWhatsApp/);
  assert.match(source,/buildWhatsAppProofUrl/);
  assert.match(config,/paymentWhatsapp/);
  assert.doesNotMatch(service,/firebase-storage|uploadBytes|proofPath|deleteObject/);
});

test("payment records identify WhatsApp as the proof channel", () => {
  const service=readFileSync("core/subscriptions/payment-service.js","utf8");
  assert.match(service,/proofChannel: "whatsapp"/);
  assert.match(service,/paymentCode/);
  assert.match(service,/whatsappPreparedAt/);
});
