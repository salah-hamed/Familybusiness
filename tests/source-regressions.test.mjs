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


test("PF01 operator dashboards load active orders separately from 50-order history pages", () => {
  const cases = [
    ["supermarket-operator/app.js", "listSupermarketOperationalOrders", "listSupermarketHistoryPage", "countSupermarketDeliveredOrders", "listSupermarketOrders("],
    ["restaurant-operator/app.js", "listRestaurantOperationalOrders", "listRestaurantHistoryPage", "countRestaurantDeliveredOrders", "listRestaurantOrders("],
    ["bakery-operator/app.js", "listRestaurantOperationalOrders", "listRestaurantHistoryPage", "countRestaurantDeliveredOrders", "listRestaurantOrders("],
    ["laundry-operator/app.js", "listLaundryOperationalOrders", "listLaundryHistoryPage", "countLaundryDeliveredOrders", "listLaundryOrders("]
  ];

  for (const [path, activeFn, historyFn, countFn, forbiddenLegacyCall] of cases) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes(activeFn), true, path);
    assert.equal(source.includes(historyFn), true, path);
    assert.equal(source.includes(countFn), true, path);
    assert.equal(source.includes("pageSize:50"), true, path);
    assert.equal(source.includes("appendHistory:true"), true, path);
    assert.equal(source.includes(forbiddenLegacyCall), false, path);
  }
});

test("PF01 active-order services keep server-side status filters as the primary path", () => {
  const supermarket = readFileSync("core/supermarket/order-service.js", "utf8");
  const restaurant = readFileSync("core/restaurant/order-service.js", "utf8");
  const laundry = readFileSync("core/laundry/order-service.js", "utf8");

  for (const source of [supermarket, restaurant]) {
    assert.equal(source.includes('const activeStatuses = ["new","accepted","preparing","ready","assigned","out_for_delivery"]'), true);
    assert.equal(source.includes('where("status", "in", activeStatuses)'), true);
  }
  assert.equal(laundry.includes('const activeStatuses=["new","accepted"]'), true);
  assert.equal(laundry.includes('where("status","in",activeStatuses)'), true);

  for (const source of [supermarket, restaurant, laundry]) {
    assert.equal(source.includes("getCountFromServer"), true);
  }
});

test("PF01 status-aware order query has a version-controlled composite index", () => {
  const config = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
  const found = config.indexes.some(index =>
    index.collectionGroup === "orders"
    && index.queryScope === "COLLECTION"
    && JSON.stringify(index.fields) === JSON.stringify([
      { fieldPath: "projectId", order: "ASCENDING" },
      { fieldPath: "templateType", order: "ASCENDING" },
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" }
    ])
  );
  assert.equal(found, true);
});

test("PF01 all operator pages expose an older-orders pagination control", () => {
  for (const path of [
    "supermarket-operator/index.html",
    "restaurant-operator/index.html",
    "bakery-operator/index.html",
    "laundry-operator/index.html"
  ]) {
    const html = readFileSync(path, "utf8");
    assert.equal(html.includes('id="loadOlderOrdersBtn"'), true, path);
    assert.equal(html.includes("عرض طلبات أقدم"), true, path);
  }
});


test("PF01 active and history services keep server-side status filters before any index fallback", () => {
  const supermarket = readFileSync("core/supermarket/order-service.js","utf8");
  const restaurant = readFileSync("core/restaurant/order-service.js","utf8");
  const laundry = readFileSync("core/laundry/order-service.js","utf8");

  for (const source of [supermarket, restaurant]) {
    assert.equal(source.includes('where("status", "in", activeStatuses)'), true);
    assert.equal(source.includes('const historyStatuses = ["delivered","canceled"]'), true);
    assert.equal(source.includes('where("status", "in", historyStatuses)'), true);
  }
  assert.equal(laundry.includes('where("status","in",activeStatuses)'), true);
  assert.equal(laundry.includes('const historyStatuses=["done","canceled"]'), true);
  assert.equal(laundry.includes('where("status","in",historyStatuses)'), true);

  assert.equal(supermarket.includes("getCountFromServer"), true);
  assert.equal(restaurant.includes("getCountFromServer"), true);
  assert.equal(laundry.includes("getCountFromServer"), true);
});


test("PF02 admin defaults to paged users instead of reading the whole collection", () => {
  const source = readFileSync("admin/admin.js", "utf8");
  assert.equal(source.includes('getDocs(collection(db, "users"))'), false);
  assert.equal(source.includes("listUsersPage"), true);
  assert.equal(source.includes("startAfter(cursor)"), true);
  assert.equal(source.includes("limit(pageSize)"), true);
  assert.equal(source.includes("getCountFromServer"), true);
});

test("PF02 admin search is exhaustive only when a search term is present", () => {
  const source = readFileSync("admin/admin.js", "utf8");
  assert.equal(source.includes("searchAllUsers"), true);
  assert.equal(source.includes("if (search)"), true);
  assert.equal(source.includes("USERS_PAGINATION_STALLED"), true);
});

test("PF02 admin has one pagination control and server-side subscription filter", () => {
  const html = readFileSync("admin/index.html", "utf8");
  const source = readFileSync("admin/admin.js", "utf8");
  assert.equal((html.match(/id="loadMoreUsersBtn"/g) || []).length, 1);
  assert.equal(html.includes('id="usersStatusFilter"'), true);
  assert.equal(source.includes('where("subscriptionStatus", "==", status)'), true);
});


test("PF03 earnings service paginates commission ledger by user and createdAt", () => {
  const source = readFileSync("core/commissions/earnings-service.js", "utf8");
  assert.equal(source.includes('where("userId", "==", uid)'), true);
  assert.equal(source.includes('orderBy("createdAt", "desc")'), true);
  assert.equal(source.includes("startAfter(cursor)"), true);
  assert.equal(source.includes("limit(size)"), true);
  assert.equal(source.includes("fallback = 50"), true);
  assert.equal(source.includes("{ pageSize = 50, cursor = null } = {}"), true);
  assert.equal(source.includes("normalizePageSize(pageSize, 50)"), true);
  assert.equal(source.includes("getAggregateFromServer"), true);
  assert.equal(source.includes('sum("amount")'), true);
  assert.equal(source.includes("count()"), true);
});

test("PF03 does not invent an earnings screen when none existed before the task", () => {
  const html = readFileSync("workspace/index.html", "utf8");
  const source = readFileSync("workspace/app.js", "utf8");

  assert.equal(html.includes('id="earningsList"'), false);
  assert.equal(html.includes('class="earningsCard"'), false);
  assert.equal(source.includes("earnings-service.js"), false);
  assert.equal(source.includes("listUserCommissionLedgerPage"), false);
});

test("PF03 ledger pagination index is version controlled", () => {
  const config = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
  const found = config.indexes.some(index =>
    index.collectionGroup === "commissionLedger"
    && index.queryScope === "COLLECTION"
    && JSON.stringify(index.fields) === JSON.stringify([
      { fieldPath: "userId", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" }
    ])
  );
  assert.equal(found, true);
});

test("PF04 active owner project pages use server aggregates instead of loading the full commission ledger", () => {
  for (const path of [
    "supermarket/app.js",
    "restaurant/app.js",
    "bakery/app.js",
    "laundry/app.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("getProjectCommissionSummary"), true, path);
    assert.equal(source.includes('collection(db,"commissionLedger")'), false, path);
    assert.equal(source.includes('collection(db, "commissionLedger")'), false, path);
  }
});

test("PF04 project earnings aggregate keeps project isolation and paid compatibility", () => {
  const source = readFileSync("core/commissions/earnings-service.js", "utf8");
  assert.equal(source.includes('where("sourceType", "==", "project_order")'), true);
  assert.equal(source.includes('where("projectId", "==", pid)'), true);
  assert.equal(source.includes('where("status", "==", "paid")'), true);
  assert.equal(source.includes('where("paidAt", "!=", null)'), true);
  assert.equal(source.includes("paidByStatus.totalAmount + paidByTimestamp.totalAmount - paidOverlap.totalAmount"), true);
});

test("PF04 project earnings indexes are version controlled", () => {
  const config = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
  const expected = [
    ["userId","sourceType","projectId","status"],
    ["userId","sourceType","projectId","paidAt"],
    ["userId","sourceType","projectId","status","paidAt"]
  ];
  for (const fields of expected) {
    const found = config.indexes.some(index =>
      index.collectionGroup === "commissionLedger"
      && index.queryScope === "COLLECTION"
      && JSON.stringify(index.fields) === JSON.stringify(
        fields.map(fieldPath => ({ fieldPath, order: "ASCENDING" }))
      )
    );
    assert.equal(found, true, fields.join(","));
  }
});

test("PF06 restaurant and bakery menus keep one exhaustive initial load and update local state after mutations", () => {
  for (const path of [
    "restaurant-operator/menu.js",
    "bakery-operator/menu.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("menu=await listRestaurantMenu(projectId)"), true, path);
    assert.equal((source.match(/await loadMenu\(\)/g) || []).length, 1, path);
    assert.equal(source.includes("upsertLocalMenuItem"), true, path);
    assert.equal(source.includes("removeLocalMenuItem"), true, path);
    assert.equal(source.includes("getRestaurantMenuItem(projectId,itemId)"), true, path);
  }
});

test("PF06 menu service skips full metadata scans for non-structural edits", () => {
  const source = readFileSync("core/restaurant/menu-service.js", "utf8");
  assert.equal(source.includes("export async function getRestaurantMenuItem"), true);
  assert.equal(source.includes("const metadataChanged ="), true);
  assert.equal(source.includes('("category" in next'), true);
  assert.equal(source.includes('("isActive" in next'), true);
  assert.equal(source.includes('("isAvailable" in next'), true);
  assert.equal(source.includes("if (metadataChanged)"), true);
  assert.equal(source.includes("return {\n    itemId,\n    ...current,\n    ...next,"), true);
});


test("FINAL02 marketing page leads with the existing-business commission story", () => {
  const html = readFileSync("home/index.html", "utf8");
  assert.equal(html.includes("بدوسة زرار… يبقى عندك"), true);
  assert.equal(html.includes("المحل موجود. الزباين موجودين. التشغيل موجود."), true);
  assert.equal(html.includes("5 مصادر فلوس"), true);
  assert.equal(html.includes("الإحالات حلوة… بس العمولات هي اللعبة الكبيرة."), true);
  assert.equal(html.includes('href="/register/"'), false);
  assert.equal(html.includes('href="/login/"'), false);
});

test("FINAL02 marketing page uses live platform prices and exactly the four launch projects", () => {
  const source = readFileSync("home/app.js", "utf8");
  assert.equal(source.includes("PLATFORM_BILLING"), true);
  assert.equal(source.includes("REFERRAL_CONFIG"), true);
  for (const id of ["supermarket", "restaurant", "bakery", "laundry"]) {
    assert.equal(source.includes(`"${id}"`), true, id);
  }
  assert.equal(source.includes("getDiscoverableProjects"), true);
});


test("FINAL03 marketing page clearly explains the product the subscriber receives", () => {
  const html = readFileSync("home/index.html", "utf8");
  assert.equal(html.includes('id="magic"'), true);
  assert.equal(html.includes("إنت بتاخد إيه لما تشترك؟"), true);
  assert.equal(html.includes("زرار سحري"), true);
  assert.equal(html.includes("دخل رقم صاحبه"), true);
  assert.equal(html.includes("هو يستلم تطبيقه"), true);
  assert.equal(html.includes("إنت تابع العداد"), true);
  assert.equal(html.includes("عدادك إنت"), true);
  assert.equal(html.includes("عمولتك محسوبة"), true);
});

test("FINAL03 marketing page adds lively project-specific color language without changing business logic", () => {
  const css = readFileSync("home/style.css", "utf8");
  const source = readFileSync("home/app.js", "utf8");
  for (const token of ["--green:", "--orange:", "--gold:", "--blue:", "--purple:"]) {
    assert.equal(css.includes(token), true, token);
  }
  for (const project of ["supermarket", "restaurant", "bakery", "laundry"]) {
    assert.equal(css.includes(`.project-${project}`), true, project);
  }
  assert.equal(source.includes('projectCard project-${project.id}'), true);
});


test("FINAL04 workspace presents the operating journey instead of a plain service list", () => {
  const html = readFileSync("workspace/index.html", "utf8");
  const source = readFileSync("workspace/app.js", "utf8");
  assert.equal(html.includes("أداتك السريعة جاهزة"), true);
  assert.equal(html.includes("اختار النشاط"), true);
  assert.equal(html.includes("اربط صاحبه"), true);
  assert.equal(html.includes("تابع العداد"), true);
  assert.equal(html.includes('id="logoutBtn"'), true);
  assert.equal(html.includes('id="projectCount"'), true);
  assert.equal(source.includes('import { logoutUser }'), true);
  assert.equal(source.includes("await logoutUser()"), true);
  assert.equal(source.includes('window.location.href = projectManagementUrl(templateId, projectDocId)'), true);
});

test("FINAL04 workspace gives each active project a clear launch state and project-specific visual identity", () => {
  const source = readFileSync("workspace/app.js", "utf8");
  const css = readFileSync("workspace/style.css", "utf8");
  for (const id of ["supermarket", "restaurant", "bakery", "laundry"]) {
    assert.equal(source.includes(`${id}:`), true, id);
    assert.equal(css.includes(`.project-${id}`), true, id);
  }
  assert.equal(source.includes("جاهز للربط"), true);
  assert.equal(source.includes("مضاف لحسابك"), true);
  assert.equal(source.includes("شغّل المشروع"), true);
});

test("FINAL04 all active owner project pages expose the same three-stage operating journey", () => {
  for (const path of [
    "supermarket/index.html",
    "restaurant/index.html",
    "bakery/index.html",
    "laundry/index.html"
  ]) {
    const html = readFileSync(path, "utf8");
    assert.equal(html.includes('class="ownerJourney"'), true, path);
    assert.equal(html.includes("اربط النشاط"), true, path);
    assert.equal(html.includes("فعّل التشغيل"), true, path);
    assert.equal(html.includes("تابع عمولتك"), true, path);
  }

  for (const path of [
    "supermarket/app.js",
    "restaurant/app.js",
    "bakery/app.js",
    "laundry/app.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes('document.body.dataset.projectStage="setup"'), true, path);
    assert.equal(source.includes('accepted&&operator.isActive?"live":"activate"'), true, path);
  }
});

test("FINAL04 removes internal or incorrect owner-facing copy", () => {
  const laundry = readFileSync("laundry/index.html", "utf8");
  const bakery = readFileSync("bakery/index.html", "utf8");
  assert.equal(laundry.includes("Laundry 2.0"), false);
  assert.equal(bakery.includes("دعوة التشغيل للمطعم"), false);
  assert.equal(bakery.includes("دعوة التشغيل للمخبز"), true);
});


test("operator order services fall back only when Firestore reports a missing composite index", () => {
  for (const path of [
    "core/supermarket/order-service.js",
    "core/restaurant/order-service.js",
    "core/laundry/order-service.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("isMissingCompositeIndexError"), true, path);
    assert.equal(source.includes('code.includes("failed-precondition")'), true, path);
    assert.equal(source.includes('message.includes("index")'), true, path);
  }
});

test("missing-index fallback uses a projectId-only Firestore query and keeps template filtering client-side", () => {
  const supermarket = readFileSync("core/supermarket/order-service.js", "utf8");
  const restaurant = readFileSync("core/restaurant/order-service.js", "utf8");
  const laundry = readFileSync("core/laundry/order-service.js", "utf8");

  assert.equal(supermarket.includes("loadProjectOrderDocsWithoutCompositeIndex"), true);
  assert.equal(supermarket.includes('where("projectId", "==", projectId)'), true);
  assert.equal(supermarket.includes('item.data().templateType === "supermarket"'), true);

  assert.equal(restaurant.includes("loadProjectOrderDocsWithoutCompositeIndex(projectId, templateType)"), true);
  assert.equal(restaurant.includes("item.data().templateType === templateType"), true);

  assert.equal(laundry.includes("loadLaundryOrderDocsWithoutCompositeIndex"), true);
  assert.equal(laundry.includes('where("projectId","==",projectId)'), true);
  assert.equal(laundry.includes('item.data().templateType==="laundry"'), true);
});

test("missing-index fallback preserves active orders, history pagination, and delivered counts", () => {
  for (const path of [
    "core/supermarket/order-service.js",
    "core/restaurant/order-service.js",
    "core/laundry/order-service.js"
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("activeStatuses"), true, path);
    assert.equal(source.includes("historyStatuses"), true, path);
    assert.equal(source.includes("cursorIndex"), true, path);
    assert.equal(source.includes("getCountFromServer"), true, path);
  }
});


test("operator missing-index fallback constrains templateType so Firestore Rules can authorize the query", () => {
  const supermarket = readFileSync("core/supermarket/order-service.js", "utf8");
  const restaurant = readFileSync("core/restaurant/order-service.js", "utf8");
  const laundry = readFileSync("core/laundry/order-service.js", "utf8");

  assert.equal(supermarket.includes('where("templateType", "==", "supermarket")'), true);
  assert.equal(restaurant.includes('where("templateType", "==", templateType)'), true);
  assert.equal(laundry.includes('where("templateType","==","laundry")'), true);
});


test("FB-LAUNCH01 owner dashboards use neutral commission-count wording", () => {
  for (const path of [
    "supermarket/index.html",
    "restaurant/index.html",
    "bakery/index.html",
    "laundry/index.html"
  ]) {
    const html = readFileSync(path, "utf8");
    assert.equal(html.includes("قيمة العمولة المتفق عليها لكل طلب"), true, path);
    assert.equal(html.includes("عمولتك لكل طلب مكتمل"), false, path);
    assert.equal(html.includes("الطلبات المحتسبة"), true, path);
  }
});


test("FB-LAUNCH02 admin control center exposes platform operations sections", () => {
  const html = readFileSync("admin/index.html", "utf8");
  const source = readFileSync("admin/admin.js", "utf8");

  for (const marker of [
    "usersSection",
    "projectsSection",
    "operatorsSection",
    "ordersSection",
    "commissionsSection",
    "settlementsSection",
    "metricOutstanding",
    "metricPendingSettlements"
  ]) {
    assert.equal(html.includes(marker), true, marker);
  }

  for (const marker of [
    "loadOverview",
    "loadProjects",
    "loadOperators",
    "loadAdminOrders",
    "loadCommissions",
    "loadSettlements",
    "activateOrRenewUser"
  ]) {
    assert.equal(source.includes(marker), true, marker);
  }
});

test("FB-LAUNCH02 settlement service batches earned project commissions and pays them atomically", () => {
  const source = readFileSync("core/commissions/settlement-service.js", "utf8");

  assert.equal(source.includes("SETTLEMENT_ENTRY_LIMIT = 200"), true);
  assert.equal(source.includes('entry.status === "earned"'), true);
  assert.equal(source.includes("createProjectCommissionSettlement"), true);
  assert.equal(source.includes("markCommissionSettlementPaid"), true);
  assert.equal(source.includes("voidCommissionSettlement"), true);
  assert.equal(source.includes('status: "paid"'), true);
  assert.equal(source.includes('settlementStatus: "paid"'), true);
  assert.equal(source.includes("SETTLEMENT_TOTAL_MISMATCH"), true);
});

test("FB-LAUNCH02 admin avoids unsafe cascading project hard-delete controls", () => {
  const html = readFileSync("admin/index.html", "utf8");
  const source = readFileSync("admin/admin.js", "utf8");

  assert.equal(source.includes("deleteDoc"), false);
  assert.equal(html.includes("إيقاف المشروع"), false);
  assert.equal(source.includes("toggle-project"), true);
});

test("FB-LAUNCH02 rules protect settlement ownership and immutable commission value", () => {
  const rules = readFileSync("firestore.rules", "utf8");

  assert.equal(rules.includes("match /commissionSettlements/{settlementId}"), true);
  assert.equal(rules.includes('request.resource.data.amount == resource.data.amount'), true);
  assert.equal(rules.includes('"settlementId"'), true);
  assert.equal(rules.includes('"settlementStatus"'), true);
  assert.equal(rules.includes('"settlementCreatedAt"'), true);
});


test("FB-LAUNCH02 admin stays usable before production settlement Rules are deployed", () => {
  const source = readFileSync("admin/admin.js", "utf8");
  assert.equal(source.includes("Settlement metrics unavailable until production Rules are deployed."), true);
  assert.equal(source.includes('return null;'), true);
  assert.equal(source.includes("قسم التسويات جاهز في الكود ويحتاج نشر Firestore Rules الجديدة"), true);
});
