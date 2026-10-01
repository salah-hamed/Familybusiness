import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("operator claim is transactional and recovery rotates the synthetic login", () => {
  const source = readFileSync("core/partners/partner-service.js", "utf8");
  const claimStart = source.indexOf("export async function claimOperatorAccess");
  const rotateStart = source.indexOf("export async function rotateOperatorInviteAccess");
  const claimBody = source.slice(claimStart, rotateStart);
  const rotateBody = source.slice(rotateStart);

  assert.ok(claimBody.includes("runTransaction"));
  assert.ok(claimBody.includes("transaction.update(operatorRef"));
  assert.ok(rotateBody.includes("runTransaction"));
  assert.ok(rotateBody.includes('authUid: ""'));
  assert.ok(rotateBody.includes("authLoginEmail"));
  assert.ok(rotateBody.includes("OPERATOR_OWNER_MISMATCH"));
});

for (const path of [
  "supermarket/index.html",
  "restaurant/index.html",
  "bakery/index.html",
  "laundry/index.html"
]) {
  test(`${path} exposes owner recovery action`, () => {
    const html = readFileSync(path, "utf8");
    assert.equal(html.includes('id="resetOperatorAccessBtn"'), true);
  });
}

for (const path of [
  "supermarket/app.js",
  "restaurant/app.js",
  "bakery/app.js",
  "laundry/app.js"
]) {
  test(`${path} wires recovery through partner-service`, () => {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("rotateOperatorInviteAccess"), true);
    assert.equal(source.includes("resetOperatorAccessBtn"), true);
    assert.equal(source.includes("الرابط القديم لم يعد صالحًا"), true);
  });
}

test("shared operator error mapper keeps the revoked-invite recovery message", () => {
  const helper = readFileSync("core/operators/operator-errors.js", "utf8");
  assert.equal(
    helper.includes("رابط الدخول ده اتلغى أو تم استبداله"),
    true
  );
});

for (const path of [
  "supermarket-operator/app.js",
  "supermarket-operator/products.js",
  "restaurant-operator/app.js",
  "restaurant-operator/menu.js",
  "bakery-operator/app.js",
  "bakery-operator/menu.js",
  "laundry-operator/app.js"
]) {
  test(`${path} treats replaced invites through the shared recovery mapper`, () => {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("friendlyOperatorError"), true);
    assert.equal(source.includes("../core/operators/operator-errors.js"), true);
  });
}

test("operator pages no longer ignore OPERATOR_ALREADY_CLAIMED and continue", () => {
  for (const path of [
    "supermarket-operator/app.js",
    "restaurant-operator/app.js",
    "bakery-operator/app.js",
    "laundry-operator/app.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(
      source.includes('if(e.message!=="OPERATOR_ALREADY_CLAIMED")'),
      false,
      path
    );
    assert.equal(
      source.includes('if(!["OPERATOR_ALREADY_CLAIMED"].includes(e.message))'),
      false,
      path
    );
  }
});
