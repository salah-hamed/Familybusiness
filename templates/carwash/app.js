import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const priceBox = $("priceBox");
const locationInput = $("location");
const locationButton = $("getLocationBtn");
const locationButtonText = $("locationBtnText");
const submitOrderBtn = $("submitOrder");
const bookingStatus = $("status");
const whatsappBtn = $("whatsappBtn");
const paymentBtn = $("paymentBtn");
const subscriberState = $("subscriberState");

let pricing = { monthly: 0, monthlyWashes: 4, single: 0 };
let selectedPlan = "monthly";
let currentProjectId = "";
let validatedSubscription = null;

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePlate(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

async function subscriptionKey(projectId, phone, plate) {
  const raw = `${projectId}|${normalizePhone(phone)}|${normalizePlate(plate)}`;
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getSelectedPrice() {
  if (selectedPlan === "monthly") return Number(pricing.monthly || 0);
  if (selectedPlan === "single") return Number(pricing.single || 0);
  return 0;
}

function renderPlan() {
  document.querySelectorAll(".planCard[data-plan]").forEach(btn => btn.classList.toggle("active", btn.dataset.plan === selectedPlan));
  const monthly = selectedPlan === "monthly";
  const existing = selectedPlan === "subscriber";
  $("selectedPlanTitle").innerText = monthly ? "الاشتراك الشهري" : existing ? "غسلة من اشتراكك" : "غسلة واحدة";
  $("selectedPlanHint").innerText = monthly ? "ابدأ اشتراكك واحجز أول غسلة" : existing ? "سيتم خصم غسلة واحدة من رصيدك" : "غسيل خارجي مرة واحدة";
  $("priorityBadge").style.display = monthly ? "inline-flex" : "none";
  submitOrderBtn.innerText = monthly ? "اشترك واحجز أول غسلة" : existing ? "احجز من رصيد الاشتراك" : "احجز غسلة واحدة";
  $("floatingOrderBtn").querySelector("span").innerText = monthly ? "اشترك الآن" : "احجز الآن";
  priceBox.innerText = existing ? "من رصيدك" : `${getSelectedPrice()} جنيه`;
  $("planSummary").innerText = monthly
    ? `${pricing.monthlyWashes} غسلات خارجية خلال شهر — أول موعد تحدده الآن.`
    : existing
      ? "أدخل نفس رقم الهاتف ورقم لوحة السيارة المسجلين في اشتراكك وسنتحقق من الرصيد قبل إرسال الطلب."
      : "غسلة خارجية واحدة بدون اشتراك شهري.";
  validatedSubscription = null;
  subscriberState.classList.remove("show");
  subscriberState.innerText = "";
}

function unavailable() {
  document.querySelector(".app").innerHTML = '<div style="text-align:center;padding:40px 20px;max-width:500px;margin:40px auto;background:#fff;border-radius:22px"><div style="font-size:44px">🔒</div><h2>المشروع غير متاح</h2><p>هذا المشروع غير متاح حاليًا. يرجى التواصل مع صاحب المشروع.</p></div>';
}

function normalizeEgyptWhatsapp(number) {
  let clean = String(number || "").replace(/\D/g, "");
  if (clean.startsWith("0020")) clean = clean.slice(2);
  if (clean.startsWith("20")) return clean;
  if (clean.startsWith("0")) clean = clean.slice(1);
  return `20${clean}`;
}

function validate() {
  const required = [$("customerName").value.trim(), $("customerPhone").value.trim(), $("carModel").value.trim(), $("carColor").value.trim(), $("plateNumber").value.trim(), $("customerAddress").value.trim(), $("visitDate").value, $("visitTime").value];
  if (required.some(v => !v)) return "من فضلك أكمل بيانات العميل والسيارة والمكان والموعد.";
  if (!/^01\d{9}$/.test($("customerPhone").value.replace(/\s/g, ""))) return "من فضلك أدخل رقم موبايل مصري صحيح مكوّن من 11 رقمًا.";
  return null;
}

async function validateExistingSubscription() {
  const key = await subscriptionKey(currentProjectId, $("customerPhone").value, $("plateNumber").value);
  const snap = await getDoc(doc(db, "carwashSubscriptions", key));
  if (!snap.exists()) return { ok: false, message: "لم نجد اشتراكًا نشطًا بهذه البيانات." };
  const data = snap.data();
  if (data.projectId !== currentProjectId || data.status !== "active") return { ok: false, message: "الاشتراك غير نشط حاليًا." };
  if (Number(data.remainingWashes || 0) <= 0) return { ok: false, message: "تم استخدام كل غسلات الاشتراك الحالي." };
  if (data.expiresAt?.toDate && data.expiresAt.toDate() < new Date()) return { ok: false, message: "انتهت مدة الاشتراك الشهري." };
  validatedSubscription = { key, ...data };
  subscriberState.innerText = `✅ اشتراك نشط — متبقي ${data.remainingWashes} من ${data.totalWashes} غسلات`;
  subscriberState.classList.add("show");
  return { ok: true, key };
}

function scrollToSection(id) { $(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }

document.querySelectorAll(".planCard[data-plan]").forEach(btn => {
  btn.onclick = () => { selectedPlan = btn.dataset.plan; renderPlan(); };
});

locationButton.onclick = () => {
  if (!navigator.geolocation) { locationButtonText.innerText = "الموقع غير مدعوم على هذا الجهاز"; return; }
  locationButton.disabled = true;
  locationButtonText.innerText = "جاري تحديد الموقع...";
  navigator.geolocation.getCurrentPosition(
    pos => { locationInput.value = `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`; locationButtonText.innerText = "تم تحديد الموقع ✅"; locationButton.disabled = false; },
    () => { locationButtonText.innerText = "تعذر تحديد الموقع — حاول مرة أخرى"; locationButton.disabled = false; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

$("floatingOrderBtn").onclick = () => scrollToSection("bookingSection");
document.querySelectorAll(".navItem[data-target]").forEach(item => item.onclick = () => { document.querySelectorAll(".navItem").forEach(n => n.classList.remove("active")); item.classList.add("active"); scrollToSection(item.dataset.target); });
$("visitDate").min = new Date().toISOString().split("T")[0];

async function init() {
  currentProjectId = new URLSearchParams(location.search).get("project") || "";
  if (!currentProjectId) { unavailable(); return; }
  let snap;
  try { snap = await getDoc(doc(db, "projects", currentProjectId)); } catch { unavailable(); return; }
  if (!snap.exists()) { unavailable(); return; }
  const data = snap.data();
  if (!data.isActive || data.status !== "active" || data.template !== "carwash") { unavailable(); return; }

  $("businessTitle").innerText = data.businessName || "غسيل السيارات";
  pricing = {
    monthly: Number(data.priceConfig?.monthly ?? data.priceConfig?.base ?? 0),
    monthlyWashes: Math.max(1, Number(data.priceConfig?.monthlyWashes ?? 4)),
    single: Number(data.priceConfig?.single ?? data.priceConfig?.base ?? 0)
  };
  $("monthlyPlanPrice").innerText = pricing.monthly;
  $("monthlyWashesLabel").innerText = `${pricing.monthlyWashes} غسلات`;
  $("singlePlanPrice").innerText = pricing.single;
  renderPlan();

  if (data.whatsappNumber) whatsappBtn.href = `https://wa.me/${normalizeEgyptWhatsapp(data.whatsappNumber)}`; else whatsappBtn.style.display = "none";
  if (data.instapayLink) paymentBtn.href = data.instapayLink; else paymentBtn.style.display = "none";

  submitOrderBtn.onclick = async () => {
    const error = validate();
    if (error) { bookingStatus.innerText = error; return; }

    bookingStatus.innerText = selectedPlan === "subscriber" ? "جاري التحقق من الاشتراك..." : "جاري إرسال الطلب...";
    submitOrderBtn.disabled = true;

    let key = await subscriptionKey(currentProjectId, $("customerPhone").value, $("plateNumber").value);
    if (selectedPlan === "subscriber") {
      try {
        const check = await validateExistingSubscription();
        if (!check.ok) { bookingStatus.innerText = check.message; submitOrderBtn.disabled = false; return; }
        key = check.key;
      } catch (e) {
        bookingStatus.innerText = "تعذر التحقق من الاشتراك الآن. حاول مرة أخرى.";
        submitOrderBtn.disabled = false;
        return;
      }
    }

    const order = {
      projectId: currentProjectId,
      providerId: currentProjectId,
      templateType: "carwash",
      serviceType: "external_car_wash",
      planType: selectedPlan === "monthly" ? "monthly_new" : selectedPlan === "subscriber" ? "subscription_use" : "single",
      subscriptionKey: selectedPlan === "single" ? "" : key,
      packageWashes: selectedPlan === "monthly" ? pricing.monthlyWashes : null,
      customerName: $("customerName").value.trim(),
      customerPhone: $("customerPhone").value.trim(),
      customerAddress: $("customerAddress").value.trim(),
      location: locationInput.value,
      carModel: $("carModel").value.trim(),
      carColor: $("carColor").value.trim(),
      plateNumber: $("plateNumber").value.trim(),
      notes: $("notes").value.trim(),
      visitDate: $("visitDate").value,
      visitTime: $("visitTime").value,
      price: getSelectedPrice(),
      status: "new"
    };

    const res = await createOrder(order);
    bookingStatus.innerText = res.success
      ? selectedPlan === "monthly" ? "تم إرسال طلب الاشتراك الشهري وحجز أول غسلة 🎉" : selectedPlan === "subscriber" ? "تم حجز الغسلة من اشتراكك بنجاح 🎉" : "تم استلام طلب الغسيل بنجاح 🎉"
      : res.error;
    submitOrderBtn.disabled = false;
    if (res.success) submitOrderBtn.innerText = "تم إرسال الطلب ✅";
  };
}

init();
