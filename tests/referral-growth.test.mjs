import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync("core/config/platform-config.js", "utf8");
const workspaceApp = readFileSync("workspace/app.js", "utf8");
const workspaceHtml = readFileSync("workspace/index.html", "utf8");
const homeApp = readFileSync("home/app.js", "utf8");
const homeHtml = readFileSync("home/index.html", "utf8");
const authApp = readFileSync("app.js", "utf8");
const adminJs = readFileSync("admin/admin.js", "utf8");
const adminHtml = readFileSync("admin/index.html", "utf8");

test("platform WhatsApp is centralized for routing without rendering the phone number", () => {
  assert.match(config, /paymentWhatsapp:\s*"201508830993"/);
  assert.match(config, /supportWhatsapp:\s*"201508830993"/);
  assert.doesNotMatch(config, /supportWhatsappDisplay/);
  assert.doesNotMatch(homeHtml, /01508830993|201508830993/);
  assert.doesNotMatch(authApp, /01508830993|201508830993/);
  assert.match(homeHtml, /تواصل مع دعم Family Business على واتساب/);
  assert.match(authApp, /الدعم والتفعيل عبر واتساب/);
});

test("platform WhatsApp stays separate from subscriber/operator business contacts", () => {
  assert.match(workspaceApp, /PLATFORM_BILLING\.paymentWhatsapp/);
  assert.match(homeApp, /PLATFORM_BILLING\.supportWhatsapp/);
  assert.doesNotMatch(config, /operatorWhatsapp|subscriberWhatsapp|workerWhatsapp/);
});

test("Launch 50 is a flexible admin-selected pool, not the first 50 registrations", () => {
  assert.match(config, /selectionMode:\s*"admin_selected"/);
  assert.match(adminJs, /يمكنك توزيع المنح في أي وقت وعلى المستخدمين الذين تختارهم/);
  assert.match(adminHtml, /50 منحة مجانية تختارها الإدارة بمرونة/);
  assert.doesNotMatch(authApp, /grantLaunchPromo|LAUNCH_PROMO/);
});

test("workspace referral URL lands on the marketing page first", () => {
  assert.match(workspaceApp, /new URL\("\.\.\/home\/", window\.location\.href\)/);
  assert.match(workspaceApp, /referralUrl\.searchParams\.set\("ref", user\.uid\)/);
  assert.match(workspaceHtml, /shareReferralWhatsappBtn/);
});

test("marketing page preserves referral attribution through account CTAs", () => {
  assert.match(homeApp, /new URLSearchParams\(window\.location\.search\)\.get\("ref"\)/);
  assert.match(homeApp, /document\.querySelectorAll\('a\[href="\.\.\/"\]'\)/);
  assert.match(homeApp, /authUrl\.searchParams\.set\("ref", referralUserId\)/);
  assert.match(homeHtml, /id="referralLandingBanner"/);
});

test("registration still records referral after the visitor leaves the marketing page", () => {
  assert.match(authApp, /const referralUserId = new URLSearchParams\(window\.location\.search\)\.get\("ref"\)/);
  assert.match(authApp, /registerUser\([\s\S]*referralUserId/);
});

test("referral marketing no longer downplays referral income", () => {
  assert.match(homeHtml, /لينكك نفسه مصدر دخل/);
  assert.match(homeHtml, /كل شخص تعرفه ممكن يبقى عمولة إحالة جديدة/);
  assert.match(homeHtml, /شبكتك = فرصة عمولة/);
  assert.doesNotMatch(homeHtml, /الإحالات حلوة… بس العمولات هي اللعبة الكبيرة/);
  assert.doesNotMatch(homeHtml, /دخل إضافي<\/span>\s*<b>🔗 الإحالات/);
});

test("workspace gives subscriber direct WhatsApp referral sharing", () => {
  assert.match(workspaceApp, /shareReferralWhatsappBtn\.onclick/);
  assert.match(workspaceApp, /https:\/\/wa\.me\/\?text=/);
  assert.match(workspaceApp, /شوفت Family Business/);
});
