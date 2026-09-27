import db from "../firebase/firebase-db.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  startAfter,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function menuCollection(projectId) {
  return collection(db, "restaurants", projectId, "menu");
}

function clean(value) {
  return String(value || "").trim();
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_MENU_PRICE");
  return Math.round(n * 100) / 100;
}

export async function listRestaurantMenu(projectId, { availableOnly = false } = {}) {
  const ref = menuCollection(projectId);
  const snap = availableOnly
    ? await getDocs(
        query(
          ref,
          where("isActive", "==", true),
          where("isAvailable", "==", true)
        )
      )
    : await getDocs(ref);

  return snap.docs
    .map(item => ({ itemId: item.id, ...item.data() }))
    .sort((a,b) => {
      const categoryOrder = String(a.category || "").localeCompare(String(b.category || ""), "ar");
      return categoryOrder || String(a.name || "").localeCompare(String(b.name || ""), "ar");
    });
}

export async function listRestaurantMenuPage(
  projectId,
  {
    pageSize = 40,
    cursor = null,
    category = "الكل"
  } = {}
) {
  const constraints = [
    where("isActive", "==", true),
    where("isAvailable", "==", true)
  ];

  if (category && category !== "الكل") {
    constraints.push(where("category", "==", category));
  }

  if (cursor) {
    constraints.push(startAfter(cursor));
  }

  const size = Math.max(1, Math.min(100, Number(pageSize) || 40));
  constraints.push(limit(size));

  const snap = await getDocs(query(menuCollection(projectId), ...constraints));

  return {
    items: snap.docs.map(item => ({ itemId: item.id, ...item.data() })),
    cursor: snap.docs.at(-1) || cursor,
    hasMore: snap.size === size
  };
}

export async function addRestaurantMenuItem(projectId, actorUid, data = {}) {
  const name = clean(data.name);
  const category = clean(data.category || "أخرى");
  const ref = doc(menuCollection(projectId));

  if (!name) throw new Error("MENU_ITEM_NAME_REQUIRED");

  await setDoc(ref, {
    itemId: ref.id,
    projectId,
    name,
    category,
    description: clean(data.description),
    price: money(data.price),
    image: clean(data.image),
    isAvailable: data.isAvailable !== false,
    isActive: data.isActive !== false,
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedBy: actorUid,
    updatedAt: serverTimestamp()
  });

  return ref.id;
}

export async function updateRestaurantMenuItem(projectId, itemId, actorUid, updates = {}) {
  const ref = doc(db, "restaurants", projectId, "menu", itemId);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error("MENU_ITEM_NOT_FOUND");

  const next = {};

  if ("name" in updates) {
    const name = clean(updates.name);
    if (!name) throw new Error("MENU_ITEM_NAME_REQUIRED");
    next.name = name;
  }
  if ("category" in updates) next.category = clean(updates.category || "أخرى");
  if ("description" in updates) next.description = clean(updates.description);
  if ("price" in updates) next.price = money(updates.price);
  if ("image" in updates) next.image = clean(updates.image);
  if ("isAvailable" in updates) next.isAvailable = updates.isAvailable === true;
  if ("isActive" in updates) next.isActive = updates.isActive === true;

  next.updatedBy = actorUid;
  next.updatedAt = serverTimestamp();

  await updateDoc(ref, next);
}

export async function deleteRestaurantMenuItem(projectId, itemId) {
  const ref = doc(db, "restaurants", projectId, "menu", itemId);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error("MENU_ITEM_NOT_FOUND");

  await deleteDoc(ref);
}
