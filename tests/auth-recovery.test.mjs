import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { friendlyAuthError } from "../core/auth/auth-errors.js";

test("owner auth errors are Arabic and hide raw Firebase messages", () => {
  assert.match(friendlyAuthError({code:"auth/invalid-credential"}), /البريد الإلكتروني|كلمة المرور/);
  assert.match(friendlyAuthError({code:"auth/email-already-in-use"}), /مسجل بالفعل/);
  assert.match(friendlyAuthError({code:"auth/network-request-failed"}), /الاتصال|الإنترنت/);
  assert.equal(friendlyAuthError({message:"SOME_INTERNAL_CODE"},"رسالة آمنة"),"رسالة آمنة");
});

test("owner auth service supports Firebase password reset without exposing account existence", () => {
  const source=readFileSync("core/auth/auth.js","utf8");
  assert.match(source,/sendPasswordResetEmail/);
  assert.match(source,/export async function requestPasswordReset/);
  assert.match(source,/لو البريد مسجل عندنا/);
  assert.doesNotMatch(source,/error:\s*error\.message/);
  assert.doesNotMatch(source,/error:\s*"INVALID_(?:NAME|EMAIL)"/);
});

test("main auth screen is Arabic RTL and exposes recovery with accessible auth fields", () => {
  const html=readFileSync("index.html","utf8");
  assert.match(html,/<html lang="ar" dir="rtl">/);
  assert.match(html,/id="forgotPasswordBtn"/);
  assert.match(html,/autocomplete="email"/);
  assert.match(html,/autocomplete="new-password"/);
  assert.match(html,/aria-label="كلمة المرور"/);
});

test("login mode can return to registration and shows password recovery", () => {
  const source=readFileSync("app.js","utf8");
  assert.match(source,/currentMode === "register" \? "login" : "register"/);
  assert.match(source,/requestPasswordReset/);
  assert.match(source,/forgotPasswordBtn\.classList\.remove\("hidden"\)/);
  assert.match(source,/تم تسجيل الخروج/);
  assert.doesNotMatch(source,/console\.log\("Current User:"/);
});
