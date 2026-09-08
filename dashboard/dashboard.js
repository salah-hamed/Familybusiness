let stats = {
  new: 0,
  accepted: 0,
  done: 0,
  canceled: 0
};

let currentUser = null;
let currentProjectId = null;
let currentProjectOwnerId = null;
let isAuthReady = false;
let activeTab = "all";
let searchTerm = "";

function normalizeArabicNumbers(value) {
  return String(value)
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  return `20${digits}`;
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

import { protectPage } from "../core/auth/auth-guard.js";
import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { logoutUser } from "../core/auth/auth.js";
import { loadCurrentProject } from "./project.js";
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
const ordersSearch = document.getElementById("ordersSearch");

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  isAuthReady = !!user;

  if (!user) return;

  try {
    const result = await loadCurrentProject(user.uid);

    if (!result.success) {
      currentProjectId = null;
      currentProjectOwnerId = null;
      userName.innerText = result.reason === "access-denied"
        ? "غير مسموح لك بإدارة هذا المشروع"
        : "لم يتم العثور على المشروع";
      status.innerText = result.reason === "access-denied"
        ? "تم رفض الوصول إلى المشروع."
        : "تحقق من رابط المشروع وحاول مرة أخرى.";
      projectLink.style.display = "none";
      document.getElementById("copyLinkBtn").style.display = "none";
      document.getElementById("openProjectBtn").style.display = "none";
      document.getElementById("shareProjectBtn").style.display = "none";
      return;
    }

    const data = result.project;
    currentProjectId = result.projectDocId;
    currentProjectOwnerId = data.ownerId;

    if (!data.isActive) {
      projectLink.style.display = "none";
      document.getElementById("copyLinkBtn").style.display = "none";
      document.getElementById("openProjectBtn").style.display = "none";
      document.getElementById("shareProjectBtn").style.display = "none";
      status.innerText = "⏳ المشروع غير مفعل";
      return;
    }

    userName.innerText = data.businessName || "مشروعك";
    userEmail.innerText = "";
    projectType.innerText = `المشروع: ${data.projectType || data.template || "cleaning"}`;
    status.innerText = "● نشط";

    const projectSlug = data.template;
    projectLink.value =
      `${window.location.origin}/Familybusiness/templates/${projectSlug}/?project=${currentProjectId}`;

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

    await loadOrders(currentProjectId);

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
  document.getElementById("copyStatus").innerText = "تم نسخ الرابط ✅";
});

document.getElementById("openProjectBtn").addEventListener("click", () => {
  if (projectLink.value) window.open(projectLink.value, "_blank", "noopener");
});

document.getElementById("shareProjectBtn").addEventListener("click", async () => {
  if (!projectLink.value) return;

  const shareText = `احجز خدمتك من ${businessName.value || "مشروعي"}`;

  if (navigator.share) {
    try {
      await navigator.share({ title: businessName.value || "مشروعي", text: shareText, url: projectLink.value });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  const whatsappShare = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${projectLink.value}`)}`;
  window.open(whatsappShare, "_blank", "noopener");
});

document.querySelectorAll(".navItem[data-target]").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".navItem").forEach(nav => nav.classList.remove("active"));
    item.classList.add("active");
    scrollToSection(item.dataset.target);
  });
});

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  try {
    if (!isAuthReady || !currentUser || !currentProjectId || currentProjectOwnerId !== currentUser.uid) return;

    await updateDoc(doc(db, "projects", currentProjectId), {
      businessName: businessName.value.trim(),
      whatsappNumber: whatsappNumber.value.trim(),
      instapayLink: instapayLink.value.trim()
    });

    userName.innerText = businessName.value.trim() || "مشروعك";
    document.getElementById("settingsStatus").innerText = "تم حفظ الإعدادات ✅";
  } catch (error) {
    document.getElementById("settingsStatus").innerText = error.message;
    console.log(error);
  }
});

document.getElementById("savePricingBtn").addEventListener("click", async () => {
  try {
    if (!isAuthReady || !currentUser || !currentProjectId || currentProjectOwnerId !== currentUser.uid) return;

    await updateDoc(doc(db, "projects", currentProjectId), {
      priceConfig: {
        base: Number(normalizeArabicNumbers(document.getElementById("basePrice").value)),
        room: Number(normalizeArabicNumbers(document.getElementById("roomPrice").value)),
        bathroom: Number(normalizeArabicNumbers(document.getElementById("bathroomPrice").value)),
        kitchen: Number(normalizeArabicNumbers(document.getElementById("kitchenPrice").value)),
        stairs: Number(normalizeArabicNumbers(document.getElementById("stairsPrice").value))
      }
    });

    document.getElementById("pricingStatus").innerText = "تم حفظ الأسعار ✅";
  } catch (error) {
    document.getElementById("pricingStatus").innerText = error.message;
    console.log(error);
  }
});

async function updateOrderStatus(orderId, projectId, nextStatus) {
  if (!isAuthReady || !currentUser || !currentProjectId || currentProjectOwnerId !== currentUser.uid || projectId !== currentProjectId) {
    return false;
  }

  const orderRef = doc(db, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) return false;

  const order = orderSnap.data();
  if (order.projectId !== currentProjectId) return false;

  await updateDoc(orderRef, { status: nextStatus });
  return true;
}

function refreshOrderVisibility() {
  document.querySelectorAll("#ordersContainer .orderCard").forEach((card) => {
    const matchesTab = activeTab === "all" || card.dataset.status === activeTab;
    const searchable = card.dataset.search || "";
    const matchesSearch = !searchTerm || searchable.includes(searchTerm);
    card.classList.toggle("hiddenByFilter", !(matchesTab && matchesSearch));
  });
}

function setupTabs() {
  const buttons = document.querySelectorAll(".tabBtn");
  buttons.forEach((btn) => {
    btn.onclick = () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      refreshOrderVisibility();
    };
  });
}

ordersSearch.addEventListener("input", () => {
  searchTerm = ordersSearch.value.trim().toLowerCase();
  refreshOrderVisibility();
});

async function loadOrders(projectId) {
  const ordersContainer = document.getElementById("ordersContainer");
  ordersContainer.innerHTML = '<div class="emptyState">جاري تحميل الطلبات...</div>';

  try {
    const q = query(collection(db, "orders"), where("projectId", "==", projectId));
    const snapshot = await getDocs(q);

    stats = { new: 0, accepted: 0, done: 0, canceled: 0 };
    let doneRevenue = 0;
    let todayOrders = 0;
    const today = new Date().toISOString().split("T")[0];

    ordersContainer.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const order = docSnap.data();
      const orderStatus = order.status || "new";

      if (Object.prototype.hasOwnProperty.call(stats, orderStatus)) stats[orderStatus]++;
      if (orderStatus === "done") doneRevenue += Number(order.price || 0);
      if (order.visitDate === today) todayOrders++;

      const orderId = docSnap.id;
      const customerName = escapeHTML(order.customerName || "عميل");
      const customerPhone = escapeHTML(order.customerPhone || "-");
      const customerAddress = escapeHTML(order.customerAddress || "-");
      const visitDate = escapeHTML(order.visitDate || "-");
      const visitTime = escapeHTML(order.visitTime || "-");
      const rooms = escapeHTML(order.rooms || "-");
      const bathrooms = escapeHTML(order.bathrooms || "-");
      const kitchen = escapeHTML(order.kitchen || "-");
      const stairs = escapeHTML(order.stairs || "-");
      const mapsUrl = typeof order.location === "string" && order.location.startsWith("http")
        ? order.location
        : "";
      const phoneForWhatsApp = cleanPhone(order.customerPhone);
      const searchValue = `${order.customerName || ""} ${order.customerPhone || ""}`.toLowerCase();

      const statusLabel = {
        new: "جديد",
        accepted: "مقبول",
        done: "تم التنفيذ",
        canceled: "ملغي"
      }[orderStatus] || orderStatus;

      const card = document.createElement("article");
      card.className = "orderCard";
      card.dataset.status = orderStatus;
      card.dataset.search = searchValue;

      card.innerHTML = `
        <div class="orderTop">
          <div>
            <h3>${customerName}</h3>
            <span class="muted">${customerPhone}</span>
          </div>
          <span class="orderStatus status-${orderStatus}">${statusLabel}</span>
        </div>

        <div class="orderGrid">
          <div class="orderInfo"><b>📍 العنوان</b>${customerAddress}</div>
          <div class="orderInfo"><b>📅 الموعد</b>${visitDate} — ${visitTime}</div>
          <div class="orderInfo"><b>🏠 تفاصيل المكان</b>${rooms} غرف / ${bathrooms} حمام</div>
          <div class="orderInfo"><b>✨ إضافات</b>مطبخ: ${kitchen} / سلم: ${stairs}</div>
        </div>

        <div class="orderPrice">💰 ${Number(order.price || 0)} جنيه</div>

        <div class="orderActions">
          ${phoneForWhatsApp ? `<a class="orderAction whatsapp" href="https://wa.me/${phoneForWhatsApp}" target="_blank" rel="noopener">💬 واتساب</a>` : ""}
          ${mapsUrl ? `<a class="orderAction maps" href="${escapeHTML(mapsUrl)}" target="_blank" rel="noopener">🗺️ فتح الموقع</a>` : ""}
          ${orderStatus === "new" ? '<button class="orderAction accept acceptBtn" type="button">قبول الطلب</button>' : ""}
          ${orderStatus === "accepted" ? '<button class="orderAction done doneBtn" type="button">تم التنفيذ</button>' : ""}
          ${["new", "accepted"].includes(orderStatus) ? '<button class="orderAction cancel cancelBtn" type="button">إلغاء</button>' : ""}
        </div>
      `;

      ordersContainer.appendChild(card);

      const acceptBtn = card.querySelector(".acceptBtn");
      const doneBtn = card.querySelector(".doneBtn");
      const cancelBtn = card.querySelector(".cancelBtn");

      if (acceptBtn) {
        acceptBtn.onclick = async () => {
          const updated = await updateOrderStatus(orderId, projectId, "accepted");
          if (updated) loadOrders(projectId);
        };
      }

      if (doneBtn) {
        doneBtn.onclick = async () => {
          const updated = await updateOrderStatus(orderId, projectId, "done");
          if (updated) loadOrders(projectId);
        };
      }

      if (cancelBtn) {
        cancelBtn.onclick = async () => {
          const updated = await updateOrderStatus(orderId, projectId, "canceled");
          if (updated) loadOrders(projectId);
        };
      }
    });

    document.getElementById("newOrders").innerText = stats.new;
    document.getElementById("acceptedOrders").innerText = stats.accepted;
    document.getElementById("doneOrders").innerText = stats.done;
    document.getElementById("canceledOrders").innerText = stats.canceled;
    document.getElementById("todayOrders").innerText = todayOrders;
    document.getElementById("doneRevenue").innerText = doneRevenue;

    if (snapshot.empty) {
      ordersContainer.innerHTML = '<div class="emptyState">لا توجد طلبات بعد. شارك رابط مشروعك لاستقبال أول طلب ✨</div>';
    }

    setupTabs();
    refreshOrderVisibility();
  } catch (error) {
    ordersContainer.innerHTML = `<div class="emptyState">${escapeHTML(error.message)}</div>`;
    console.log(error);
  }
}
