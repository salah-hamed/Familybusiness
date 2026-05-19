import { protectPage } from "../core/auth/auth-guard.js";
import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { logoutUser } from "../core/auth/auth.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

protectPage();

const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const projectType = document.getElementById("projectType");
const status = document.getElementById("status");

const projectLink = document.getElementById("projectLink");
const businessName = document.getElementById("businessName");
const whatsappNumber = document.getElementById("whatsappNumber");
const instapayLink = document.getElementById("instapayLink");

onAuthStateChanged(auth, async (user) => {

  if (!user) return;

  try {

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return;

    const data = userSnap.data();

    userName.innerText = "Name: " + data.name;
    userEmail.innerText = "Email: " + data.email;
    projectType.innerText = "Project: " + (data.projectType || "cleaning");
    status.innerText = "Active: " + data.isActive;

    const projectSlug = data.projectType || "cleaning";
    projectLink.value =
      `${window.location.origin}/Familybusiness/templates/${projectSlug}/?user=${user.uid}`;

    businessName.value = data.businessName || "";
    whatsappNumber.value = data.whatsappNumber || "";
    instapayLink.value = data.instapayLink || "";

    if (data.priceConfig) {
  document.getElementById("basePrice").value = data.priceConfig.base || "";
  document.getElementById("roomPrice").value = data.priceConfig.room || "";
  document.getElementById("bathroomPrice").value = data.priceConfig.bathroom || "";
  document.getElementById("kitchenPrice").value = data.priceConfig.kitchen || "";
  document.getElementById("stairsPrice").value = data.priceConfig.stairs || "";
    }

    await loadOrders(user.uid);

  } catch (error) {
    console.log(error);
  }

});


document.getElementById("logoutBtn").addEventListener("click", async () => {

  await logoutUser();
  window.location.href = "/Familybusiness/";

});


document.getElementById("copyLinkBtn").addEventListener("click", async () => {

  await navigator.clipboard.writeText(projectLink.value);

  document.getElementById("copyStatus").innerText =
    "تم نسخ الرابط ✅";

});


document.getElementById("saveSettingsBtn").addEventListener("click", async () => {

  try {

    const user = auth.currentUser;
    if (!user) return;

    await updateDoc(
      doc(db, "users", user.uid),
      {
        businessName: businessName.value,
        whatsappNumber: whatsappNumber.value,
        instapayLink: instapayLink.value
      }
    );

    document.getElementById("settingsStatus").innerText =
      "تم حفظ الإعدادات ✅";

  } catch (error) {

    document.getElementById("settingsStatus").innerText =
      error.message;

    console.log(error);

  }

});


document.getElementById("savePricingBtn").addEventListener("click", async () => {

  try {

    const user = auth.currentUser;
    if (!user) return;

    await updateDoc(
      doc(db, "users", user.uid),
      {
        priceConfig: {
  base: Number(document.getElementById("basePrice").value),
  room: Number(document.getElementById("roomPrice").value),
  bathroom: Number(document.getElementById("bathroomPrice").value),
  kitchen: Number(document.getElementById("kitchenPrice").value),
  stairs: Number(document.getElementById("stairsPrice").value)
                                       }
      }
    );

    document.getElementById("pricingStatus").innerText =
      "تم حفظ الأسعار ✅";

  } catch (error) {

    document.getElementById("pricingStatus").innerText =
      error.message;

    console.log(error);

  }

});


async function loadOrders(providerId) {

  const ordersContainer =
    document.getElementById("ordersContainer");

  ordersContainer.innerHTML = "جاري التحميل...";

  try {

    const q = query(
      collection(db, "orders"),
      where("providerId", "==", providerId)
    );

    const snapshot = await getDocs(q);

    ordersContainer.innerHTML = "";

    if (snapshot.empty) {
      ordersContainer.innerHTML = "<p>لا توجد طلبات بعد</p>";
      return;
    }

    snapshot.forEach((docSnap) => {

      const order = docSnap.data();

      const card = document.createElement("div");

      card.style.border = "1px solid #ddd";
      card.style.padding = "10px";
      card.style.margin = "10px 0";

      card.innerHTML = `
        <p><b>الاسم:</b> ${order.customerName}</p>
        <p><b>الهاتف:</b> ${order.customerPhone}</p>
        <p><b>العنوان:</b> ${order.customerAddress || ""}</p>
        <p><b>الحالة:</b> ${order.status}</p>
      `;

      ordersContainer.appendChild(card);

    });

  } catch (error) {

    ordersContainer.innerHTML = error.message;
    console.log(error);

  }

      }
