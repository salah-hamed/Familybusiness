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
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const projectId = new URLSearchParams(location.search).get("project") || "";
const isCarWashProject = projectId.endsWith("_carwash");
let rendering = false;
let renderQueued = false;

if (isCarWashProject) {
  document.body.classList.add("carwashDashboard");
}

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
  return !!(
    a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function ensureOperationsList() {
  const panel = document.getElementById("carwashSubscriptionsPanel");
  if (!panel) return null;

  const legacyList = document.getElementById("subscriptionsList");
  if (legacyList) legacyList.style.display = "none";

  let list = document.getElementById("carwashOperationsList");
  if (!list) {
    list = document.createElement("div");
    list.id = "carwashOperationsList";
    list.className = "ordersList carwashOperationsList";
    if (legacyList) legacyList.insertAdjacentElement("afterend", list);
    else panel.appendChild(list);
  }

  return list;
}

function ensureOperationalStats() {
  const grid = document.querySelector("#carwashSubscriptionsPanel .statGrid");
  if (!grid) return;

  if (!document.getElementById("carwashTodayCount")) {
    const today = document.createElement("article");
    today.className = "statCard accentNew";
    today.innerHTML = '<span class="statIcon">🚗</span><div><span class="statLabel">غسلات اليوم</span><strong id="carwashTodayCount">0</strong></div>';
    grid.appendChild(today);
  }

  if (!document.getElementById("carwashRenewSoonCount")) {
    const renew = document.createElement("article");
    renew.className = "statCard";
    renew.innerHTML = '<span class="statIcon">🔔</span><div><span class="statLabel">تجديد قريب</span><strong id="carwashRenewSoonCount">0</strong></div>';
    grid.appendChild(renew);
  }
}

async function waitForPanel(maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (ensureOperationsList()) return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

function queueRender(delay = 0) {
  if (!isCarWashProject) return;
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(async () => {
    renderQueued = false;
    await renderSubscriptions();
  }, delay);
}

async function renderSubscriptions() {
  if (!isCarWashProject || rendering || !auth.currentUser) return;
  const ready = await waitForPanel();
  if (!ready) return;

  const list = ensureOperationsList();
  if (!list) return;

  rendering = true;
  ensureOperationalStats();
  list.innerHTML = '<div class="emptyState">جاري تحميل الاشتراكات...</div>';

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "carwashSubscriptions"),
        where("projectId", "==", projectId)
      )
    );

    const now = new Date();
    const rows = await Promise.all(
      snapshot.docs.map(async (subscriptionDoc) => {
        const sub = subscriptionDoc.data();
        const expires = toDate(sub.expiresAt);
        const nextWash = toDate(sub.nextWashDate);
        const remaining = Number(sub.remainingWashes || 0);
        const operational =
          sub.status === "active" &&
          remaining > 0 &&
          (!expires || expires >= now);

        const customerSnap = await getDoc(
          doc(db, "carwashCustomers", subscriptionDoc.id)
        );

        return {
          id: subscriptionDoc.id,
          sub,
          customer: customerSnap.exists() ? customerSnap.data() : {},
          operational,
          expires,
          nextWash,
          daysLeft: expires
            ? Math.ceil((expires.getTime() - now.getTime()) / 86400000)
            : null
        };
      })
    );

    rows.sort((a, b) => {
      if (a.operational !== b.operational) return a.operational ? -1 : 1;
      return (
        (a.nextWash?.getTime() || Number.MAX_SAFE_INTEGER) -
        (b.nextWash?.getTime() || Number.MAX_SAFE_INTEGER)
      );
    });

    let activeCount = 0;
    let remainingTotal = 0;
    let todayCount = 0;
    let renewSoon = 0;

    list.innerHTML = "";

    rows.forEach(({ id, sub, customer, operational, expires, nextWash, daysLeft }) => {
      const remaining = Number(sub.remainingWashes || 0);
      const total = Number(sub.totalWashes || 0);

      if (operational) {
        activeCount += 1;
        remainingTotal += remaining;
        if (sameDay(nextWash, now)) todayCount += 1;
        if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 3) renewSoon += 1;
      }

      const name = esc(customer.customerName || "عميل اشتراك");
      const phone = esc(customer.customerPhone || "-");
      const car = esc(customer.carModel || "-");
      const plate = esc(customer.plateNumber || "-");
      const address = esc(customer.customerAddress || "-");
      const wa = cleanPhone(customer.customerPhone);
      const maps =
        typeof customer.location === "string" &&
        customer.location.startsWith("http")
          ? customer.location
          : "";

      const statusText = operational
        ? "نشط"
        : remaining <= 0
          ? "اكتمل الرصيد"
          : expires && expires < now
            ? "انتهى الشهر"
            : sub.status || "غير نشط";

      const card = document.createElement("article");
      card.className = "orderCard carwashSubscriptionCard";
      card.dataset.subscriptionId = id;
      card.innerHTML = `
        <div class="orderTop">
          <div><h3>${name}</h3><span class="muted">${phone}</span></div>
          <span class="orderStatus ${operational ? "status-accepted" : "status-canceled"}">${esc(statusText)}</span>
        </div>
        <div class="orderGrid">
          <div class="orderInfo"><b>🚗 السيارة</b>${car} — ${plate}</div>
          <div class="orderInfo"><b>📍 العنوان</b>${address}</div>
          <div class="orderInfo"><b>🗓️ الغسلة القادمة</b>${nextWash ? nextWash.toLocaleDateString("ar-EG") : "-"} — ${esc(sub.preferredTime || customer.preferredTime || "-")}</div>
          <div class="orderInfo"><b>🔁 الرصيد</b>${remaining} من ${total} غسلات</div>
          <div class="orderInfo"><b>⏳ نهاية الاشتراك</b>${expires ? expires.toLocaleDateString("ar-EG") : "-"}${daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 ? " — تجديد قريب" : ""}</div>
        </div>
        <div class="orderActions">
          ${wa ? `<a class="orderAction whatsapp" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 واتساب</a>` : ""}
          ${maps ? `<a class="orderAction maps" href="${esc(maps)}" target="_blank" rel="noopener">🗺️ فتح الموقع</a>` : ""}
          ${operational ? '<button type="button" class="orderAction done washDoneBtn">💦 تسجيل غسلة منفذة</button>' : ""}
        </div>`;

      card.querySelector(".washDoneBtn")?.addEventListener("click", event => {
        consumeWash(id, event.currentTarget);
      });

      list.appendChild(card);
    });

    document.getElementById("activeCarwashSubscriptions").innerText = activeCount;
    document.getElementById("remainingSubscriptionWashes").innerText = remainingTotal;
    document.getElementById("carwashTodayCount").innerText = todayCount;
    document.getElementById("carwashRenewSoonCount").innerText = renewSoon;

    if (!rows.length) {
      list.innerHTML = '<div class="emptyState">لا توجد اشتراكات بعد.</div>';
    }
  } catch (error) {
    list.innerHTML = `<div class="emptyState">${esc(error.message || "تعذر تحميل الاشتراكات.")}</div>`;
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
    const washRef = doc(
      collection(db, "carwashSubscriptions", subscriptionId, "washes")
    );

    let completed = false;

    await runTransaction(db, async tx => {
      const snap = await tx.get(subRef);
      if (!snap.exists() || snap.data().projectId !== projectId) {
        throw new Error("الاشتراك غير موجود.");
      }

      const data = snap.data();
      const remaining = Number(data.remainingWashes || 0);
      const total = Number(data.totalWashes || 0);
      const expires = toDate(data.expiresAt);

      if (
        data.status !== "active" ||
        remaining <= 0 ||
        (expires && expires < new Date())
      ) {
        throw new Error("هذا الاشتراك غير متاح لتسجيل غسلة جديدة.");
      }

      const nextRemaining = remaining - 1;
      const sequence = Math.max(1, total - remaining + 1);
      const intervalDays = Math.max(1, Number(data.intervalDays || 7));
      const scheduled = toDate(data.nextWashDate);

      let nextWashDate = null;
      if (nextRemaining > 0) {
        const base = scheduled && scheduled > new Date()
          ? new Date(scheduled)
          : new Date();
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

      tx.set(washRef, {
        projectId,
        sequence,
        scheduledFor: data.nextWashDate || null,
        completedAt: serverTimestamp()
      });

      completed = nextRemaining === 0;
    });

    if (completed) {
      await setDoc(
        doc(db, "carwashSubscriptionRequests", subscriptionId),
        {
          projectId,
          status: "renewable",
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    await renderSubscriptions();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message || "تعذر تحديث الغسلة";
  }
}

if (isCarWashProject) {
  onAuthStateChanged(auth, user => {
    if (user) queueRender(0);
  });

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".acceptBtn,.doneBtn,.cancelBtn")) {
      queueRender(900);
    }
  });

  window.addEventListener("focus", () => queueRender(100));
}

export { renderSubscriptions as refreshCarwashOperations };
