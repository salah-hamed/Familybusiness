import test from "node:test";
import assert from "node:assert/strict";
import {
  getLegacyProjectDocId,
  getNewProjectDocId,
  isLegacyProjectDocId
} from "../core/projects/project-identity.js";

test("legacy project identity remains byte-for-byte compatible", () => {
  assert.equal(getLegacyProjectDocId("ownerABC", "supermarket"), "ownerABC_supermarket");
  assert.equal(isLegacyProjectDocId("ownerABC_supermarket", "ownerABC", "supermarket"), true);
});

test("same subscriber can derive distinct IDs for repeated template types", () => {
  const first = getNewProjectDocId("ownerABC", "supermarket", "instance-0001");
  const second = getNewProjectDocId("ownerABC", "supermarket", "instance-0002");
  assert.notEqual(first, second);
  assert.ok(first.startsWith("ownerABC_supermarket_"));
});

test("project identity rejects unsupported templates and malformed identifiers", () => {
  assert.throws(() => getLegacyProjectDocId("ownerABC", "cleaning"), { message: "INVALID_PROJECT_IDENTITY" });
  assert.throws(() => getLegacyProjectDocId("../owner", "supermarket"), { message: "INVALID_PROJECT_IDENTITY" });
  assert.throws(() => getNewProjectDocId("ownerABC", "supermarket", "short"), { message: "INVALID_PROJECT_INSTANCE_ID" });
  assert.equal(isLegacyProjectDocId("ownerABC_restaurant", "ownerABC", "supermarket"), false);
});
