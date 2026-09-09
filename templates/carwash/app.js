import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
let pricing = { monthly: 0, monthlyWashes: 4 };
let currentProjectId = "";
let savedProfile = null;
let currentSubscription = null;
let currentSubscriptionKey = "";

function storageKey() {
  return `familybusiness:carwash:${currentProjectId}:customer`;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePlate(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeEgyptWhatsapp(number) {
  let clean = String(number || "").replace(/\D/g, "");
  if (clean.startsWith("0020")) clean = clean.slice(2);
  if (clean.startsWith("20")) return clean;
  if (clean.startsWith("0")) clean = clean.slice(1);
  return `20${clean}`;
}

async function subscriptionKey(projectId, phone, plate) {
  const raw = `${projectId}|${normalizePhone(phone)}|${normalizePlate(plate)}`;
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().split("T")[0];
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function scrollToSection(id) {
  $(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function unavailable() {
  document.querySelector(".app").innerHTML = `
    <div style="text-align:center;padding:40px 20px;max-width:500px;margin:40px auto;background:#fff;border-radius:22px">
      <div style="font-size:44px">🔒</div>
      <h2>المشروع غير متاح</h2>
      <p>هذا المشروع غير متاح حاليًا. يرجى التواصل مع صاحب المشروع.</p>
    </div>`;
}

function toDate(value) {
  return value?.toDate ? value.toDate() : value ? new Date(value) : null;
}

function formatDate(value) {
  const date = toDate(value);
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("ar-EG")
    : "-";
}

function readProfile() {
  try {
    return JSON.parse(localStorage.getItem(storageKey()) || "null");
  } catch {
    return null;
  }
}

function collectProfile() {
  return {
    customerName: $("customerName").value.trim(),
    customerPhone: $("customerPhone").value.trim(),
    carModel: $("carModel").value.trim(),
    carColor: $("carColor").value.trim(),
    plateNumber: $("plateNumber").value.trim(),
    customerAddress: $("customerAddress").value.trim(),
    location: $("location").value,
    firstWashDate: $("firstWashDate").value,
    preferredTime: $("preferredTime").value,
    notes: $("notes").value.trim()
  };
}

function saveProfile(profile) {
  localStorage.setItem(storageKey(), JSON.stringify(profile));
  savedProfile = profile;
}

function fillProfile(profile) {
  if (!profile) return;
  [
    "customerName",
    "customerPhone",
    "carModel",
    "carColor",
    "plateNumber",
    "customerAddress",
    "location",
    "firstWashDate",
    "preferredTime",
    "notes"
  ].forEach(id => {
    if ($(id) && profile[id]) $(id).value = profile[id];
  });
  $("savedNotice")?.classList.remove("hidden");
}

function prepareRenewalDate() {
  const input = $("firstWashDate");
  if (!input) return;
  const today = new Date();
  const min = dateInputValue(today);
  const max = dateInputValue(addDays(today, 30));
  input.min = min;
  input.max = max;
  if (!input.value || input.value < min || input.value > max) {
    input.value = min;
  }
}

function validateProfile(profile) {
  if (
    !profile.customerName ||
    !profile.customerPhone ||
    !profile.carModel ||
    !profile.carColor ||
    !profile.plateNumber ||
    !profile.customerAddress ||
    !profile.firstWashDate ||
    !profile.preferredTime
  ) {
    return "من فضلك أكمل بيانات العميل والسيارة والعنوان وأول موعد للغسيل.";
  }

  if (!/^01\d{9}$/.test(profile.customerPhone.replace(/\s/g, ""))) {
    return "من فضلك أدخل رقم موبايل مصري صحيح مكوّن من 11 رقمًا.";
  }

  const selected = new Date(`${profile.firstWashDate}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = addDays(today, 30);
  maxDate.setHours(23, 59, 59, 999);

  if (selected < today) {
    return "من فضلك اختر موعدًا من اليوم أو بعده.";
  }

  if (selected > maxDate) {
    return "أول غسلة لازم تكون خلال 30 يومًا من تاريخ طلب الاشتراك.";
  }

  return null;
}

function isRenewable(sub) {
  if (!sub) return true;
  const expires = toDate(sub.expiresAt);
  return (
    sub.status !== "active" ||
    Number(sub.remainingWashes || 0) <= 0 ||
    (expires && expires < new Date())
  );
}

async function loadWashHistory(key) {
  const box = $("washHistory");
  if (!box || !key) return;

  try {
    const snap = await getDocs(
      query(
        collection(db, "carwashSubscriptions", key, "washes"),
        orderBy("completedAt", "desc")
      )
    );

    box.innerHTML = "";
    snap.forEach(ds => {
      const wash = ds.data();
      const row = document.createElement("div");
      row.className = "historyItem";
      row.innerHTML = `<span>💦 الغسلة ${Number(wash.sequence || 0)}</span><b>${formatDate(wash.completedAt)}</b>`;
      box.appendChild(row);
    });

    if (snap.empty) {
      box.innerHTML = '<div class="helperText">لا توجد غسلات منفذة بعد.</div>';
    }
  } catch {
    box.innerHTML = '<div class="helperText">تعذر تحميل سجل الغسلات الآن.</div>';
  }
}

async function showSubscription(sub) {
  currentSubscription = sub;
  currentSubscriptionKey = sub.key || currentSubscriptionKey;

  const section = $("subscriptionStatus");
  section.classList.add("show");

  const total = Number(sub.totalWashes || 0);
  const remaining = Number(sub.remainingWashes || 0);
  const used = Math.max(0, total - remaining);

  $("remainingWashes").innerText = remaining;
  $("usedWashes").innerText = used;
  $("subscriptionProgress").style.width = total > 0
    ? `${Math.min(100, Math.max(0, (used / total) * 100))}%`
    : "0%";

  const expires = toDate(sub.expiresAt);
  const renewable = isRenewable(sub);

  $("subscriptionTitle").innerText = renewable
    ? "اشتراكك يحتاج تجديد"
    : "اشتراكك نشط ✅";

  $("subscriptionMessage").innerText = renewable
    ? "بياناتك محفوظة. يمكنك تجديد الشهر الجديد مباشرة، وسيتم تحديث موعد أول غسلة تلقائيًا إذا كان الموعد القديم انتهى."
    : `تم تنفيذ ${used} من ${total} غسلات هذا الشهر.`;

  $("subscriptionExpiry").innerText = expires
    ? `ينتهي الاشتراك: ${expires.toLocaleDateString("ar-EG")}`
    : "";

  const next = toDate(sub.nextWashDate);
  $("nextWashText").innerText = !renewable && next
    ? `${next.toLocaleDateString("ar-EG")} — ${sub.preferredTime || "الوقت المتفق عليه"}`
    : renewable
      ? "لا توجد غسلة قادمة حتى تجديد الاشتراك."
      : "سيتم تحديد الموعد بعد التفعيل.";

  const daysLeft = expires
    ? Math.ceil((expires.getTime() - Date.now()) / 86400000)
    : null;

  const warning = $("renewWarning");
  if (!renewable && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3) {
    warning.innerText = `🔔 اشتراكك ينتهي خلال ${daysLeft === 0 ? "اليوم" : `${daysLeft} يوم`}. جهّز التجديد للشهر الجديد.`;
    warning.classList.add("show");
  } else {
    warning.classList.remove("show");
  }

  $("renewSubscriptionBtn").classList.toggle("hidden", !renewable);
  $("subscriptionForm").classList.toggle("hidden", !renewable);
  $("floatingOrderBtn").classList.toggle("hidden", !renewable);
  $("submitOrder").classList.toggle("hidden", renewable);

  if (renewable) prepareRenewalDate();

  await loadWashHistory(currentSubscriptionKey);
}

function showPendingState() {
  $("pendingBox")?.classList.add("show");
  $("submitOrder").disabled = true;
  $("submitOrder").innerText = "طلبك قيد المراجعة ⏳";
  $("renewSubscriptionBtn").disabled = true;
  $("renewSubscriptionBtn").innerText = "طلب التجديد قيد المراجعة ⏳";
  $("floatingOrderBtn").classList.add("hidden");
}

async function loadRequestState(key) {
  try {
    const snap = await getDoc(doc(db, "carwashSubscriptionRequests", key));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data.projectId !== currentProjectId) return null;
    if (data.status === "pending") showPendingState();
    return data;
  } catch {
    return null;
  }
}

async function loadSubscriptionByIdentity(phone, plate, { saveIdentity = false } = {}) {
  if (!phone || !plate) return false;

  const key = await subscriptionKey(currentProjectId, phone, plate);
  currentSubscriptionKey = key;

  const snap = await getDoc(doc(db, "carwashSubscriptions", key));
  await loadRequestState(key);

  if (!snap.exists()) return false;

  const data = snap.data();
  if (data.projectId !== currentProjectId) return false;

  if (saveIdentity) {
    const base = readProfile() || {};
    saveProfile({ ...base, customerPhone: phone, plateNumber: plate });
    if ($("customerPhone")) $("customerPhone").value = phone;
    if ($("plateNumber")) $("plateNumber").value = plate;
  }

  await showSubscription({ key, ...data });
  return true;
}

async function loadSavedSubscription() {
  savedProfile = readProfile();
  if (!savedProfile?.customerPhone || !savedProfile?.plateNumber) return false;

  fillProfile(savedProfile);

  try {
    return await loadSubscriptionByIdentity(
      savedProfile.customerPhone,
      savedProfile.plateNumber
    );
  } catch {
    return false;
  }
}

async function sendSubscriptionRequest(isRenewal = false) {
  if (isRenewal) prepareRenewalDate();

  const profile = collectProfile();
  const error = validateProfile(profile);
  const statusBox = isRenewal ? $("renewStatus") : $("status");

  if (error) {
    statusBox.innerText = error;
    return;
  }

  if (currentSubscription && !isRenewable(currentSubscription)) {
    statusBox.innerText = "اشتراكك الحالي ما زال نشطًا ولا يحتاج تجديد الآن.";
    return;
  }

  const button = isRenewal ? $("renewSubscriptionBtn") : $("submitOrder");
  button.disabled = true;
  statusBox.innerText = isRenewal
    ? "جاري إرسال طلب التجديد..."
    : "جاري إرسال طلب الاشتراك...";

  try {
    const key = await subscriptionKey(
      currentProjectId,
      profile.customerPhone,
      profile.plateNumber
    );

    const order = {
      projectId: currentProjectId,
      providerId: currentProjectId,
      templateType: "carwash",
      serviceType: "external_car_wash",
      planType: "monthly_new",
      renewal: isRenewal,
      subscriptionKey: key,
      packageWashes: pricing.monthlyWashes,
      ...profile,
      visitDate: profile.firstWashDate,
      visitTime: profile.preferredTime,
      price: pricing.monthly,
      status: "new"
    };

    const result = await createOrder(order, {
      requestKey: key,
      renewal: isRenewal
    });

    if (result.success) {
      saveProfile(profile);
      currentSubscriptionKey = key;
      statusBox.innerText = isRenewal
        ? "تم إرسال طلب تجديد الاشتراك بنجاح 🎉"
        : "تم إرسال طلب الاشتراك الشهري بنجاح 🎉";
      showPendingState();
    } else {
      statusBox.innerText = result.error;
    }
  } catch (errorObject) {
    statusBox.innerText = errorObject.message || "تعذر إرسال الطلب.";
  }

  if (!button.disabled || !statusBox.innerText.includes("قيد المراجعة")) {
    button.disabled = false;
  }
}

$("getLocationBtn").onclick = () => {
  if (!navigator.geolocation) {
    $("locationBtnText").innerText = "الموقع غير مدعوم على هذا الجهاز";
    return;
  }

  const button = $("getLocationBtn");
  button.disabled = true;
  $("locationBtnText").innerText = "جاري تحديد الموقع...";

  navigator.geolocation.getCurrentPosition(
    position => {
      $("location").value = `https://www.google.com/maps?q=${position.coords.latitude},${position.coords.longitude}`;
      $("locationBtnText").innerText = "تم تحديد الموقع ✅";
      button.disabled = false;
    },
    () => {
      $("locationBtnText").innerText = "تعذر تحديد الموقع — حاول مرة أخرى";
      button.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

$("floatingOrderBtn").onclick = () => scrollToSection("bookingSection");

document.querySelectorAll(".navItem[data-target]").forEach(item => {
  item.onclick = () => {
    document.querySelectorAll(".navItem").forEach(node => node.classList.remove("active"));
    item.classList.add("active");
    scrollToSection(item.dataset.target);
  };
});

$("submitOrder").onclick = () => sendSubscriptionRequest(false);
$("renewSubscriptionBtn").onclick = () => sendSubscriptionRequest(true);

$("refreshSubscriptionBtn").onclick = async () => {
  $("subscriptionMessage").innerText = "جاري تحديث الحالة...";
  const profile = readProfile();
  const ok = profile?.customerPhone && profile?.plateNumber
    ? await loadSubscriptionByIdentity(profile.customerPhone, profile.plateNumber)
    : false;

  if (!ok) {
    $("subscriptionMessage").innerText = "لم يتم تفعيل اشتراكك بعد. إذا أرسلت الطلب حديثًا انتظر تأكيد مقدم الخدمة.";
  }
};

$("lookupSubscriptionBtn").onclick = async () => {
  const phone = $("lookupPhone").value.trim();
  const plate = $("lookupPlate").value.trim();

  if (!phone || !plate) {
    $("lookupStatus").innerText = "اكتب رقم الهاتف ورقم اللوحة.";
    return;
  }

  $("lookupStatus").innerText = "جاري البحث...";

  try {
    const ok = await loadSubscriptionByIdentity(phone, plate, { saveIdentity: true });
    $("lookupStatus").innerText = ok
      ? "تم العثور على اشتراكك ✅"
      : "لم نجد اشتراكًا بهذه البيانات.";
  } catch {
    $("lookupStatus").innerText = "تعذر استرجاع الاشتراك الآن.";
  }
};

async function init() {
  currentProjectId = new URLSearchParams(location.search).get("project") || "";
  if (!currentProjectId) {
    unavailable();
    return;
  }

  let snap;
  try {
    snap = await getDoc(doc(db, "projects", currentProjectId));
  } catch {
    unavailable();
    return;
  }

  if (!snap.exists()) {
    unavailable();
    return;
  }

  const data = snap.data();
  if (!data.isActive || data.status !== "active" || data.template !== "carwash") {
    unavailable();
    return;
  }

  $("businessTitle").innerText = data.businessName || "غسيل السيارات";

  pricing = {
    monthly: Number(data.priceConfig?.monthly ?? data.priceConfig?.base ?? 0),
    monthlyWashes: Math.max(1, Number(data.priceConfig?.monthlyWashes ?? 4))
  };

  $("monthlyPlanPrice").innerText = pricing.monthly;
  $("monthlyWashesLabel").innerText = `${pricing.monthlyWashes} غسلات`;
  $("priceBox").innerText = `${pricing.monthly} جنيه`;

  const today = new Date();
  $("firstWashDate").min = dateInputValue(today);
  $("firstWashDate").max = dateInputValue(addDays(today, 30));

  if (data.whatsappNumber) {
    $("whatsappBtn").href = `https://wa.me/${normalizeEgyptWhatsapp(data.whatsappNumber)}`;
  } else {
    $("whatsappBtn").style.display = "none";
  }

  if (data.instapayLink) {
    $("paymentBtn").href = data.instapayLink;
  } else {
    $("paymentBtn").style.display = "none";
  }

  const found = await loadSavedSubscription();
  if (!found && savedProfile) fillProfile(savedProfile);
}

init();
