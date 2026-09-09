import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const projectId = new URLSearchParams(location.search).get("project") || "";
const isCarWashProject = projectId.endsWith("_carwash");
let rendering = false;
let renderQueued = false;
let activeFilter = "all";
let searchTerm = "";

if (isCarWashProject) document.body.classList.add("carwashDashboard");

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  return `20${digits}`;
}

function toDate(value) {
  return value?.toDate ? value.toDate() : value ? new Date(value) : null;
}

function sameDay(a, b) {
  return !!(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
}

function hideLegacyCarWashSections() {
  const orders = document.getElementById("ordersSection");
  const stats = document.querySelector(".statsSection");
  if (orders) orders.style.display = "none";
  if (stats) stats.style.display = "none";

  const navOrders = document.querySelector('.navItem[data-target="ordersSection"]');
  if (navOrders) {
    navOrders.dataset.target = "carwashSubscriptionsPanel";
    const icon = navOrders.querySelector("span");
    const label = navOrders.querySelector("small");
    if (icon) icon.textContent = "🚗";
    if (label) label.textContent = "التشغيل";
    navOrders.onclick = () => document.getElementById("carwashSubscriptionsPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function ensureOperationsShell() {
  const panel = document.getElementById("carwashSubscriptionsPanel");
  if (!panel) return null;
  hideLegacyCarWashSections();

  const heading = panel.querySelector(".sectionHeading h2");
  if (heading) heading.textContent = "إدارة العملاء والغسلات";
  const eyebrow = panel.querySelector(".sectionHeading .eyebrow");
  if (eyebrow) eyebrow.textContent = "مركز تشغيل غسيل السيارات";

  const legacyList = document.getElementById("subscriptionsList");
  if (legacyList) legacyList.style.display = "none";

  let controls = document.getElementById("carwashOperationsControls");
  if (!controls) {
    controls = document.createElement("div");
    controls.id = "carwashOperationsControls";
    controls.innerHTML = `
      <div class="searchBox" style="margin-top:14px"><span>🔎</span><input id="carwashOperationsSearch" type="search" placeholder="ابحث بالاسم أو الهاتف أو السيارة أو اللوحة"></div>
      <div class="tabsScroller" id="carwashOperationsTabs">
        <button class="tabBtn active" data-carwash-tab="all" type="button">الكل</button>
        <button class="tabBtn" data-carwash-tab="pending" type="button">طلبات جديدة</button>
        <button class="tabBtn" data-carwash-tab="active" type="button">اشتراكات نشطة</button>
        <button class="tabBtn" data-carwash-tab="today" type="button">غسلات اليوم</button>
        <button class="tabBtn" data-carwash-tab="renewal" type="button">تجديدات</button>
        <button class="tabBtn" data-carwash-tab="closed" type="button">مغلقة</button>
      </div>`;
    const grid = panel.querySelector(".statGrid");
    if (grid) grid.insertAdjacentElement("afterend", controls);
    else panel.appendChild(controls);

    controls.querySelector("#carwashOperationsSearch")?.addEventListener("input", e => {
      searchTerm = e.target.value.trim().toLowerCase();
      applyFilters();
    });
    controls.querySelectorAll("[data-carwash-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        controls.querySelectorAll("[data-carwash-tab]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.dataset.carwashTab || "all";
        applyFilters();
      });
    });
  }

  let list = document.getElementById("carwashOperationsList");
  if (!list) {
    list = document.createElement("div");
    list.id = "carwashOperationsList";
    list.className = "ordersList carwashOperationsList";
    panel.appendChild(list);
  }
  return list;
}

function ensureOperationalStats() {
  const grid = document.querySelector("#carwashSubscriptionsPanel .statGrid");
  if (!grid) return;
  const existing = [
    ["activeCarwashSubscriptions", "🔁", "اشتراكات نشطة", "accentAccepted"],
    ["remainingSubscriptionWashes", "💦", "غسلات متبقية", "accentDone"]
  ];
  existing.forEach(([id, icon, label]) => {
    const el = document.getElementById(id);
    if (el) {
      const card = el.closest(".statCard");
      const iconEl = card?.querySelector(".statIcon");
      const labelEl = card?.querySelector(".statLabel");
      if (iconEl) iconEl.textContent = icon;
      if (labelEl) labelEl.textContent = label;
    }
  });
  if (!document.getElementById("carwashPendingCount")) {
    const card = document.createElement("article");
    card.className = "statCard accentNew";
    card.innerHTML = '<span class="statIcon">🆕</span><div><span class="statLabel">طلبات جديدة</span><strong id="carwashPendingCount">0</strong></div>';
    grid.appendChild(card);
  }
  if (!document.getElementById("carwashTodayCount")) {
    const card = document.createElement("article");
    card.className = "statCard accentDone";
    card.innerHTML = '<span class="statIcon">🚗</span><div><span class="statLabel">غسلات اليوم</span><strong id="carwashTodayCount">0</strong></div>';
    grid.appendChild(card);
  }
}

async function waitForPanel(maxAttempts = 25) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (ensureOperationsShell()) return true;
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  return false;
}

function queueRender(delay = 0) {
  if (!isCarWashProject || renderQueued) return;
  renderQueued = true;
  setTimeout(async () => {
    renderQueued = false;
    await renderOperations();
  }, delay);
}

function cardMatchesFilter(card) {
  const states = (card.dataset.states || "").split(" ");
  const matchTab = activeFilter === "all" || states.includes(activeFilter);
  const matchSearch = !searchTerm || (card.dataset.search || "").includes(searchTerm);
  return matchTab && matchSearch;
}

function applyFilters() {
  document.querySelectorAll("#carwashOperationsList .carwashOperationCard").forEach(card => {
    card.style.display = cardMatchesFilter(card) ? "" : "none";
  });
}

async function activateSubscription(order) {
  if (!order.subscriptionKey) throw new Error("بيانات الاشتراك غير مكتملة.");
  const projectSnap = await getDoc(doc(db, "projects", projectId));
  if (!projectSnap.exists()) throw new Error("المشروع غير موجود.");
  const project = projectSnap.data();
  const totalWashes = Math.max(1, Math.round(Number(project.priceConfig?.monthlyWashes || order.packageWashes || 1)));
  const intervalDays = Math.max(1, Math.floor(30 / totalWashes));
  const startsAt = new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setDate(expiresAt.getDate() + 30);

  let firstWashDate = order.firstWashDate ? new Date(`${order.firstWashDate}T12:00:00`) : new Date(startsAt);
  if (Number.isNaN(firstWashDate.getTime()) || firstWashDate < startsAt) firstWashDate = new Date(startsAt);
  if (firstWashDate > expiresAt) firstWashDate = new Date(startsAt);

  const subRef = doc(db, "carwashSubscriptions", order.subscriptionKey);
  const oldSnap = await getDoc(subRef);
  const oldCycle = oldSnap.exists() ? Number(oldSnap.data().cycleNumber || 0) : 0;

  await setDoc(subRef, {
    projectId,
    status: "active",
    totalWashes,
    remainingWashes: totalWashes,
    startsAt: serverTimestamp(),
    expiresAt,
    nextWashDate: firstWashDate,
    preferredTime: order.preferredTime || order.visitTime || "",
    intervalDays,
    cycleNumber: oldCycle + 1,
    lastWashAt: null,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await setDoc(doc(db, "carwashCustomers", order.subscriptionKey), {
    projectId,
    customerName: order.customerName || "",
    customerPhone: order.customerPhone || "",
    carModel: order.carModel || "",
    carColor: order.carColor || "",
    plateNumber: order.plateNumber || "",
    customerAddress: order.customerAddress || order.parkingAddress || "",
    location: order.location || "",
    notes: order.notes || "",
    preferredTime: order.preferredTime || order.visitTime || "",
    updatedAt: serverTimestamp()
  }, { merge: true });

  await setDoc(doc(db, "carwashSubscriptionRequests", order.subscriptionKey), {
    projectId,
    status: "active",
    requestType: order.renewal ? "renewal" : "new",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function changeOrderStatus(orderId, nextStatus, button) {
  if (!auth.currentUser) return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = nextStatus === "accepted" ? "جاري التفعيل..." : "جاري الإلغاء...";
  try {
    const ref = doc(db, "orders", orderId);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().projectId !== projectId) throw new Error("الطلب غير موجود.");
    const order = snap.data();
    if (nextStatus === "accepted") await activateSubscription(order);
    await updateDoc(ref, { status: nextStatus });
    if (nextStatus === "canceled" && order.subscriptionKey) {
      await setDoc(doc(db, "carwashSubscriptionRequests", order.subscriptionKey), {
        projectId,
        status: "canceled",
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    await renderOperations();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message || original;
  }
}

function renderPendingOrder(orderId, order) {
  const card = document.createElement("article");
  card.className = "orderCard carwashOperationCard";
  card.dataset.states = order.renewal ? "pending renewal" : "pending";
  card.dataset.search = `${order.customerName || ""} ${order.customerPhone || ""} ${order.carModel || ""} ${order.plateNumber || ""}`.toLowerCase();
  const wa = cleanPhone(order.customerPhone);
  const maps = typeof order.location === "string" && order.location.startsWith("http") ? order.location : "";
  card.innerHTML = `
    <div class="orderTop">
      <div><h3>${esc(order.customerName || "عميل جديد")}</h3><span class="muted">${esc(order.customerPhone || "-")}</span></div>
      <span class="orderStatus status-new">${order.renewal ? "طلب تجديد" : "طلب اشتراك جديد"}</span>
    </div>
    <div class="orderGrid">
      <div class="orderInfo"><b>🚗 السيارة</b>${esc(order.carModel || "-")} — ${esc(order.plateNumber || "-")}</div>
      <div class="orderInfo"><b>🎨 اللون</b>${esc(order.carColor || "-")}</div>
      <div class="orderInfo"><b>📍 العنوان</b>${esc(order.customerAddress || order.parkingAddress || "-")}</div>
      <div class="orderInfo"><b>🗓️ أول موعد</b>${esc(order.firstWashDate || order.visitDate || "-")} — ${esc(order.preferredTime || order.visitTime || "-")}</div>
      <div class="orderInfo"><b>🔁 الباقة</b>${Number(order.packageWashes || 0)} غسلات</div>
      <div class="orderInfo"><b>💰 القيمة</b>${Number(order.price || 0)} جنيه</div>
    </div>
    <div class="orderActions">
      ${wa ? `<a class="orderAction whatsapp" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 واتساب</a>` : ""}
      ${maps ? `<a class="orderAction maps" href="${esc(maps)}" target="_blank" rel="noopener">🗺️ الموقع</a>` : ""}
      <button class="orderAction accept approveSubscriptionBtn" type="button">✅ قبول وتفعيل</button>
      <button class="orderAction cancel rejectSubscriptionBtn" type="button">إلغاء الطلب</button>
    </div>`;
  card.querySelector(".approveSubscriptionBtn")?.addEventListener("click", e => changeOrderStatus(orderId, "accepted", e.currentTarget));
  card.querySelector(".rejectSubscriptionBtn")?.addEventListener("click", e => changeOrderStatus(orderId, "canceled", e.currentTarget));
  return card;
}

function renderSubscriptionRow(id, sub, customer, now) {
  const expires = toDate(sub.expiresAt);
  const nextWash = toDate(sub.nextWashDate);
  const remaining = Number(sub.remainingWashes || 0);
  const total = Number(sub.totalWashes || 0);
  const operational = sub.status === "active" && remaining > 0 && (!expires || expires >= now);
  const renewable = !operational;
  const dueToday = operational && sameDay(nextWash, now);
  const daysLeft = expires ? Math.ceil((expires.getTime() - now.getTime()) / 86400000) : null;
  const renewalSoon = operational && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
  const states = [operational ? "active" : "closed"];
  if (dueToday) states.push("today");
  if (renewable || renewalSoon) states.push("renewal");

  const card = document.createElement("article");
  card.className = "orderCard carwashOperationCard";
  card.dataset.subscriptionId = id;
  card.dataset.states = states.join(" ");
  card.dataset.search = `${customer.customerName || ""} ${customer.customerPhone || ""} ${customer.carModel || ""} ${customer.plateNumber || ""}`.toLowerCase();
  const wa = cleanPhone(customer.customerPhone);
  const maps = typeof customer.location === "string" && customer.location.startsWith("http") ? customer.location : "";
  const statusText = operational ? (dueToday ? "غسلة اليوم" : "نشط") : remaining <= 0 ? "اكتمل الرصيد" : expires && expires < now ? "انتهى الشهر" : sub.status || "غير نشط";
  card.innerHTML = `
    <div class="orderTop">
      <div><h3>${esc(customer.customerName || "عميل اشتراك")}</h3><span class="muted">${esc(customer.customerPhone || "-")}</span></div>
      <span class="orderStatus ${operational ? "status-accepted" : "status-canceled"}">${esc(statusText)}</span>
    </div>
    <div class="orderGrid">
      <div class="orderInfo"><b>🚗 السيارة</b>${esc(customer.carModel || "-")} — ${esc(customer.plateNumber || "-")}</div>
      <div class="orderInfo"><b>📍 العنوان</b>${esc(customer.customerAddress || "-")}</div>
      <div class="orderInfo"><b>🗓️ الغسلة القادمة</b>${nextWash ? nextWash.toLocaleDateString("ar-EG") : "-"} — ${esc(sub.preferredTime || customer.preferredTime || "-")}</div>
      <div class="orderInfo"><b>🔁 الرصيد</b>${remaining} من ${total} غسلات</div>
      <div class="orderInfo"><b>⏳ نهاية الاشتراك</b>${expires ? expires.toLocaleDateString("ar-EG") : "-"}${renewalSoon ? " — تجديد قريب" : ""}</div>
    </div>
    <div class="orderActions">
      ${wa ? `<a class="orderAction whatsapp" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 واتساب</a>` : ""}
      ${maps ? `<a class="orderAction maps" href="${esc(maps)}" target="_blank" rel="noopener">🗺️ فتح الموقع</a>` : ""}
      ${operational ? '<button type="button" class="orderAction done washDoneBtn">💦 تسجيل غسلة منفذة</button>' : ""}
    </div>`;
  card.querySelector(".washDoneBtn")?.addEventListener("click", e => consumeWash(id, e.currentTarget));
  return { card, operational, remaining, dueToday, renewable: renewable || renewalSoon };
}

async function renderOperations() {
  if (!isCarWashProject || rendering || !auth.currentUser) return;
  const ready = await waitForPanel();
  if (!ready) return;
  const list = ensureOperationsShell();
  if (!list) return;
  rendering = true;
  ensureOperationalStats();
  list.innerHTML = '<div class="emptyState">جاري تحميل مركز التشغيل...</div>';

  try {
    const [subscriptionSnap, orderSnap] = await Promise.all([
      getDocs(query(collection(db, "carwashSubscriptions"), where("projectId", "==", projectId))),
      getDocs(query(collection(db, "orders"), where("projectId", "==", projectId)))
    ]);
    const now = new Date();
    const customers = await Promise.all(subscriptionSnap.docs.map(async ds => {
      const customerSnap = await getDoc(doc(db, "carwashCustomers", ds.id));
      return [ds.id, customerSnap.exists() ? customerSnap.data() : {}];
    }));
    const customerMap = new Map(customers);

    const pendingOrders = orderSnap.docs
      .filter(ds => {
        const o = ds.data();
        return o.templateType === "carwash" && o.planType === "monthly_new" && o.status === "new";
      })
      .map(ds => ({ id: ds.id, data: ds.data() }));
    const canceledOrders = orderSnap.docs
      .filter(ds => {
        const o = ds.data();
        return o.templateType === "carwash" && o.planType === "monthly_new" && o.status === "canceled";
      })
      .map(ds => ({ id: ds.id, data: ds.data() }));

    list.innerHTML = "";
    let activeCount = 0;
    let remainingTotal = 0;
    let todayCount = 0;

    pendingOrders.forEach(({ id, data }) => list.appendChild(renderPendingOrder(id, data)));

    subscriptionSnap.docs.forEach(ds => {
      const row = renderSubscriptionRow(ds.id, ds.data(), customerMap.get(ds.id) || {}, now);
      if (row.operational) {
        activeCount += 1;
        remainingTotal += row.remaining;
      }
      if (row.dueToday) todayCount += 1;
      list.appendChild(row.card);
    });

    canceledOrders.slice(0, 20).forEach(({ data }) => {
      const card = document.createElement("article");
      card.className = "orderCard carwashOperationCard";
      card.dataset.states = "closed";
      card.dataset.search = `${data.customerName || ""} ${data.customerPhone || ""} ${data.carModel || ""} ${data.plateNumber || ""}`.toLowerCase();
      card.innerHTML = `<div class="orderTop"><div><h3>${esc(data.customerName || "عميل")}</h3><span class="muted">${esc(data.customerPhone || "-")}</span></div><span class="orderStatus status-canceled">طلب ملغي</span></div><div class="orderGrid"><div class="orderInfo"><b>🚗 السيارة</b>${esc(data.carModel || "-")} — ${esc(data.plateNumber || "-")}</div></div>`;
      list.appendChild(card);
    });

    document.getElementById("activeCarwashSubscriptions").innerText = activeCount;
    document.getElementById("remainingSubscriptionWashes").innerText = remainingTotal;
    document.getElementById("carwashPendingCount").innerText = pendingOrders.length;
    document.getElementById("carwashTodayCount").innerText = todayCount;

    if (!list.children.length) list.innerHTML = '<div class="emptyState">لا توجد عمليات حتى الآن.</div>';
    applyFilters();
  } catch (error) {
    list.innerHTML = `<div class="emptyState">${esc(error.message || "تعذر تحميل مركز التشغيل.")}</div>`;
  } finally {
    rendering = false;
  }
}

async function consumeWash(subscriptionId, button) {
  if (!auth.currentUser || !projectId || !button) return;
  button.disabled = true;
  button.textContent = "جاري تسجيل الغسلة...";
  try {
    const subRef = doc(db, "carwashSubscriptions", subscriptionId);
    const washRef = doc(collection(db, "carwashSubscriptions", subscriptionId, "washes"));
    let completed = false;
    await runTransaction(db, async tx => {
      const snap = await tx.get(subRef);
      if (!snap.exists() || snap.data().projectId !== projectId) throw new Error("الاشتراك غير موجود.");
      const data = snap.data();
      const remaining = Number(data.remainingWashes || 0);
      const total = Number(data.totalWashes || 0);
      const expires = toDate(data.expiresAt);
      if (data.status !== "active" || remaining <= 0 || (expires && expires < new Date())) throw new Error("هذا الاشتراك غير متاح لتسجيل غسلة جديدة.");
      const nextRemaining = remaining - 1;
      const sequence = Math.max(1, total - remaining + 1);
      const intervalDays = Math.max(1, Number(data.intervalDays || 7));
      const scheduled = toDate(data.nextWashDate);
      let nextWashDate = null;
      if (nextRemaining > 0) {
        const base = scheduled && scheduled > new Date() ? new Date(scheduled) : new Date();
        base.setDate(base.getDate() + intervalDays);
        nextWashDate = expires && base > expires ? expires : base;
      }
      tx.update(subRef, {
        remainingWashes: nextRemaining,
        status: nextRemaining > 0 ? "active" : "completed",
        nextWashDate,
        lastWashAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      tx.set(washRef, { projectId, sequence, scheduledFor: data.nextWashDate || null, completedAt: serverTimestamp() });
      completed = nextRemaining === 0;
    });
    if (completed) {
      await setDoc(doc(db, "carwashSubscriptionRequests", subscriptionId), { projectId, status: "renewable", updatedAt: serverTimestamp() }, { merge: true });
    }
    await renderOperations();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message || "تعذر تحديث الغسلة";
  }
}

if (isCarWashProject) {
  onAuthStateChanged(auth, user => { if (user) queueRender(0); });
  window.addEventListener("focus", () => queueRender(150));
}

export { renderOperations as refreshCarwashOperations };
