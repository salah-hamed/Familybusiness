import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { qrcode } from "../core/qr/vendor/qrcode.mjs";

test("local QR generator produces a valid matrix for a customer project URL", () => {
  const qr = qrcode(0, "M");
  qr.addData("https://example.com/templates/supermarket/?project=owner_supermarket", "Byte");
  qr.make();

  const count = qr.getModuleCount();
  assert.ok(count >= 21);

  let dark = 0;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) dark += 1;
    }
  }

  assert.ok(dark > 0);
  assert.ok(dark < count * count);
});

test("shared customer QR UI supports download, share and print without an external QR API", () => {
  const source = readFileSync("core/qr/customer-qr.js", "utf8");

  assert.match(source, /from "\.\/vendor\/qrcode\.mjs"/);
  assert.match(source, /toBlob\(/);
  assert.match(source, /navigator\.share/);
  assert.match(source, /window\.open\("", "_blank"/);
  assert.equal(source.includes("api.qrserver.com"), false);
  assert.equal(source.includes("chart.googleapis.com"), false);
});

test("all four launch project owner dashboards render QR from their customer link", () => {
  const paths = [
    "supermarket/app.js",
    "restaurant/app.js",
    "bakery/app.js",
    "laundry/app.js"
  ];

  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /renderCustomerQr/);
    assert.match(source, /inputId:"customerLink"/);
  }
});

test("PWA cache includes the local QR generator", () => {
  const source = readFileSync("service-worker.js", "utf8");
  assert.match(source, /family-business-pwa-v3/);
  assert.match(source, /core\/qr\/customer-qr\.js/);
  assert.match(source, /core\/qr\/vendor\/qrcode\.mjs/);
});
