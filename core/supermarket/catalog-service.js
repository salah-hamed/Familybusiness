import db from "../firebase/firebase-db.js";
import { findMasterProduct } from "./master-catalog.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
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
  const ref = explicitId ? doc(productsCollection(projectId), explicitId) : doc(productsCollection(projectId));

  if (!name) throw new Error("PRODUCT_NAME_REQUIRED");

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
      name: clean(row.name || row.product || row["اسم المنتج"]),
      category: clean(row.category || row["التصنيف"] || "أخرى"),
      price: Number(row.price ?? row["السعر"]),
      barcode: clean(row.barcode || row["الباركود"]).replace(/\D/g, ""),
      size: clean(row.size || row["الحجم"]),
      image: clean(row.image || row["الصورة"])
    }))
    .filter(row => row.name && Number.isFinite(row.price) && row.price >= 0);

  const current = await listStoreProducts(projectId);
  const byBarcode = new Map(
    current.filter(item => item.barcode).map(item => [item.barcode, item])
  );

  let imported = 0;

  for (let start = 0; start < validRows.length; start += 350) {
    const batch = writeBatch(db);
    const chunk = validRows.slice(start, start + 350);

    chunk.forEach(row => {
      const existing = row.barcode ? byBarcode.get(row.barcode) : null;
      const ref = existing
        ? doc(db, "supermarkets", projectId, "products", existing.productId)
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
        updatedBy: actorUid,
        updatedAt: now
      };

      if (existing) {
        const {
          source,
          masterId,
          ...updatePayload
        } = payload;
        batch.update(ref, updatePayload);
      } else {
        batch.set(ref, {
          ...payload,
          createdBy: actorUid,
          createdAt: now
        });
      }
    });

    await batch.commit();
    imported += chunk.length;
  }

  return imported;
}
