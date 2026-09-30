import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Restaurant/Bakery order query is sorted newest-first before limiting", () => {
  const source = readFileSync("core/restaurant/order-service.js", "utf8");
  const functionStart = source.indexOf("export async function listRestaurantOrdersPage");
  const functionEnd = source.indexOf("export async function listRestaurantOrders(", functionStart);
  const body = source.slice(functionStart, functionEnd);

  const orderByAt = body.indexOf('orderBy("createdAt", "desc")');
  const startAfterAt = body.indexOf("startAfter(cursor)");
  const limitAt = body.indexOf("limit(size)");

  assert.ok(orderByAt >= 0, "createdAt descending order must be enforced by Firestore");
  assert.ok(startAfterAt > orderByAt, "cursor pagination must follow the ordered query");
  assert.ok(limitAt > orderByAt, "limit must be applied after server-side ordering");
});

test("ordered food-order query has a version-controlled composite index", () => {
  const config = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
  const found = config.indexes.some(index =>
    index.collectionGroup === "orders"
    && index.queryScope === "COLLECTION"
    && JSON.stringify(index.fields) === JSON.stringify([
      { fieldPath: "projectId", order: "ASCENDING" },
      { fieldPath: "templateType", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" }
    ])
  );

  assert.equal(found, true);
});


test("Restaurant/Bakery order listing exhausts every cursor page instead of stopping at 50", () => {
  const source = readFileSync("core/restaurant/order-service.js", "utf8");
  const start = source.indexOf("export async function listRestaurantOrders(projectId");
  const end = source.indexOf("export async function getRestaurantOrderTracking", start);
  const body = source.slice(start, end);

  assert.ok(body.includes("while (true)"));
  assert.ok(body.includes("listRestaurantOrdersPage"));
  assert.ok(body.includes("all.push(...page.orders)"));
  assert.ok(body.includes("ORDER_PAGINATION_STALLED"));
});

test("all active partner order services constrain server reads by project and template", () => {
  for (const [path, templateType] of [
    ["core/supermarket/order-service.js", "supermarket"],
    ["core/restaurant/order-service.js", "templateType"],
    ["core/laundry/order-service.js", "laundry"]
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(/where\("projectId"\s*,\s*"=="\s*,/.test(source), path);
    assert.ok(
      templateType === "templateType"
        ? /where\("templateType"\s*,\s*"=="\s*,\s*templateType\)/.test(source)
        : new RegExp(`where\\("templateType"\\s*,\\s*"=="\\s*,\\s*"${templateType}"\\)`).test(source),
      path
    );
  }
});

test("supermarket and laundry expose newest-first cursor page helpers for the next performance phase", () => {
  for (const path of [
    "core/supermarket/order-service.js",
    "core/laundry/order-service.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes('orderBy("createdAt","desc")') || source.includes('orderBy("createdAt", "desc")'), path);
    assert.ok(source.includes("startAfter("), path);
    assert.ok(source.includes("limit("), path);
  }
});
