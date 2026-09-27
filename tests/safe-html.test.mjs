import test from "node:test";
import assert from "node:assert/strict";
import { escapeHTML } from "../core/utils/helpers.js";

test("escapeHTML neutralizes executable markup", () => {
  assert.equal(
    escapeHTML('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
});

test("escapeHTML safely handles nullish values", () => {
  assert.equal(escapeHTML(null), "");
  assert.equal(escapeHTML(undefined), "");
});
