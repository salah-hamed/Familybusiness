import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildUnifiedCatalog,
  filterUnifiedCatalog,
  unifiedCatalogStats
} from "../core/supermarket/catalog-view-model.js";
import {
  SUPERMARKET_MASTER_CATALOG,
  SUPERMARKET_DAILY_ESSENTIAL_MASTER_IDS,
  findMasterProduct
} from "../core/supermarket/master-catalog.js";

const masters = [
  {
    masterId: "pepsi-1l",
    brand: "Pepsi",
    name: "بيبسي - 1 لتر",
    category: "مياه ومشروبات",
    size: "1 لتر",
    referencePrice: 30,
    image: ""
  },
  {
    masterId: "milk-1l",
    brand: "Milk",
    name: "لبن كامل الدسم - 1 لتر",
    category: "ألبان وبيض",
    size: "1 لتر",
    referencePrice: 45,
    image: "https://example.com/milk.jpg"
  }
];

test("unified catalog merges master product with store product", () => {
  const entries = buildUnifiedCatalog(masters, [
    {
      productId: "master_pepsi-1l",
      masterId: "pepsi-1l",
      name: "بيبسي - 1 لتر",
      category: "مياه ومشروبات",
      size: "1 لتر",
      price: 33,
      image: "https://example.com/pepsi.jpg",
      isActive: true,
      inStock: true,
      source: "master_catalog"
    }
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].status, "active");
  assert.equal(entries[0].price, 33);
  assert.equal(entries[0].image, "https://example.com/pepsi.jpg");
  assert.equal(entries[1].status, "not_added");
});

test("imported same-name/size product is treated as the master product", () => {
  const entries = buildUnifiedCatalog(masters, [
    {
      productId: "import_123",
      masterId: "",
      name: "بيبسي - 1 لتر",
      category: "مياه ومشروبات",
      size: "1 لتر",
      price: 34,
      image: "https://example.com/imported-pepsi.jpg",
      isActive: true,
      inStock: true,
      source: "import"
    }
  ]);

  const pepsi = entries.find(entry => entry.master?.masterId === "pepsi-1l");
  assert.equal(pepsi.added, true);
  assert.equal(pepsi.product.productId, "import_123");
  assert.equal(pepsi.image, "https://example.com/imported-pepsi.jpg");
});

test("paused store product is represented once with paused state", () => {
  const entries = buildUnifiedCatalog(masters, [
    {
      productId: "master_pepsi-1l",
      masterId: "pepsi-1l",
      name: "بيبسي - 1 لتر",
      category: "مياه ومشروبات",
      size: "1 لتر",
      price: 33,
      image: "",
      isActive: false,
      inStock: false
    }
  ]);

  assert.equal(entries.filter(entry => entry.master?.masterId === "pepsi-1l").length, 1);
  assert.equal(entries[0].status, "paused");
});

test("custom store products live in the same unified list", () => {
  const entries = buildUnifiedCatalog(masters, [
    {
      productId: "manual_x",
      masterId: "",
      name: "منتج خاص",
      category: "أخرى",
      size: "",
      price: 10,
      image: "",
      isActive: true,
      inStock: true,
      source: "manual"
    }
  ]);

  const custom = entries.find(entry => entry.product?.productId === "manual_x");
  assert.equal(custom.kind, "store");
  assert.equal(custom.status, "active");
});

test("unified catalog search and status filters work across master and store items", () => {
  const entries = buildUnifiedCatalog(masters, [
    {
      productId: "master_pepsi-1l",
      masterId: "pepsi-1l",
      name: "بيبسي - 1 لتر",
      category: "مياه ومشروبات",
      size: "1 لتر",
      price: 33,
      image: "",
      isActive: true,
      inStock: true
    }
  ]);

  assert.equal(filterUnifiedCatalog(entries, { search: "بيبسي" }).length, 1);
  assert.equal(filterUnifiedCatalog(entries, { status: "not_added" }).length, 1);
  assert.equal(filterUnifiedCatalog(entries, { image: "without" }).length, 1);
});

test("catalog stats describe the whole unified catalog", () => {
  const entries = buildUnifiedCatalog(masters, [
    {
      productId: "master_pepsi-1l",
      masterId: "pepsi-1l",
      name: "بيبسي - 1 لتر",
      category: "مياه ومشروبات",
      size: "1 لتر",
      price: 33,
      image: "",
      isActive: true,
      inStock: true
    }
  ]);

  const stats = unifiedCatalogStats(entries);
  assert.deepEqual(stats, {
    total: 2,
    active: 1,
    paused: 0,
    not_added: 1,
    withoutImage: 1
  });
});

test("operator page exposes one unified catalog instead of split master/store sections", () => {
  const html = readFileSync("supermarket-operator/products.html", "utf8");
  assert.equal(html.includes('id="unifiedCatalog"'), true);
  assert.equal(html.includes('id="masterCatalog"'), false);
  assert.equal(html.includes('id="productsList"'), false);
  assert.equal(html.includes("إدارة منتجات السوبرماركت"), false);
});

test("operator catalog loads complete store product set and refreshes catalog metadata", () => {
  const source = readFileSync("supermarket-operator/products.js", "utf8");
  assert.equal(source.includes("listStoreProducts(projectId)"), true);
  assert.equal(source.includes("listStoreProductsPage"), false);
  assert.equal(source.includes("refreshSupermarketCatalogMeta(projectId, products)"), true);
});

test("customer search exhausts remaining pages and broken images have a fallback", () => {
  const source = readFileSync("templates/supermarket/app.js", "utf8");
  assert.equal(source.includes("completeSearchAcrossLoadedCategory"), true);
  assert.equal(source.includes("while(hasMoreProducts"), true);
  assert.equal(source.includes("data-image-fallback"), true);
  assert.equal(source.includes("attachProductImageFallbacks"), true);
});

test("operator catalog image renderer has a broken-image fallback", () => {
  const source = readFileSync("supermarket-operator/products.js", "utf8");
  assert.equal(source.includes("data-image-fallback"), true);
  assert.equal(source.includes("attachImageFallbacks"), true);
});

test("all DOM ids referenced directly by operator catalog exist in products.html", () => {
  const source = readFileSync("supermarket-operator/products.js", "utf8");
  const html = readFileSync("supermarket-operator/products.html", "utf8");
  const ids = [...source.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]);

  for (const id of new Set(ids)) {
    assert.equal(html.includes(`id="${id}"`), true, `missing DOM id: ${id}`);
  }
});


test("uploaded master catalog exposes exactly 2000 selectable products with unique ids and images", () => {
  assert.equal(SUPERMARKET_MASTER_CATALOG.length, 2000);

  const ids = SUPERMARKET_MASTER_CATALOG.map(item => item.masterId);
  const images = SUPERMARKET_MASTER_CATALOG.map(item => String(item.image || "").trim());

  assert.equal(new Set(ids).size, 2000);
  assert.equal(images.filter(Boolean).length, 2000);
  assert.equal(images.every(value => /^https?:\/\//i.test(value)), true);
});

test("daily essentials list points only to uploaded master products", () => {
  assert.equal(SUPERMARKET_DAILY_ESSENTIAL_MASTER_IDS.length, 120);
  assert.equal(new Set(SUPERMARKET_DAILY_ESSENTIAL_MASTER_IDS).size, 120);

  const visibleIds = new Set(SUPERMARKET_MASTER_CATALOG.map(item => item.masterId));
  assert.equal(
    SUPERMARKET_DAILY_ESSENTIAL_MASTER_IDS.every(id => visibleIds.has(id)),
    true
  );
});

test("legacy master ids remain readable without appearing in the visible 2000-product library", () => {
  assert.ok(findMasterProduct("pepsi-1l"));
  assert.equal(
    SUPERMARKET_MASTER_CATALOG.some(item => item.masterId === "pepsi-1l"),
    false
  );
});

test("customer supermarket opens on daily essentials and search can switch to the full catalog", () => {
  const source = readFileSync("templates/supermarket/app.js", "utf8");
  const html = readFileSync("templates/supermarket/index.html", "utf8");

  assert.equal(source.includes('let category=DAILY_HOME'), true);
  assert.equal(source.includes("loadDailyEssentials"), true);
  assert.equal(source.includes('where(documentId(),"in",ids)'), true);
  assert.equal(source.includes('category="الكل"'), true);
  assert.equal(html.includes('id="catalogHeading"'), true);
  assert.equal(html.includes("الأكثر طلبًا للبيت المصري"), true);
});
