export function normalizeCatalogText(value = "") {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9\u0600-\u06ff.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function catalogSizeKey(...values) {
  const text = normalizeCatalogText(values.filter(Boolean).join(" "))
    .replace(/litres?|liters?|litre|liter|ltr/g, " l ")
    .replace(/millilitres?|milliliters?|millilitre|milliliter|ml/g, " ml ")
    .replace(/kilograms?|kilogram|kgs?|كجم/g, " kg ")
    .replace(/grams?|gram|gms?|جم/g, " g ")
    .replace(/لتر/g, " l ")
    .replace(/مل/g, " ml ")
    .replace(/×|x/gi, " x ");

  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g|قطعه|قطع|عبوه|عبوات|رول|كيس|اكياس|pcs?)/g)]
    .map(match => `${match[1]}${match[2]}`)
    .slice(0, 3)
    .join("x");
}

function baseName(value) {
  return normalizeCatalogText(value)
    .replace(/\b\d+(?:\.\d+)?\s*(ml|l|kg|g|مل|لتر|كجم|جم|قطعه|قطع|عبوه|عبوات|رول|كيس|اكياس|pcs?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function catalogIdentityKey(item = {}) {
  const name = baseName(item.name);
  const size = catalogSizeKey(item.size, item.name);
  return name ? `${name}|${size}` : "";
}

export function productIsActive(product = {}) {
  return product.isActive === true && product.inStock === true;
}

function directMasterProduct(master, products) {
  return products.find(product => String(product.masterId || "") === master.masterId)
    || products.find(product => product.productId === `master_${master.masterId}`)
    || null;
}

function identityMasterProduct(master, products) {
  const wanted = catalogIdentityKey(master);
  if (!wanted) return null;
  const matches = products.filter(product => catalogIdentityKey(product) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

export function findStoreProductForMaster(master, products = []) {
  return directMasterProduct(master, products)
    || identityMasterProduct(master, products)
    || null;
}

export function buildUnifiedCatalog(masterCatalog = [], storeProducts = []) {
  const consumed = new Set();
  const entries = masterCatalog.map(master => {
    const product = findStoreProductForMaster(master, storeProducts);
    if (product?.productId) consumed.add(product.productId);

    const added = Boolean(product);
    const active = added && productIsActive(product);

    return {
      key: `master:${master.masterId}`,
      kind: "master",
      master,
      product,
      added,
      status: !added ? "not_added" : active ? "active" : "paused",
      name: product?.name || master.name,
      brand: master.brand || "",
      category: product?.category || master.category || "أخرى",
      size: product?.size || master.size || "",
      price: added ? Number(product?.price || 0) : Number(master.referencePrice || 0),
      referencePrice: Number(master.referencePrice || 0),
      image: String(product?.image || master.image || "").trim(),
      source: product?.source || "master_catalog"
    };
  });

  storeProducts.forEach(product => {
    if (consumed.has(product.productId)) return;
    entries.push({
      key: `store:${product.productId}`,
      kind: "store",
      master: null,
      product,
      added: true,
      status: productIsActive(product) ? "active" : "paused",
      name: product.name || "",
      brand: "",
      category: product.category || "أخرى",
      size: product.size || "",
      price: Number(product.price || 0),
      referencePrice: null,
      image: String(product.image || "").trim(),
      source: product.source || "manual"
    });
  });

  return entries;
}

export function filterUnifiedCatalog(entries = [], {
  search = "",
  category = "الكل",
  status = "الكل",
  image = "الكل"
} = {}) {
  const q = normalizeCatalogText(search);

  return entries.filter(entry => {
    const searchable = normalizeCatalogText([
      entry.name,
      entry.brand,
      entry.category,
      entry.size,
      entry.product?.barcode
    ].filter(Boolean).join(" "));

    const matchesSearch = !q || searchable.includes(q);
    const matchesCategory = category === "الكل" || entry.category === category;
    const matchesStatus = status === "الكل" || entry.status === status;
    const hasImage = Boolean(entry.image);
    const matchesImage =
      image === "الكل"
      || (image === "with" && hasImage)
      || (image === "without" && !hasImage);

    return matchesSearch && matchesCategory && matchesStatus && matchesImage;
  });
}

export function unifiedCatalogStats(entries = []) {
  return entries.reduce((stats, entry) => {
    stats.total++;
    stats[entry.status] = (stats[entry.status] || 0) + 1;
    if (!entry.image) stats.withoutImage++;
    return stats;
  }, { total: 0, active: 0, paused: 0, not_added: 0, withoutImage: 0 });
}
