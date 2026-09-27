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
