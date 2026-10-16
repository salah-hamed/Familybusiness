import db from "../firebase/firebase-db.js";
import { distanceInKm, geohashPrefixesForRadius, normalizeNearbyArea } from "./geospatial.js";

import {
  collection,
  getDocs,
  limit,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ACTIVE_TEMPLATES = new Set(["supermarket", "restaurant", "bakery", "laundry"]);
const MAX_PER_GEOHASH_CELL = 12;
const MAX_AREA_RESULTS = 40;
const MAX_DISPLAY_RESULTS = 30;

export async function findNearbyShops({ latitude, longitude, radiusKm = 2, excludeProjectId = "" }) {
  const centerLat = Number(latitude);
  const centerLng = Number(longitude);
  const radius = Number(radiusKm);
  const prefixes = geohashPrefixesForRadius(centerLat, centerLng, radius);
  const snapshots = await Promise.all(prefixes.map(prefix => getDocs(query(
    collection(db, "nearbyShops"),
    where("isListed", "==", true),
    where("geohash", "==", prefix),
    limit(MAX_PER_GEOHASH_CELL)
  ))));

  const shops = new Map();
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) {
      if (item.id === excludeProjectId || shops.has(item.id)) continue;
      const data = item.data();
      if (!isUsableListing(data) || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) continue;

      const distanceKm = distanceInKm(centerLat, centerLng, data.latitude, data.longitude);
      const withinDefaultArea = distanceKm <= 2;
      const withinDeliveryExpansion = radius === 5 && data.deliveryAvailable === true && distanceKm <= 5;
      if (distanceKm > radius || (radius === 5 && !withinDefaultArea && !withinDeliveryExpansion)) continue;

      shops.set(item.id, {
        projectId: item.id,
        template: data.template,
        name: data.name,
        area: data.area || "",
        deliveryAvailable: data.deliveryAvailable === true,
        distanceKm
      });
    }
  }

  return [...shops.values()]
    .sort((first, second) => first.distanceKm - second.distanceKm)
    .slice(0, MAX_DISPLAY_RESULTS);
}

export async function findNearbyShopsByArea({ area, excludeProjectId = "" }) {
  const areaKey = normalizeNearbyArea(area);
  if (!areaKey) return [];

  const snapshot = await getDocs(query(
    collection(db, "nearbyShops"),
    where("isListed", "==", true),
    where("areaKey", "==", areaKey),
    limit(MAX_AREA_RESULTS)
  ));

  return snapshot.docs
    .filter(item => item.id !== excludeProjectId && isUsableListing(item.data()))
    .map(item => ({
      projectId: item.id,
      template: item.data().template,
      name: item.data().name,
      area: item.data().area || "",
      deliveryAvailable: item.data().deliveryAvailable === true
    }))
    .sort((first, second) => first.name.localeCompare(second.name, "ar"));
}

function isUsableListing(data) {
  return data?.isListed === true
    && ACTIVE_TEMPLATES.has(data.template)
    && typeof data.name === "string"
    && data.name.trim().length > 0;
}
