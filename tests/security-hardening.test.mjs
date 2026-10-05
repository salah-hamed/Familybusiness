import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [
  "admin","core","dashboard","home","laundry","laundry-operator","my-projects",
  "restaurant","restaurant-operator","supermarket","supermarket-operator",
  "templates","workspace"
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
