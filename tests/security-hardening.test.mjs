import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [
  "admin","core","dashboard","home","laundry","laundry-operator","my-projects",
  "restaurant","restaurant-operator","supermarket","supermarket-operator",
  "templates","workspace","pwa"
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(js|mjs|html|json|rules)$/.test(path)) out.push(path);
  }
  return out;
}

const files = [
  "app.js","firestore.rules","firebase.json","package.json","service-worker.js",
  ...roots.flatMap(root => {
    try { return walk(root); } catch { return []; }
  })
];

test("all browser Firebase CDN imports use the approved SDK version", () => {
  const offenders = [];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/firebasejs\/(\d+\.\d+\.\d+)/g)) {
      if (match[1] !== "12.19.0") offenders.push(`${path}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("repository does not contain obvious private credential material", () => {
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /"private_key"\s*:/,
    /"client_secret"\s*:/,
    /FIREBASE_TOKEN\s*=/,
    /GOOGLE_APPLICATION_CREDENTIALS\s*=/
  ];
  const hits = [];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    if (forbidden.some(pattern => pattern.test(source))) hits.push(path);
  }
  assert.deepEqual(hits, []);
});

test("financial anti-replay protection is wired through payment records and Rules", () => {
  const service = readFileSync("core/subscriptions/payment-service.js", "utf8");
  const admin = readFileSync("admin/admin.js", "utf8");
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(service, /paymentReferenceClaims/);
  assert.match(service, /PAYMENT_REFERENCE_ALREADY_USED/);
  assert.match(admin, /PAYMENT_REFERENCE_CLAIM_MISMATCH/);
  assert.match(rules, /match \/paymentReferenceClaims\/\{referenceId\}/);
});

test("operator invites have expiry, versioning and a claimed timestamp", () => {
  const partner = readFileSync("core/partners/partner-service.js", "utf8");
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(partner, /OPERATOR_INVITE_TTL_MS/);
  assert.match(partner, /inviteExpiresAt/);
  assert.match(partner, /inviteVersion/);
  assert.match(partner, /inviteClaimedAt/);
  assert.match(rules, /inviteExpiresAt > request\.time/);
});

test("admin uses session-only persistence and an idle timeout", () => {
  const guard = readFileSync("core/auth/admin-guard.js", "utf8");
  const admin = readFileSync("admin/admin.js", "utf8");
  assert.match(guard, /browserSessionPersistence/);
  assert.match(guard, /ADMIN_IDLE_TIMEOUT_MS/);
  assert.match(admin, /ADMIN_RECENT_LOGIN_MS/);
  assert.match(admin, /requireRecentAdminLogin/);
});

test("public tracking tokens expire and unknown Firestore paths stay denied", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(rules, /duration\.value\(30, 'd'\)/);
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
});


test("App Check is initialized before Firebase services", () => {
  const appCheck = readFileSync("core/firebase/firebase-app-check.js", "utf8");
  const auth = readFileSync("core/firebase/firebase-auth.js", "utf8");
  const db = readFileSync("core/firebase/firebase-db.js", "utf8");
  assert.match(appCheck, /ReCaptchaEnterpriseProvider/);
  assert.match(appCheck, /isTokenAutoRefreshEnabled: true/);
  assert.match(auth, /firebase-app-check\.js/);
  assert.match(db, /firebase-app-check\.js/);
});


test("claimed operator invite tokens are removed from browser URLs and internal navigation", () => {
  for (const path of [
    "supermarket-operator/app.js",
    "supermarket-operator/products.js",
    "restaurant-operator/app.js",
    "restaurant-operator/menu.js",
    "bakery-operator/app.js",
    "bakery-operator/menu.js",
    "laundry-operator/app.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /clearInviteFromAddressBar/);
    assert.match(source, /searchParams\.delete\("invite"\)/);
    assert.doesNotMatch(source, /searchParams\.set\("invite",\s*inviteToken\)/);
  }
});

test("legacy verified-email operator recovery is not forced through synthetic invite expiry", () => {
  const partner = readFileSync("core/partners/partner-service.js", "utf8");
  assert.match(partner, /if \(inviteLoginEmail && !inviteIsActive\(operator\)\)/);
  assert.match(partner, /!inviteLoginEmail && authUser\.emailVerified !== true/);
});


test("launch surfaces enforce a browser CSP and strict referrer policy", () => {
  for (const path of [
    "index.html",
    "home/index.html",
    "workspace/index.html",
    "admin/index.html",
    "dashboard/index.html",
    "my-projects/index.html",
    "supermarket-operator/index.html",
    "supermarket-operator/products.html",
    "restaurant-operator/index.html",
    "restaurant-operator/menu.html",
    "bakery-operator/index.html",
    "bakery-operator/menu.html",
    "laundry-operator/index.html",
    "templates/supermarket/index.html",
    "templates/restaurant/index.html",
    "templates/bakery/index.html",
    "templates/laundry/index.html",
    "bakery/index.html",
    "laundry/index.html",
    "restaurant/index.html",
    "supermarket/index.html",
    "templates/carwash/index.html",
    "templates/cleaning/index.html"
  ]) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /http-equiv="Content-Security-Policy"/, path);
    assert.match(html, /object-src 'none'/, path);
    assert.match(html, /base-uri 'self'/, path);
    assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/, path);
    assert.match(html, /name="referrer" content="strict-origin-when-cross-origin"/, path);
  }
});


test("browser runtime avoids dangerous dynamic-code sinks and inline event handlers", () => {
  const forbidden = [
    { label: "eval", pattern: /\beval\s*\(/ },
    { label: "new Function", pattern: /\bnew\s+Function\s*\(/ },
    { label: "document.write", pattern: /document\.write\s*\(/ },
    { label: "javascript URL", pattern: /javascript\s*:/i },
    { label: "inline event handler", pattern: /\son[a-z]+\s*=/i }
  ];

  const hits = [];
  for (const path of files.filter(path => /\.(js|html)$/.test(path))) {
    const source = readFileSync(path, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) hits.push(`${path}: ${rule.label}`);
    }
  }
  assert.deepEqual(hits, []);
});


test("offline fallback forbids all script execution", () => {
  const html = readFileSync("pwa/offline.html", "utf8");
  assert.match(html, /script-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});
