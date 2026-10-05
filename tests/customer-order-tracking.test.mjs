import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const laundryApp = readFileSync("templates/laundry/app.js", "utf8");
const laundryHtml = readFileSync("templates/laundry/index.html", "utf8");
const laundryOrders = readFileSync("templates/laundry/orders.js", "utf8");
const laundryService = readFileSync("core/laundry/order-service.js", "utf8");
const rules = readFileSync("firestore.rules", "utf8");

test("all four launch customer templates expose My Orders tracking UI", () => {
  for (const path of [
    "templates/supermarket/index.html",
    "templates/restaurant/index.html",
    "templates/bakery/index.html",
    "templates/laundry/index.html"
  ]) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /id="myOrdersBtn"/, path);
    assert.match(html, /id="ordersList"/, path);
  }
});

test("all four launch customer templates remember bounded tracking history", () => {
  for (const path of [
    "templates/supermarket/app.js",
    "templates/restaurant/app.js",
    "templates/bakery/app.js",
    "templates/laundry/app.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /slice\(0,20\)/, path);
    assert.match(source, /rememberOrder/, path);
    assert.match(source, /loadHistoryTokens/, path);
  }
});

test("laundry customer flow has real-time tracking parity", () => {
  assert.match(laundryApp, /getLaundryOrderTracking/);
  assert.match(laundryApp, /subscribeLaundryOrderTracking/);
  assert.match(laundryApp, /laundryStatusSteps/);
  assert.match(laundryApp, /pickup_assigned/);
  assert.match(laundryApp, /ready_delivery/);
  assert.match(laundryApp, /out_for_delivery/);
  assert.match(laundryApp, /rememberOrder\(result\.trackingToken\)/);
  assert.match(laundryHtml, /تابع طلب الغسيل من الاستلام حتى التوصيل/);
});

test("laundry order wrapper delegates creation to the shared tracked service", () => {
  assert.match(laundryOrders, /createLaundryOrder/);
  assert.match(laundryOrders, /getLaundryOrderTracking/);
  assert.match(laundryOrders, /subscribeLaundryOrderTracking/);
});

test("laundry service creates order and tracking record atomically", () => {
  const start = laundryService.indexOf("export async function createLaundryOrder");
  const end = laundryService.indexOf("export async function getLaundryOrderTracking", start);
  const body = laundryService.slice(start, end);
  assert.match(body, /writeBatch\(db\)/);
  assert.match(body, /batch\.set\(orderRef/);
  assert.match(body, /batch\.set\(publicTrackingRef/);
  assert.match(body, /trackingToken/);
  assert.match(body, /trackingEnabled:true/);
});

test("laundry operational stage changes synchronize public tracking", () => {
  const start = laundryService.indexOf("export async function changeLaundryStage");
  const body = laundryService.slice(start);
  for (const marker of [
    '"canceled"',
    '"out_for_delivery"',
    '"delivered"',
    "trackingRef(order.trackingToken)",
    "trackingRef(fresh.trackingToken)"
  ]) {
    assert.equal(body.includes(marker), true, marker);
  }
  assert.match(body, /writeBatch\(db\)/);
  assert.match(body, /transaction\.update\(\s*trackingRef/);
});

test("Firestore tracking rules include laundry and derive its public status from laundry stage", () => {
  assert.match(rules, /templateType == "laundry"\s*&& laundryPartnerReady\(projectId\)/);
  assert.match(rules, /function laundryTrackingStatus\(order\)/);
  assert.match(rules, /resource\.data\.templateType == "laundry"\s*\? laundryTrackingStatus/);
  assert.match(rules, /request\.resource\.data\.trackingToken is string/);
});

test("laundry tracking never exposes customer phone or address", () => {
  const start = laundryService.indexOf("batch.set(publicTrackingRef");
  const end = laundryService.indexOf("let trackingEnabled", start);
  const publicRecord = laundryService.slice(start, end);
  assert.doesNotMatch(publicRecord, /customerPhone|customerAddress|location|notes/);
});


test("public tracking access expires after 30 days", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(rules, /resource\.data\.createdAt \+ duration\.value\(30, 'd'\) > request\.time/);
  assert.match(rules, /request\.resource\.data\.createdAt == request\.time/);
  assert.match(rules, /request\.resource\.data\.updatedAt == request\.time/);
});
