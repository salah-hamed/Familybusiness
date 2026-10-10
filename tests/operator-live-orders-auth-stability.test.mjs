import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const operatorApps = [
  ["supermarket-operator/app.js","subscribeSupermarketOperationalOrders"],
  ["restaurant-operator/app.js","subscribeRestaurantOperationalOrders"],
  ["bakery-operator/app.js","subscribeRestaurantOperationalOrders"],
  ["laundry-operator/app.js","subscribeLaundryOperationalOrders"]
];

test("operator pages never auto-sign-out a different Family Business session", () => {
  for (const [path] of operatorApps) {
    const source = readFileSync(path,"utf8");
    assert.match(source,/لن يتم تسجيل خروجه تلقائيًا/,path);
    assert.match(source,/auth\.currentUser&&activeEmail!==inviteAuthEmail\.toLowerCase\(\)/,path);
    assert.doesNotMatch(
      source,
      /if\([^\n]*inviteAuthEmail[^\n]*\)\{\s*await signOut\(auth\);\s*return;/,
      path
    );
  }
});

test("operator dashboards subscribe to active orders in realtime", () => {
  for (const [path,subscription] of operatorApps) {
    const source = readFileSync(path,"utf8");
    assert.match(source,new RegExp(subscription),path);
    assert.match(source,/startOrdersLive/,path);
    assert.match(source,/stopOrdersLive/,path);
    assert.match(source,/renderOrders\(\)/,path);
  }

  const supermarket = readFileSync("core/supermarket/order-service.js","utf8");
  assert.match(supermarket,/export function subscribeSupermarketOperationalOrders/);
  assert.match(supermarket,/onSnapshot\(/);

  const restaurant = readFileSync("core/restaurant/order-service.js","utf8");
  assert.match(restaurant,/export function subscribeRestaurantOperationalOrders/);
  assert.match(restaurant,/onSnapshot\(/);

  const laundry = readFileSync("core/laundry/order-service.js","utf8");
  assert.match(laundry,/export function subscribeLaundryOperationalOrders/);
  assert.match(laundry,/onSnapshot\(/);
});

test("operator dashboards ship a fresh cache key", () => {
  for (const path of [
    "supermarket-operator/index.html",
    "restaurant-operator/index.html",
    "bakery-operator/index.html",
    "laundry-operator/index.html"
  ]) {
    const html = readFileSync(path,"utf8");
    assert.match(html,/app\.js\?v=20261010-liveorders1/,path);
  }
});

test("realtime order and operator entry modules remain syntactically valid", () => {
  for (const path of [
    ...operatorApps.map(([path])=>path),
    "core/supermarket/order-service.js",
    "core/restaurant/order-service.js",
    "core/laundry/order-service.js"
  ]) {
    const result=spawnSync(process.execPath,["--check",path],{encoding:"utf8"});
    assert.equal(result.status,0,`${path} syntax error:\n${result.stderr||result.stdout}`);
  }
});
