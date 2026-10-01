import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { friendlyOperatorError } from "../core/operators/operator-errors.js";

test("operator error mapper hides raw operational codes",()=>{
  assert.match(friendlyOperatorError({message:"INVALID_STATUS_TRANSITION"}),/حالة الطلب/);
  assert.match(friendlyOperatorError({message:"RIDER_REQUIRED_BEFORE_ASSIGNMENT"}),/مندوب/);
  assert.match(friendlyOperatorError({code:"unavailable"}),/الاتصال|الإنترنت/);
  assert.match(friendlyOperatorError({code:"permission-denied"}),/إعدادات المنصة|غير متاحة/);
  assert.equal(friendlyOperatorError({message:"SOME_INTERNAL_CODE"},"رسالة آمنة"),"رسالة آمنة");
});

test("launch operator surfaces do not expose UNKNOWN_ERROR or direct alert(error.message)",()=>{
  for(const path of [
    "supermarket-operator/app.js",
    "restaurant-operator/app.js",
    "bakery-operator/app.js",
    "laundry-operator/app.js",
    "supermarket-operator/products.js",
    "restaurant-operator/menu.js",
    "bakery-operator/menu.js"
  ]){
    const source=readFileSync(path,"utf8");
    assert.equal(source.includes("UNKNOWN_ERROR"),false,`${path} must not expose UNKNOWN_ERROR`);
    assert.doesNotMatch(source,/alert\((?:e|error)\.message\)/,`${path} must not alert raw error.message`);
  }
});

test("all launch operator surfaces use the shared friendly error mapper",()=>{
  for(const path of [
    "supermarket-operator/app.js",
    "restaurant-operator/app.js",
    "bakery-operator/app.js",
    "laundry-operator/app.js",
    "supermarket-operator/products.js",
    "restaurant-operator/menu.js",
    "bakery-operator/menu.js"
  ]){
    const source=readFileSync(path,"utf8");
    assert.match(source,/friendlyOperatorError/);
  }
});
