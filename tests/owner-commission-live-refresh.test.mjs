import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("owner finance live refresh uses a lightweight latest-ledger signal", () => {
  const source = readFileSync("core/commissions/earnings-service.js", "utf8");
  assert.match(source, /subscribeLatestUserCommission/);
  assert.match(source, /where\("userId", "==", uid\)/);
  assert.match(source, /orderBy\("createdAt", "desc"\)/);
  assert.match(source, /limit\(1\)/);
  assert.match(source, /subscribeProjectPaymentState/);
  assert.match(source, /commissionPaymentStates/);
});

test("workspace shows live commission totals for each created project", () => {
  const source = readFileSync("workspace/app.js", "utf8");
  const html = readFileSync("workspace/index.html", "utf8");

  assert.match(source, /projectCommissionMini/);
  assert.match(source, /إجمالي العمولة/);
  assert.match(source, /المستحق لك/);
  assert.match(source, /startWorkspaceFinanceLive/);
  assert.match(source, /subscribeLatestUserCommission/);
  assert.match(source, /subscribeProjectPaymentState/);
  assert.match(html, /app\.js\?v=20261010-commission1/);
});

test("all owner project dashboards refresh finance when a new commission arrives", () => {
  const paths = [
    "supermarket/app.js",
    "restaurant/app.js",
    "bakery/app.js",
    "laundry/app.js"
  ];

  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /startOwnerFinanceLiveRefresh/);
    assert.match(source, /subscribeLatestUserCommission/);
    assert.match(source, /subscribeProjectPaymentState/);
    assert.match(source, /refreshOwnerFinance/);
    assert.match(source, /renderOwnerFinancePanel/);
    assert.match(source, /earnings-service\.js\?v=20261010-commission1/);
  }
});

test("workspace and owner dashboard entry files remain valid JavaScript modules", () => {
  for (const path of [
    "workspace/app.js",
    "supermarket/app.js",
    "restaurant/app.js",
    "bakery/app.js",
    "laundry/app.js",
    "core/commissions/earnings-service.js"
  ]) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path} syntax error:\n${result.stderr || result.stdout}`);
  }
});

test("owner dashboard cache keys are bumped for the finance refresh", () => {
  for (const path of [
    "supermarket/index.html",
    "restaurant/index.html",
    "bakery/index.html",
    "laundry/index.html"
  ]) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /app\.js\?v=20261010-commission1/, path);
  }
});


test("commission aggregation indexes cover production sum(amount) queries", () => {
  const config = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));

  const signatures = new Set(config.indexes.map(index => [
    index.collectionGroup,
    ...index.fields.map(field => `${field.fieldPath}:${field.order || field.arrayConfig}`)
  ].join("|")));

  const required = [
    "commissionLedger|projectId:ASCENDING|sourceType:ASCENDING|userId:ASCENDING|amount:ASCENDING",
    "commissionLedger|projectId:ASCENDING|sourceType:ASCENDING|userId:ASCENDING|status:ASCENDING|amount:ASCENDING",
    "commissionLedger|projectId:ASCENDING|sourceType:ASCENDING|amount:ASCENDING",
    "commissionLedger|projectId:ASCENDING|sourceType:ASCENDING|status:ASCENDING|amount:ASCENDING",
    "commissionLedger|userId:ASCENDING|amount:ASCENDING",
    "commissionLedger|userId:ASCENDING|sourceType:ASCENDING|amount:ASCENDING",
    "commissionLedger|userId:ASCENDING|sourceType:ASCENDING|status:ASCENDING|amount:ASCENDING",
    "commissionSettlements|projectId:ASCENDING|status:ASCENDING|amount:ASCENDING"
  ];

  for (const signature of required) {
    assert.ok(signatures.has(signature), `missing aggregate index: ${signature}`);
  }
});
