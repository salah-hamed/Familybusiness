let stats = {
  new: 0,
  accepted: 0,
  done: 0,
  canceled: 0
};
let currentUser = null;
let isAuthReady = false;
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

  currentUser = user || null;
  isAuthReady = !!user;

  if (!user) return;

  try {

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return;

    const data = userSnap.data();
if (!data.isActive) {

  projectLink.style.display = "none";
  document.getElementById("copyLinkBtn").style.display = "none";

  status.innerHTML = `
    <div style="
      background:#fff3cd;
      color:#856404;
      padding:15px;
      border-radius:10px;
      margin:15px 0;
      border:1px solid #ffeeba;
      text-align:center;
      font-weight:bold;
    ">
      ⏳ حسابك في انتظار مراجعة الدفع وتفعيله من الإدارة.
    </div>
  `;

  return;
}
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

    if (!isAuthReady || !currentUser) return;

    await updateDoc(
      doc(db, "users", currentUser.uid),
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

    if (!isAuthReady || !currentUser) return;

    await updateDoc(
      doc(db, "users", currentUser.uid),
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
stats = {
  new: 0,
  accepted: 0,
  done: 0,
  canceled: 0
};
    ordersContainer.innerHTML = "";

    if (snapshot.empty) {
      ordersContainer.innerHTML = "<p>لا توجد طلبات بعد</p>";
      return;
    }

    snapshot.forEach((docSnap) => {

  const order = docSnap.data();
      if (order.status === "new") stats.new++;
if (order.status === "accepted") stats.accepted++;
if (order.status === "done") stats.done++;
if (order.status === "canceled") stats.canceled++;
  const orderId = docSnap.id;
      document.getElementById("newOrders").innerText = stats.new;
document.getElementById("acceptedOrders").innerText = stats.accepted;
document.getElementById("doneOrders").innerText = stats.done;
document.getElementById("canceledOrders").innerText = stats.canceled;
      const card = document.createElement("div");
card.dataset.status = order.status || "new";
      card.style.border = "1px solid #ddd";
      card.style.padding = "10px";
      card.style.margin = "10px 0";

card.innerHTML = `
<div style="
  background:#ffffff;
  border-radius:18px;
  padding:18px;
  box-shadow:0 8px 20px rgba(0,0,0,0.08);
  margin-bottom:15px;
  font-family:Arial;
">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <h3 style="margin:0;color:#111;">
      ${order.customerName || "عميل"}
    </h3>

    <span style="
      padding:6px 12px;
      border-radius:20px;
      color:#fff;
      font-size:12px;
      background:${
        order.status === "new"
          ? "#f59e0b"
          : order.status === "accepted"
          ? "#3b82f6"
          : order.status === "done"
          ? "#22c55e"
          : "#ef4444"
      };
    ">
      ${order.status || "new"}
    </span>
  </div>

  <hr style="margin:12px 0;">

  <!-- CUSTOMER INFO -->
  <p><b>📞 الهاتف:</b> ${order.customerPhone || "-"}</p>
  <p><b>📍 العنوان:</b> ${order.customerAddress || "-"}</p>
  <p><b>🌍 الموقع:</b> ${order.location || "-"}</p>

  <hr style="margin:12px 0;">

  <!-- SERVICE DETAILS -->
  <p><b>🚪 الغرف:</b> ${order.rooms || "-"}</p>
  <p><b>🚿 الحمامات:</b> ${order.bathrooms || "-"}</p>
  <p><b>🍳 المطبخ:</b> ${order.kitchen || "-"}</p>
  <p><b>🪜 السلم:</b> ${order.stairs || "-"}</p>

  <hr style="margin:12px 0;">

  <!-- TIME -->
  <p><b>📅 التاريخ:</b> ${order.visitDate || "-"}</p>
  <p><b>⏰ الوقت:</b> ${order.visitTime || "-"}</p>

  <hr style="margin:12px 0;">

  <!-- PRICE -->
  <p style="font-size:18px;font-weight:bold;color:#4f46e5;">
    💰 ${order.price || 0} جنيه
  </p>

  <!-- WHATSAPP -->
  <a
    href="https://wa.me/${(order.customerPhone || "").replace(/\\D/g,'')}"
    target="_blank"
    style="
      display:block;
      background:#25D366;
      color:#fff;
      text-align:center;
      padding:12px;
      border-radius:12px;
      text-decoration:none;
      margin:10px 0;
      font-weight:bold;
    "
  >
    💬 تواصل واتساب
  </a>

  <!-- ACTIONS -->
  ${
  order.status === "new"
    ? `
<div style="display:flex;gap:8px;flex-wrap:wrap;">

  <button class="acceptBtn" style="flex:1;padding:10px;">
    قبول
  </button>

  <button class="cancelBtn" style="flex:1;padding:10px;">
    إلغاء
  </button>

</div>
`
    : order.status === "accepted"
    ? `
<div style="display:flex;gap:8px;flex-wrap:wrap;">

  <button class="doneBtn" style="flex:1;padding:10px;">
    تم التنفيذ
  </button>

  <button class="cancelBtn" style="flex:1;padding:10px;">
    إلغاء
  </button>

</div>
`
    : ""
}

</div>
`;

      ordersContainer.appendChild(card);
const acceptBtn = card.querySelector(".acceptBtn");
const doneBtn = card.querySelector(".doneBtn");
const cancelBtn = card.querySelector(".cancelBtn");

if (acceptBtn) {
  acceptBtn.onclick = async () => {
    await updateDoc(doc(db, "orders", orderId), {
      status: "accepted"
    });
    loadOrders(providerId);
  };
}

if (doneBtn) {
  doneBtn.onclick = async () => {
    await updateDoc(doc(db, "orders", orderId), {
      status: "done"
    });
    loadOrders(providerId);
  };
}

if (cancelBtn) {
  cancelBtn.onclick = async () => {
    await updateDoc(doc(db, "orders", orderId), {
      status: "canceled"
    });
    loadOrders(providerId);
  };
}
    });
setupTabs();
  } catch (error) {

    ordersContainer.innerHTML = error.message;
    console.log(error);

  }
}
function setupTabs() {

  const buttons = document.querySelectorAll(".tabBtn");

  buttons.forEach((btn) => {

    btn.onclick = () => {

      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const selectedTab = btn.dataset.tab;

      const cards =
        document.getElementById("ordersContainer").children;

      Array.from(cards).forEach((card) => {

        const cardStatus = card.dataset.status;

        if (
          selectedTab === "all" ||
          cardStatus === selectedTab
        ) {
          card.style.display = "block";
        } else {
          card.style.display = "none";
        }

      });

    };

  });

}

