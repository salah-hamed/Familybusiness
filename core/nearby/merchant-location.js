import db from "../firebase/firebase-db.js";
import { geohashForLocation, normalizeNearbyArea, roundNearbyCoordinate } from "./geospatial.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ACTIVE_TEMPLATES = new Set(["supermarket", "restaurant", "bakery", "laundry"]);
const panelState = new WeakMap();

export async function bindNearbyShopManager({ projectId, templateId, ownerId, shopName }) {
  const panel = document.getElementById("nearbyListingCard");
  if (!panel || !projectId || !ACTIVE_TEMPLATES.has(templateId) || !ownerId) return;

  let state = panelState.get(panel);
  if (!state) {
    state = bindControls(panel, { projectId, templateId, ownerId, getShopName: shopName });
    panelState.set(panel, state);
  }

  await loadListing(panel, projectId, state);
}

function bindControls(panel, { projectId, templateId, ownerId, getShopName }) {
  const captureButton = panel.querySelector("#captureNearbyLocationBtn");
  const saveButton = panel.querySelector("#saveNearbyListingBtn");
  const areaInput = panel.querySelector("#nearbyShopArea");
  const listedInput = panel.querySelector("#nearbyShopListed");
  const deliveryInput = panel.querySelector("#nearbyShopDelivery");
  const coordinateStatus = panel.querySelector("#nearbyCoordinateStatus");
  const message = panel.querySelector("#nearbyListingMessage");
  const state = { latitude: null, longitude: null, loaded: false };

  captureButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      coordinateStatus.textContent = "الجهاز لا يدعم تحديد الموقع. أضف اسم المنطقة بدلًا منه.";
      return;
    }

    captureButton.disabled = true;
    coordinateStatus.textContent = "جارٍ تحديد موقع تقريبي للمحل...";
    navigator.geolocation.getCurrentPosition(position => {
      state.latitude = roundNearbyCoordinate(position.coords.latitude);
      state.longitude = roundNearbyCoordinate(position.coords.longitude);
      coordinateStatus.textContent = "تم تحديد موقع تقريبي (بدقة عرض نحو 100 متر). احفظه ليظهر المحل للعملاء.";
      captureButton.disabled = false;
    }, () => {
      coordinateStatus.textContent = "تعذر تحديد الموقع. يمكنك إدخال اسم المنطقة والبحث بها.";
      captureButton.disabled = false;
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  saveButton.addEventListener("click", async () => {
    const area = areaInput.value.trim().slice(0, 80);
    const areaKey = normalizeNearbyArea(area);
    const isListed = listedInput.checked;
    const currentName = typeof getShopName === "function" ? getShopName() : getShopName;
    const name = String(currentName || "").trim().slice(0, 120);

    if (!name) {
      message.textContent = "احفظ بيانات المحل أولًا ثم أضف موقعه.";
      return;
    }
    if (isListed && state.latitude == null && !areaKey) {
      message.textContent = "حدد موقع المحل أو اكتب المنطقة قبل تفعيله في البحث.";
      return;
    }

    saveButton.disabled = true;
    message.textContent = "جارٍ حفظ إعدادات الظهور...";
    try {
      const data = {
        projectId,
        template: templateId,
        name,
        area,
        areaKey,
        deliveryAvailable: deliveryInput.checked,
        isListed,
        updatedAt: serverTimestamp()
      };
      if (state.latitude != null && state.longitude != null) {
        data.latitude = state.latitude;
        data.longitude = state.longitude;
        data.geohash = geohashForLocation(state.latitude, state.longitude, 5);
      }

      await setDoc(doc(db, "nearbyShops", projectId), data);
      state.loaded = true;
      message.textContent = isListed
        ? "تم حفظ إعدادات الظهور. موقعك التقريبي متاح الآن للعملاء الذين يختارون البحث القريب."
        : "تم إخفاء المحل من دليل المحلات القريبة.";
    } catch (error) {
      console.error("Nearby shop listing save failed", error);
      message.textContent = "تعذر حفظ إعدادات الظهور. تأكد من اتصالك وحاول مرة أخرى.";
    } finally {
      saveButton.disabled = false;
    }
  });

  return state;
}

async function loadListing(panel, projectId, state) {
  const message = panel.querySelector("#nearbyListingMessage");
  try {
    const snapshot = await getDoc(doc(db, "nearbyShops", projectId));
    const areaInput = panel.querySelector("#nearbyShopArea");
    const listedInput = panel.querySelector("#nearbyShopListed");
    const deliveryInput = panel.querySelector("#nearbyShopDelivery");
    const coordinateStatus = panel.querySelector("#nearbyCoordinateStatus");

    if (!snapshot.exists()) {
      coordinateStatus.textContent = "لم يتم حفظ موقع للمحل بعد.";
      return;
    }

    const listing = snapshot.data();
    areaInput.value = listing.area || "";
    listedInput.checked = listing.isListed === true;
    deliveryInput.checked = listing.deliveryAvailable === true;
    state.latitude = Number.isFinite(listing.latitude) ? listing.latitude : null;
    state.longitude = Number.isFinite(listing.longitude) ? listing.longitude : null;
    coordinateStatus.textContent = Number.isFinite(listing.latitude) && Number.isFinite(listing.longitude)
      ? "يوجد موقع تقريبي محفوظ. اضغط تحديد الموقع لتحديثه."
      : "يمكن للعملاء العثور على المحل باسم المنطقة.";
    if (listing.isListed === true) {
      message.textContent = "المحل ظاهر في دليل المحلات القريبة.";
    }
  } catch (error) {
    console.error("Nearby shop listing load failed", error);
    message.textContent = "تعذر تحميل إعدادات المحلات القريبة.";
  }
}
