import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fields = [
  ["shirtWash", "قميص — غسيل"], ["shirtIron", "قميص — مكواة"],
  ["trousersWash", "بنطلون — غسيل"], ["trousersIron", "بنطلون — مكواة"],
  ["tshirtWash", "تيشيرت — غسيل"], ["tshirtIron", "تيشيرت — مكواة"],
  ["dressWash", "فستان / عباية — غسيل"], ["dressIron", "فستان / عباية — مكواة"],
  ["galabeyaWash", "جلابية — غسيل"], ["galabeyaIron", "جلابية — مكواة"],
  ["suitWash", "بدلة — غسيل"], ["suitIron", "بدلة — مكواة"],
  ["shoesWash", "كوتشي — غسيل"]
];

function normalize(value){
  return Number(String(value || "0")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)));
}

function renderPricing(priceConfig = {}) {
  const pricingSection = document.getElementById("pricingSection");
  const genericGrid = pricingSection?.querySelector(".pricingGrid");
  const saveButton = document.getElementById("savePricingBtn");
  if (!pricingSection || !genericGrid || !saveButton) return;

  genericGrid.innerHTML = fields.map(([key, label]) => `
    <label class="fieldGroup">
      <span>${label}</span>
      <input data-laundry-price="${key}" inputmode="decimal" value="${Number(priceConfig[key] || 0)}" placeholder="0">
    </label>
  `).join("");

  const heading = pricingSection.querySelector("h2");
  if (heading) heading.textContent = "تسعير الغسيل والمكواة بالقطعة";

  saveButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const user = auth.currentUser;
    const projectDocId = new URLSearchParams(location.search).get("project");
    const status = document.getElementById("pricingStatus");
    if (!user || !projectDocId) return;

    try {
      const projectRef = doc(db, "projects", projectDocId);
      const snap = await getDoc(projectRef);
      if (!snap.exists() || snap.data().ownerId !== user.uid || snap.data().template !== "laundry") return;

      const priceConfig = {};
      document.querySelectorAll("[data-laundry-price]").forEach(input => {
        priceConfig[input.dataset.laundryPrice] = Math.max(0, normalize(input.value));
      });

      await updateDoc(projectRef, { priceConfig });
      if (status) status.innerText = "تم حفظ أسعار الغسيل والمكواة ✅";
    } catch (error) {
      if (status) status.innerText = error.message;
    }
  }, true);
}

onAuthStateChanged(auth, async user => {
  if (!user) return;
  const projectDocId = new URLSearchParams(location.search).get("project");
  if (!projectDocId) return;

  try {
    const snap = await getDoc(doc(db, "projects", projectDocId));
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.ownerId !== user.uid || data.template !== "laundry") return;
    renderPricing(data.priceConfig || {});
  } catch {
    // The main dashboard handles project access and error messaging.
  }
});
