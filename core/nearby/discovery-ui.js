const ACTIVE_TEMPLATES = ["supermarket", "restaurant", "bakery", "laundry"];
const CATEGORY_LABELS = Object.freeze({
  supermarket: "سوبر ماركت",
  restaurant: "مطاعم",
  bakery: "مخابز",
  laundry: "مغاسل"
});

export function bindNearbyShopDiscovery({ currentProjectId }) {
  const button = document.getElementById("nearbyDiscoverBtn");
  const panel = document.getElementById("nearbyDiscoveryPanel");
  if (!button || !panel || button.dataset.bound === "true") return;
  button.dataset.bound = "true";

  const status = document.getElementById("nearbyDiscoveryStatus");
  const results = document.getElementById("nearbyDiscoveryResults");
  const radiusTwo = document.getElementById("nearbyRadius2Btn");
  const radiusFive = document.getElementById("nearbyRadius5Btn");
  const areaInput = document.getElementById("nearbyAreaSearch");
  const areaButton = document.getElementById("nearbyAreaSearchBtn");
  let currentLocation = null;
  let busy = false;

  button.addEventListener("click", () => {
    panel.classList.remove("hidden");
    if (!navigator.geolocation) {
      status.textContent = "تحديد الموقع غير متاح على هذا الجهاز. ابحث باسم المنطقة بدلًا منه.";
      areaInput.focus();
      return;
    }

    busy = true;
    button.disabled = true;
    status.textContent = "سنستخدم موقعك الآن للبحث فقط، ولن نحفظه. جارٍ تحديد موقعك...";
    navigator.geolocation.getCurrentPosition(async position => {
      currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      await searchByRadius(2);
      busy = false;
      button.disabled = false;
    }, () => {
      status.textContent = "لم نتمكن من تحديد موقعك. يمكنك البحث باسم المنطقة دون مشاركة موقعك.";
      areaInput.focus();
      busy = false;
      button.disabled = false;
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });

  radiusTwo.addEventListener("click", () => searchByRadius(2));
  radiusFive.addEventListener("click", () => searchByRadius(5));
  areaButton.addEventListener("click", searchByArea);
  areaInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchByArea();
    }
  });

  async function searchByRadius(radiusKm) {
    if (busy) return;
    if (!currentLocation) {
      panel.classList.remove("hidden");
      status.textContent = "اضغط زر الموقع للبحث حولك، أو ابحث باسم المنطقة.";
      return;
    }

    busy = true;
    radiusTwo.disabled = true;
    radiusFive.disabled = true;
    areaButton.disabled = true;
    status.textContent = `جارٍ البحث عن المحلات ضمن ${radiusKm} كم تقريبًا...`;
    results.replaceChildren();
    try {
      const { findNearbyShops } = await import("./nearby-search-service.js");
      const shops = await findNearbyShops({
        ...currentLocation,
        radiusKm,
        excludeProjectId: currentProjectId
      });
      renderShops(results, shops, true);
      status.textContent = shops.length
        ? `محلات قريبة ضمن ${radiusKm} كم تقريبًا. المسافة تقديرية.`
        : `ما لقيناش محلات مسجلة ضمن ${radiusKm} كم. تقدر تبحث باسم المنطقة.`;
      radiusFive.classList.remove("hidden");
      radiusTwo.classList.remove("hidden");
    } catch (error) {
      console.error("Nearby shop search failed", error);
      status.textContent = error?.code === "failed-precondition"
        ? "بحث المحلات القريبة لم يكتمل إعداده بعد. استخدم البحث باسم المنطقة مؤقتًا."
        : "تعذر تحميل المحلات القريبة. يمكنك البحث باسم المنطقة أو المحاولة لاحقًا.";
    } finally {
      busy = false;
      radiusTwo.disabled = false;
      radiusFive.disabled = false;
      areaButton.disabled = false;
    }
  }

  async function searchByArea() {
    if (busy) return;
    panel.classList.remove("hidden");
    const area = areaInput.value.trim();
    if (!area) {
      status.textContent = "اكتب اسم المنطقة أو الحي للبحث.";
      areaInput.focus();
      return;
    }

    busy = true;
    areaButton.disabled = true;
    radiusTwo.disabled = true;
    radiusFive.disabled = true;
    status.textContent = "جارٍ البحث في هذه المنطقة...";
    results.replaceChildren();
    try {
      const { findNearbyShopsByArea } = await import("./nearby-search-service.js");
      const shops = await findNearbyShopsByArea({ area, excludeProjectId: currentProjectId });
      renderShops(results, shops, false);
      status.textContent = shops.length
        ? `محلات ظاهرة في منطقة ${area}.`
        : "ما لقيناش محلات مسجلة بهذا الاسم. جرّب كتابة الحي بطريقة أخرى.";
      radiusFive.classList.add("hidden");
      radiusTwo.classList.add("hidden");
    } catch (error) {
      console.error("Nearby area search failed", error);
      status.textContent = "تعذر تحميل المحلات. حاول مرة أخرى.";
    } finally {
      busy = false;
      areaButton.disabled = false;
      radiusTwo.disabled = false;
      radiusFive.disabled = false;
    }
  }
}

function renderShops(container, shops, showDistance) {
  const grouped = new Map(ACTIVE_TEMPLATES.map(template => [template, []]));
  for (const shop of shops) {
    if (grouped.has(shop.template)) grouped.get(shop.template).push(shop);
  }

  container.replaceChildren();
  for (const template of ACTIVE_TEMPLATES) {
    const category = grouped.get(template);
    if (!category.length) continue;

    const section = document.createElement("section");
    section.className = "nearbyCategory";
    const heading = document.createElement("h3");
    heading.textContent = CATEGORY_LABELS[template];
    section.append(heading);

    const list = document.createElement("div");
    list.className = "nearbyShopList";
    for (const shop of category) {
      const link = document.createElement("a");
      link.className = "nearbyShopCard";
      link.href = new URL(`../../templates/${template}/?project=${encodeURIComponent(shop.projectId)}`, location.href).toString();

      const name = document.createElement("strong");
      name.textContent = shop.name || CATEGORY_LABELS[template];
      link.append(name);

      const detail = document.createElement("span");
      if (showDistance && Number.isFinite(shop.distanceKm)) {
        detail.textContent = `يبعد نحو ${shop.distanceKm < 0.1 ? "أقل من 0.1" : shop.distanceKm.toFixed(1)} كم`;
      } else {
        detail.textContent = shop.area || "اضغط لفتح المحل";
      }
      link.append(detail);
      list.append(link);
    }
    section.append(list);
    container.append(section);
  }

  if (!shops.length) {
    const empty = document.createElement("p");
    empty.className = "nearbyEmpty";
    empty.textContent = "لا توجد نتائج لعرضها.";
    container.append(empty);
  }
}
