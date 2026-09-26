import db from "../firebase/firebase-db.js";
import { findMasterProduct, LEGACY_MASTER_NAME_MAP, canonicalMasterId } from "./master-catalog.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function productsCollection(projectId) {
  return collection(db, "supermarkets", projectId, "products");
}

function normalizePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) throw new Error("INVALID_PRODUCT_PRICE");
  return Math.round(price * 100) / 100;
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeIdentityText(value) {
  return clean(value)
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

function normalizeSizeKey(...values) {
  const text = normalizeIdentityText(values.filter(Boolean).join(" "))
    .replace(/litres?|liters?|litre|liter|ltr/g, " l ")
    .replace(/millilitres?|milliliters?|millilitre|milliliter|ml/g, " ml ")
    .replace(/kilograms?|kilogram|kgs?|كجم/g, " kg ")
    .replace(/grams?|gram|gms?|جم/g, " g ")
    .replace(/لتر/g, " l ")
    .replace(/مل/g, " ml ")
    .replace(/×|x/gi, " x ");

  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g|قطعه|قطع|عبوه|عبوات|رول|كيس|اكياس|pcs?)/g)]
    .map(match => `${match[1]}${match[2]}`);

  return matches.slice(0, 3).join("x");
}

function baseProductName(value) {
  return normalizeIdentityText(value)
    .replace(/\b\d+(?:\.\d+)?\s*(ml|l|kg|g|مل|لتر|كجم|جم|قطعه|قطع|عبوه|عبوات|رول|كيس|اكياس|pcs?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value) {
  const compact = baseProductName(value).replace(/\s+/g, "");
  if (!compact) return [];
  if (compact.length < 2) return [compact];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
}

function nameSimilarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.length || !right.length) return 0;

  const counts = new Map();
  right.forEach(pair => counts.set(pair, (counts.get(pair) || 0) + 1));

  let overlap = 0;
  left.forEach(pair => {
    const count = counts.get(pair) || 0;
    if (!count) return;
    overlap++;
    counts.set(pair, count - 1);
  });

  return (2 * overlap) / (left.length + right.length);
}

function productIdentityKey(data = {}) {
  const name = baseProductName(data.name);
  const size = normalizeSizeKey(data.size, data.name);
  if (!name) return "";
  return `${name}|${size}`;
}

function findNameSizeDuplicate(items = [], candidate = {}) {
  const candidateName = baseProductName(candidate.name);
  const candidateSize = normalizeSizeKey(candidate.size, candidate.name);

  if (!candidateName) return null;

  const exactKey = productIdentityKey(candidate);
  const exact = items.find(item => productIdentityKey(item) === exactKey);
  if (exact) return exact;

  let best = null;
  let bestScore = 0;

  items.forEach(item => {
    const itemSize = normalizeSizeKey(item.size, item.name);

    if (candidateSize && itemSize && candidateSize !== itemSize) return;
    if ((!candidateSize || !itemSize) && baseProductName(item.name) !== candidateName) return;

    const score = nameSimilarity(item.name, candidate.name);
    if (score >= 0.9 && score > bestScore) {
      best = item;
      bestScore = score;
    }
  });

  return best;
}

function masterDescriptorTokens(master) {
  if (!master) return [];

  const brandCompact = normalizeIdentityText(master.brand).replace(/\s+/g, "");
  const ignored = new Set(["ml","kg","gm","ltr","liter","litre","water","milk","oil","gel"]);

  return String(master.masterId || "")
    .split("-")
    .map(token => normalizeIdentityText(token).replace(/\s+/g, ""))
    .filter(token =>
      token.length > 2
      && !/^\d/.test(token)
      && token !== brandCompact
      && !brandCompact.includes(token)
      && !ignored.has(token)
    );
}

function masterBrandSizeMatch(master, candidate = {}) {
  if (!master) return false;

  const brandCompact = normalizeIdentityText(master.brand).replace(/\s+/g, "");
  if (!brandCompact || brandCompact === "local") return false;

  const searchable = normalizeIdentityText([candidate.name, candidate.size].join(" "));
  const compact = searchable.replace(/\s+/g, "");
  if (!compact.includes(brandCompact)) return false;

  const masterSize = normalizeSizeKey(master.size, master.name);
  const candidateSize = normalizeSizeKey(candidate.size, candidate.name);

  return !(masterSize && candidateSize && masterSize !== candidateSize);
}

function masterMatchScore(master, candidate = {}) {
  if (!masterBrandSizeMatch(master, candidate)) return 0;

  const compact = normalizeIdentityText([candidate.name, candidate.size].join(" ")).replace(/\s+/g, "");
  const tokens = masterDescriptorTokens(master);

  // Brand + size alone can be ambiguous (e.g. regular vs diet).
  // Automatic cross-language merge therefore requires a distinctive SKU token.
  if (!tokens.length) return 0;

  const matchedTokens = tokens.filter(token => compact.includes(token)).length;
  if (matchedTokens === 0) return 0;

  return 100 + matchedTokens;
}

function findMasterLinkedDuplicate(items = [], candidate = {}) {
  let best = null;
  let bestScore = 0;
  let tied = false;

  items.forEach(item => {
    let score = 0;

    if (clean(item.masterId)) {
      score = masterMatchScore(findMasterProduct(item.masterId), candidate);
    } else if (clean(candidate.masterId)) {
      score = masterMatchScore(findMasterProduct(candidate.masterId), item);
    }

    if (!score) return;

    if (score > bestScore) {
      best = item;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  });

  return tied ? null : best;
}

function findProductDuplicate(items = [], candidate = {}) {
  return findNameSizeDuplicate(items, candidate)
    || findMasterLinkedDuplicate(items, candidate);
}

function duplicateBucketKey(item = {}) {
  const size = normalizeSizeKey(item.size, item.name) || "nosize";
  const master = clean(item.masterId) ? findMasterProduct(item.masterId) : null;
  const identity = master?.brand || item.name;
  const prefix = normalizeIdentityText(identity).replace(/\s+/g, "").slice(0, 4) || "misc";
  return `${size}|${prefix}`;
}

function shouldUseIncomingCategory(currentCategory, incomingCategory) {
  const current = clean(currentCategory);
  const incoming = clean(incomingCategory);
  if (!incoming) return false;
  if (!current || current === "أخرى") return true;
  return /carrefour|buy |shop |online|super market/i.test(current);
}

function chooseDuplicateKeeper(items = []) {
  return [...items].sort((a, b) => {
    const score = item =>
      (clean(item.masterId) ? 8 : 0)
      + (clean(item.image) ? 4 : 0)
      + (item.isActive === true ? 2 : 0)
      + (item.inStock === true ? 1 : 0);
    return score(b) - score(a);
  })[0] || null;
}

async function syncSupermarketCatalogMeta(projectId, suppliedProducts = null) {
  const current = suppliedProducts || await listStoreProducts(projectId);
  const categories = [...new Set(
    current
      .filter(item => item.isActive === true && item.inStock === true)
      .map(item => clean(item.category || "أخرى"))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ar"));

  try {
    await updateDoc(doc(db, "supermarkets", projectId), {
      catalogCategories: categories,
      catalogProductCount: current.length,
      catalogUpdatedAt: serverTimestamp()
    });
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) {
      return { categories, productCount: current.length, metadataPendingRules: true };
    }
    throw error;
  }

  return { categories, productCount: current.length, metadataPendingRules: false };
}

function productIdFor({ masterId = "", barcode = "" } = {}) {
  const safeMaster = clean(masterId).replace(/[^A-Za-z0-9_-]/g, "");
  if (safeMaster) return `master_${safeMaster}`;

  const safeBarcode = clean(barcode).replace(/\D/g, "");
  if (safeBarcode) return `barcode_${safeBarcode}`;

  return "";
}

export async function listStoreProducts(projectId, { activeOnly = false } = {}) {
  const snap = await getDocs(productsCollection(projectId));

  return snap.docs
    .map(item => ({ productId: item.id, ...item.data() }))
    .filter(item => !activeOnly || (item.isActive === true && item.inStock === true))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
}

export async function addStoreProduct(projectId, actorUid, data = {}) {
  const master = data.masterId ? findMasterProduct(data.masterId) : null;
  const name = clean(data.name || master?.name);
  const category = clean(data.category || master?.category || "أخرى");
  const barcode = clean(data.barcode).replace(/\D/g, "");
  const masterId = clean(data.masterId || master?.masterId);
  const explicitId = productIdFor({ masterId, barcode });

  if (!name) throw new Error("PRODUCT_NAME_REQUIRED");

  const identityKey = productIdentityKey({
    name,
    size: clean(data.size || master?.size)
  });
  const current = await listStoreProducts(projectId);
  const duplicate = identityKey
    ? findProductDuplicate(current, {
        name,
        size: clean(data.size || master?.size),
        masterId
      })
    : null;

  if (duplicate && (!explicitId || duplicate.productId !== explicitId)) {
    throw new Error("PRODUCT_ALREADY_EXISTS");
  }

  const ref = explicitId ? doc(productsCollection(projectId), explicitId) : doc(productsCollection(projectId));
  const existing = await getDoc(ref);
  const now = serverTimestamp();

  const payload = {
    productId: ref.id,
    projectId,
    name,
    category,
    size: clean(data.size || master?.size),
    barcode,
    image: clean(data.image || master?.image),
    price: normalizePrice(data.price),
    inStock: data.inStock !== false,
    isActive: data.isActive !== false,
    source: masterId ? "master_catalog" : barcode ? "barcode" : "manual",
    masterId,
    updatedBy: actorUid,
    updatedAt: now
  };

  if (!existing.exists()) {
    payload.createdBy = actorUid;
    payload.createdAt = now;
  }

  await setDoc(ref, payload, { merge: true });

  return ref.id;
}


export async function bulkAddMasterProducts(projectId, actorUid, selections = []) {
  const requested = Array.isArray(selections) ? selections : [];
  const current = await listStoreProducts(projectId);
  const existingMasterIds = new Set(
    current
      .map(item => canonicalMasterId(clean(item.masterId)))
      .filter(Boolean)
  );

  const rows = requested
    .map(item => {
      const master = findMasterProduct(item?.masterId);
      if (!master || existingMasterIds.has(master.masterId)) return null;

      const equivalent = findProductDuplicate(current, {
        name: master.name,
        size: master.size,
        masterId: master.masterId
      });
      if (equivalent) return null;

      return {
        master,
        price: normalizePrice(item?.price ?? master.referencePrice ?? 0),
        image: clean(item?.image || master.image)
      };
    })
    .filter(Boolean);

  if (!rows.length) {
    return { added: 0, skipped: requested.length };
  }

  const batch = writeBatch(db);
  const now = serverTimestamp();

  rows.forEach(({ master, price, image }) => {
    const ref = doc(productsCollection(projectId), `master_${master.masterId}`);

    batch.set(ref, {
      productId: ref.id,
      projectId,
      name: clean(master.name),
      category: clean(master.category || "أخرى"),
      size: clean(master.size),
      barcode: "",
      image: clean(image || master.image),
      price,
      inStock: true,
      isActive: true,
      source: "master_catalog",
      masterId: master.masterId,
      createdBy: actorUid,
      createdAt: now,
      updatedBy: actorUid,
      updatedAt: now
    });
  });

  await batch.commit();

  return {
    added: rows.length,
    skipped: requested.length - rows.length
  };
}


export async function deleteStoreProduct(projectId, productId) {
  const ref = doc(db, "supermarkets", projectId, "products", productId);
  const current = await getDoc(ref);

  if (!current.exists()) throw new Error("PRODUCT_NOT_FOUND");

  await deleteDoc(ref);
}


export async function syncLegacyMasterProductDetails(projectId, actorUid) {
  const current = await listStoreProducts(projectId);
  const batch = writeBatch(db);
  let changed = 0;

  current.forEach(product => {
    const legacyId = clean(product.masterId);
    if (!legacyId) return;

    const legacyName = LEGACY_MASTER_NAME_MAP[legacyId];
    const master = findMasterProduct(legacyId);

    if (!legacyName || !master || clean(product.name) !== legacyName) return;

    const ref = doc(db, "supermarkets", projectId, "products", product.productId);

    batch.update(ref, {
      name: clean(master.name),
      category: clean(master.category || product.category || "أخرى"),
      size: clean(master.size || product.size),
      image: clean(master.image || product.image),
      updatedBy: actorUid,
      updatedAt: serverTimestamp()
    });

    changed++;
  });

  if (changed) await batch.commit();

  return changed;
}

export async function updateStoreProduct(projectId, productId, actorUid, updates = {}) {
  const ref = doc(db, "supermarkets", projectId, "products", productId);
  const current = await getDoc(ref);

  if (!current.exists()) throw new Error("PRODUCT_NOT_FOUND");

  const next = {};

  if ("name" in updates) next.name = clean(updates.name);
  if ("category" in updates) next.category = clean(updates.category);
  if ("size" in updates) next.size = clean(updates.size);
  if ("barcode" in updates) next.barcode = clean(updates.barcode).replace(/\D/g, "");
  if ("image" in updates) next.image = clean(updates.image);
  if ("price" in updates) next.price = normalizePrice(updates.price);
  if ("inStock" in updates) next.inStock = updates.inStock === true;
  if ("isActive" in updates) next.isActive = updates.isActive === true;

  next.updatedBy = actorUid;
  next.updatedAt = serverTimestamp();

  await updateDoc(ref, next);
}

export async function findStoreProductByBarcode(projectId, barcode) {
  const normalized = clean(barcode).replace(/\D/g, "");
  if (!normalized) return null;

  const snap = await getDocs(
    query(productsCollection(projectId), where("barcode", "==", normalized))
  );

  if (snap.empty) return null;

  const first = snap.docs[0];
  return { productId: first.id, ...first.data() };
}

export async function bulkImportStoreProducts(projectId, actorUid, rows = []) {
  const validRows = rows
    .map(row => ({
      name: clean(
        row.name
        || row.product
        || row["اسم المنتج"]
        || row["المنتج"]
        || row["اسم الصنف"]
      ),
      category: clean(
        row.category
        || row["التصنيف"]
        || row["القسم"]
        || row["الفئة"]
        || "أخرى"
      ),
      price: Number(
        row.price
        ?? row["السعر"]
        ?? row["السعر (ج.م)"]
        ?? row["سعر"]
        ?? row["السعر بالجنيه"]
      ),
      barcode: clean(
        row.barcode
        || row["الباركود"]
        || row["باركود"]
      ).replace(/\D/g, ""),
      size: clean(
        row.size
        || row["الحجم"]
        || row["المقاس"]
        || row["العبوة"]
      ),
      image: clean(
        row["رابط الصورة"]
        || row.image
        || row["الصورة"]
      ),
      externalId: clean(
        row["رقم المنتج بالمتجر"]
        || row["رقم المنتج"]
        || row["product id"]
        || row["product_id"]
      ).replace(/[^A-Za-z0-9_-]/g, "")
    }))
    .filter(row => row.name && Number.isFinite(row.price) && row.price >= 0);

  const current = await listStoreProducts(projectId);
  const byProductId = new Map(current.map(item => [item.productId, item]));
  const byIdentity = new Map();

  current.forEach(item => {
    const key = productIdentityKey(item);
    if (key && !byIdentity.has(key)) byIdentity.set(key, item);
  });

  let added = 0;
  let updated = 0;
  let duplicateRows = 0;
  const operations = [];

  for (const row of validRows) {
    const deterministicId = row.externalId ? `import_${row.externalId}` : "";
    const identityKey = productIdentityKey(row);

    let existing =
      (deterministicId ? byProductId.get(deterministicId) : null)
      || (identityKey ? byIdentity.get(identityKey) : null)
      || findProductDuplicate([...byProductId.values()], row);

    if (existing) {
      const patch = {
        updatedBy: actorUid,
        updatedAt: serverTimestamp()
      };

      if (!clean(existing.image) && row.image) patch.image = row.image;
      if (!clean(existing.size) && row.size) patch.size = row.size;
      if (!clean(existing.barcode) && row.barcode) patch.barcode = row.barcode;
      if (
        row.category
        && (
          existing.source === "master_catalog"
          || shouldUseIncomingCategory(existing.category, row.category)
        )
      ) {
        patch.category = row.category;
      }

      operations.push({
        type: "update",
        ref: doc(db, "supermarkets", projectId, "products", existing.productId),
        data: patch
      });

      existing = { ...existing, ...patch };
      byProductId.set(existing.productId, existing);
      if (identityKey) byIdentity.set(identityKey, existing);
      updated++;
      duplicateRows++;
      continue;
    }

    const ref = deterministicId
      ? doc(productsCollection(projectId), deterministicId)
      : doc(productsCollection(projectId));
    const now = serverTimestamp();

    const payload = {
      productId: ref.id,
      projectId,
      name: row.name,
      category: row.category,
      size: row.size,
      barcode: row.barcode,
      image: row.image,
      price: normalizePrice(row.price),
      inStock: true,
      isActive: true,
      source: "import",
      masterId: "",
      createdBy: actorUid,
      createdAt: now,
      updatedBy: actorUid,
      updatedAt: now
    };

    operations.push({ type: "set", ref, data: payload });

    const local = { ...payload, createdAt: null, updatedAt: null };
    byProductId.set(ref.id, local);
    if (identityKey) byIdentity.set(identityKey, local);
    added++;
  }

  for (let start = 0; start < operations.length; start += 350) {
    const batch = writeBatch(db);
    operations.slice(start, start + 350).forEach(operation => {
      if (operation.type === "update") batch.update(operation.ref, operation.data);
      else batch.set(operation.ref, operation.data);
    });
    await batch.commit();
  }


  return {
    imported: validRows.length,
    added,
    updated,
    duplicateRows
  };
}

export async function mergeDuplicateStoreProducts(projectId, actorUid) {
  const current = await listStoreProducts(projectId);
  const duplicateGroups = [];
  const buckets = new Map();

  current.forEach(item => {
    const key = duplicateBucketKey(item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });

  buckets.forEach(bucket => {
    const used = new Set();

    if (bucket.length === 2) {
      const masterItem = bucket.find(item => clean(item.masterId));
      const otherItem = bucket.find(item => !clean(item.masterId));

      if (
        masterItem
        && otherItem
        && masterBrandSizeMatch(findMasterProduct(masterItem.masterId), otherItem)
      ) {
        duplicateGroups.push([masterItem, otherItem]);
        return;
      }
    }

    bucket.forEach(item => {
      if (used.has(item.productId)) return;

      const group = [item];
      used.add(item.productId);

      bucket.forEach(candidate => {
        if (used.has(candidate.productId)) return;

        const match = findProductDuplicate([item], candidate);
        if (!match) return;

        group.push(candidate);
        used.add(candidate.productId);
      });

      if (group.length > 1) duplicateGroups.push(group);
    });
  });
  const operations = [];
  let removed = 0;
  let enriched = 0;

  duplicateGroups.forEach(items => {
    const keeper = chooseDuplicateKeeper(items);
    if (!keeper) return;

    const others = items.filter(item => item.productId !== keeper.productId);
    const bestImage = clean(keeper.image) || clean(items.find(item => clean(item.image))?.image);
    const bestSize = clean(keeper.size) || clean(items.find(item => clean(item.size))?.size);
    const bestBarcode = clean(keeper.barcode) || clean(items.find(item => clean(item.barcode))?.barcode);
    const validCategory = item => {
      const value = clean(item?.category);
      return value && value !== "أخرى" && !/carrefour|buy |shop |online/i.test(value);
    };
    const bestCategory =
      clean(items.find(item => item.source === "import" && validCategory(item))?.category)
      || clean(items.find(item => validCategory(item))?.category)
      || clean(keeper.category || "أخرى");

    const patch = {
      updatedBy: actorUid,
      updatedAt: serverTimestamp()
    };

    if (bestImage && bestImage !== clean(keeper.image)) patch.image = bestImage;
    if (bestSize && bestSize !== clean(keeper.size)) patch.size = bestSize;
    if (bestBarcode && bestBarcode !== clean(keeper.barcode)) patch.barcode = bestBarcode;
    if (bestCategory && bestCategory !== clean(keeper.category)) patch.category = bestCategory;

    if (Object.keys(patch).length > 2) {
      operations.push({
        type: "update",
        ref: doc(db, "supermarkets", projectId, "products", keeper.productId),
        data: patch
      });
      enriched++;
    }

    others.forEach(item => {
      operations.push({
        type: "delete",
        ref: doc(db, "supermarkets", projectId, "products", item.productId)
      });
      removed++;
    });
  });

  for (let start = 0; start < operations.length; start += 350) {
    const batch = writeBatch(db);
    operations.slice(start, start + 350).forEach(operation => {
      if (operation.type === "delete") batch.delete(operation.ref);
      else batch.update(operation.ref, operation.data);
    });
    await batch.commit();
  }


  return {
    groups: duplicateGroups.length,
    removed,
    enriched
  };
}

export async function bulkUpdateStoreProducts(projectId, productIds, actorUid, updates = {}) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return 0;

  const patch = {
    updatedBy: actorUid,
    updatedAt: serverTimestamp()
  };

  if ("category" in updates) patch.category = clean(updates.category || "أخرى");
  if ("inStock" in updates) patch.inStock = updates.inStock === true;
  if ("isActive" in updates) patch.isActive = updates.isActive === true;

  for (let start = 0; start < ids.length; start += 350) {
    const batch = writeBatch(db);
    ids.slice(start, start + 350).forEach(productId => {
      batch.update(doc(db, "supermarkets", projectId, "products", productId), patch);
    });
    await batch.commit();
  }

  return ids.length;
}

export async function bulkDeleteStoreProducts(projectId, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return 0;

  for (let start = 0; start < ids.length; start += 350) {
    const batch = writeBatch(db);
    ids.slice(start, start + 350).forEach(productId => {
      batch.delete(doc(db, "supermarkets", projectId, "products", productId));
    });
    await batch.commit();
  }

  return ids.length;
}

export async function refreshSupermarketCatalogMeta(projectId, suppliedProducts = null) {
  return syncSupermarketCatalogMeta(projectId, suppliedProducts);
}
