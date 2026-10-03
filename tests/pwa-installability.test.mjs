import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const surfaces = [
  {
    path: "index.html",
    surface: "platform",
    manifest: "./pwa/manifest.json",
    install: "./pwa/install.js"
  },
  {
    path: "home/index.html",
    surface: "platform",
    manifest: "../pwa/manifest.json",
    install: "../pwa/install.js"
  },
  {
    path: "workspace/index.html",
    surface: "workspace",
    manifest: "../pwa/manifests/workspace.webmanifest",
    install: "../pwa/install.js"
  },
  {
    path: "admin/index.html",
    surface: "admin",
    manifest: "../pwa/manifests/admin.webmanifest",
    install: "../pwa/install.js"
  },
  {
    path: "templates/supermarket/index.html",
    surface: "supermarket",
    manifest: "../../pwa/manifests/supermarket.webmanifest",
    install: "../../pwa/install.js"
  },
  {
    path: "templates/restaurant/index.html",
    surface: "restaurant",
    manifest: "../../pwa/manifests/restaurant.webmanifest",
    install: "../../pwa/install.js"
  },
  {
    path: "templates/bakery/index.html",
    surface: "bakery",
    manifest: "../../pwa/manifests/bakery.webmanifest",
    install: "../../pwa/install.js"
  },
  {
    path: "templates/laundry/index.html",
    surface: "laundry",
    manifest: "../../pwa/manifests/laundry.webmanifest",
    install: "../../pwa/install.js"
  }
];

const manifestPaths = [
  "pwa/manifest.json",
  "pwa/manifests/workspace.webmanifest",
  "pwa/manifests/admin.webmanifest",
  "pwa/manifests/supermarket.webmanifest",
  "pwa/manifests/restaurant.webmanifest",
  "pwa/manifests/bakery.webmanifest",
  "pwa/manifests/laundry.webmanifest"
];

test("all requested surfaces expose manifest, install manager, mobile capability and touch icon", () => {
  for (const item of surfaces) {
    const html = readFileSync(item.path, "utf8");
    assert.match(html, new RegExp(`name="fb-pwa-surface" content="${item.surface}"`), item.path);
    assert.ok(html.includes(`rel="manifest" href="${item.manifest}"`), item.path);
    assert.ok(html.includes(`src="${item.install}"`), item.path);
    assert.match(html, /apple-mobile-web-app-capable/, item.path);
    assert.match(html, /mobile-web-app-capable/, item.path);
    assert.match(html, /apple-touch-icon/, item.path);
  }
});

test("every manifest satisfies Chromium installability essentials", () => {
  for (const path of manifestPaths) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    assert.ok(manifest.name || manifest.short_name, path);
    assert.ok(manifest.start_url, path);
    assert.ok(manifest.scope, path);
    assert.equal(manifest.display, "standalone", path);
    const sizes = new Set((manifest.icons || []).map(icon => icon.sizes));
    assert.equal(sizes.has("192x192"), true, `${path}: missing 192x192 icon`);
    assert.equal(sizes.has("512x512"), true, `${path}: missing 512x512 icon`);
    assert.ok((manifest.icons || []).every(icon => icon.type === "image/png"), path);
  }
});

test("generated install icons exist and are real PNG files", () => {
  for (const [path, minBytes] of [
    ["pwa/icons/icon-192.png", 1000],
    ["pwa/icons/icon-512.png", 3000]
  ]) {
    assert.equal(existsSync(path), true, path);
    const data = readFileSync(path);
    assert.ok(data.length >= minBytes, path);
    assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
  }
});

test("root service worker can control the complete Family Business path", () => {
  assert.equal(existsSync("service-worker.js"), true);
  const source = readFileSync("service-worker.js", "utf8");
  assert.match(source, /self\.addEventListener\("install"/);
  assert.match(source, /self\.addEventListener\("activate"/);
  assert.match(source, /self\.addEventListener\("fetch"/);
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /pwa\/offline\.html/);

  const installer = readFileSync("pwa/install.js", "utf8");
  assert.match(installer, /new URL\("service-worker\.js", repoRoot\)/);
  assert.match(installer, /scope: repoRoot\.pathname/);
});

test("install UI uses the native prompt when available and iOS Home Screen instructions otherwise", () => {
  const source = readFileSync("pwa/install.js", "utf8");
  assert.match(source, /beforeinstallprompt/);
  assert.match(source, /deferredPrompt\.prompt\(\)/);
  assert.match(source, /appinstalled/);
  assert.match(source, /Add to Home Screen/);
  assert.match(source, /apple|iphone|ipad|ipod/i);
});

test("customer PWA remembers the exact project before install and restores it on standalone launch", () => {
  const source = readFileSync("pwa/install.js", "utf8");
  assert.match(source, /familybusiness:pwa:launch:/);
  assert.match(source, /new URLSearchParams\(location\.search\)\.get\("project"\)/);
  assert.match(source, /localStorage\.setItem\(installKey/);
  assert.match(source, /isStandalone\(\)/);
  assert.match(source, /location\.replace\(target\.toString\(\)\)/);

  for (const path of [
    "templates/supermarket/index.html",
    "templates/restaurant/index.html",
    "templates/bakery/index.html",
    "templates/laundry/index.html"
  ]) {
    const html = readFileSync(path, "utf8");
    const installIndex = html.indexOf("../../pwa/install.js");
    const appIndex = html.indexOf("./app.js");
    assert.ok(installIndex >= 0 && appIndex >= 0 && installIndex < appIndex, path);
  }
});

test("PWA service worker does not intercept Firebase cross-origin traffic", () => {
  const source = readFileSync("service-worker.js", "utf8");
  assert.match(source, /if\(request\.method !== "GET" \|\| !sameOrigin\(request\)\) return/);
});
