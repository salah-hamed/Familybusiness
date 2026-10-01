import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [adminJs, adminHtml, indexJson] = await Promise.all([
  readFile(new URL("../admin/admin.js", import.meta.url), "utf8"),
  readFile(new URL("../admin/index.html", import.meta.url), "utf8"),
  readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8")
]);

test("FB-LAUNCH07B admin exposes a dedicated operational exception queue", () => {
  assert.match(adminHtml, /data-section="exceptionsSection"/);
  assert.match(adminHtml, /id="exceptionsSection"/);
  assert.match(adminHtml, /id="exceptionsTemplateFilter"/);
  assert.match(adminHtml, /id="exceptionsLevelFilter"/);
  assert.match(adminHtml, /id="loadMoreExceptionsBtn"/);
});

test("FB-LAUNCH07B exception queue reuses the shared stale-order policy", () => {
  assert.match(adminJs, /getOrderOperationalAlert/);
  assert.match(adminJs, /ACTIVE_EXCEPTION_STATUSES/);
  assert.match(adminJs, /operationalAlert/);
  assert.match(adminJs, /exceptionCritical/);
  assert.match(adminJs, /exceptionWarning/);
});

test("FB-LAUNCH07B exception query is bounded and paginated", () => {
  const start = adminJs.indexOf("async function loadOperationalExceptions");
  const end = adminJs.indexOf("function renderOperationalExceptions", start);
  const block = adminJs.slice(start, end);
  assert.match(block, /where\("status", "in", ACTIVE_EXCEPTION_STATUSES\)/);
  assert.match(block, /where\("createdAt", "<=", cutoff\)/);
  assert.match(block, /orderBy\("createdAt", "asc"\)/);
  assert.match(block, /startAfter\(s\.cursor\)/);
  assert.match(block, /limit\(PAGE_SIZE\)/);
  assert.doesNotMatch(block, /updateDoc|runTransaction|deleteDoc/);
});

test("FB-LAUNCH07B admin can drill from an exception into the existing order view", () => {
  assert.match(adminJs, /open-exception-order/);
  assert.match(adminJs, /state\.orders\.search = button\.dataset\.order/);
  assert.match(adminJs, /switchSection\("ordersSection"\)/);
});

test("FB-LAUNCH07B adds the ascending status-createdAt index required by the queue", () => {
  const parsed = JSON.parse(indexJson);
  const found = parsed.indexes.some(index =>
    index.collectionGroup === "orders"
    && index.queryScope === "COLLECTION"
    && index.fields?.length === 2
    && index.fields[0]?.fieldPath === "status"
    && index.fields[0]?.order === "ASCENDING"
    && index.fields[1]?.fieldPath === "createdAt"
    && index.fields[1]?.order === "ASCENDING"
  );
  assert.equal(found, true);
});
