import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const rooms = document.getElementById("rooms");
const bathrooms = document.getElementById("bathrooms");
const kitchen = document.getElementById("kitchen");
const stairs = document.getElementById("stairs");
const priceBox = document.getElementById("priceBox");
const locationInput = document.getElementById("location");
const locationButton = document.getElementById("getLocationBtn");
const locationButtonText = document.getElementById("locationBtnText");
const submitOrderBtn = document.getElementById("submitOrder");
const bookingStatus = document.getElementById("status");
const whatsappBtn = document.getElementById("whatsappBtn");
const paymentBtn = document.getElementById("paymentBtn");

let priceConfig = {
  base: 0,
  room: 0,
  bathroom: 0,
  kitchen: 0,
  stairs: 0
};

function calcPrice() {

  let price = Number(priceConfig.base || 0);

  price += Number(rooms.value || 0) * Number(priceConfig.room || 0);
  price += Number(bathrooms.value || 0) * Number(priceConfig.bathroom || 0);

  if (kitchen.value === "yes") {
    price += Number(priceConfig.kitchen || 0);
  }

  if (stairs.value === "yes") {
    price += Number(priceConfig.stairs || 0);
  }

  priceBox.innerText = price + " جنيه";

  return price;
}

function showProjectUnavailable(message = "هذا المشروع غير متاح حاليًا. يرجى التواصل مع صاحب المشروع.") {
  document.querySelector(".app").innerHTML = `
    <div style="
      text-align:center;
      padding:40px 20px;
      max-width:500px;
      margin:40px auto;
      font-family:Tahoma,Arial,sans-serif;
      background:#fff;
      border-radius:22px;
      box-shadow:0 10px 30px rgba(0,0,0,.08);
    ">
      <div style="font-size:44px;margin-bottom:12px;">🔒</div>
      <h2>المشروع غير متاح</h2>
      <p style="color:#667085;line-height:1.7;">${message}</p>
    </div>
  `;
}

function hasConfiguredPricing(config = {}) {
  return ["base", "room", "bathroom", "kitchen", "stairs"].every(key =>
    Object.prototype.hasOwnProperty.call(config, key) &&
    Number.isFinite(Number(config[key])) &&
    Number(config[key]) >= 0
  );
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function normalizeEgyptWhatsapp(number) {
  let clean = String(number || "").replace(/\D/g, "");

  if (clean.startsWith("0020")) clean = clean.slice(2);
  if (clean.startsWith("+20")) clean = clean.slice(1);
  if (clean.startsWith("20")) return clean;
  if (clean.startsWith("0")) clean = clean.slice(1);

  return `20${clean}`;
}

function validateBooking() {
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const address = document.getElementById("customerAddress").value.trim();
  const visitDate = document.getElementById("visitDate").value;
  const visitTime = document.getElementById("visitTime").value;

  if (!name || !phone || !address) {
    return "من فضلك أكمل الاسم ورقم الهاتف والعنوان.";
  }

  if (!/^01\d{9}$/.test(phone.replace(/\s/g, ""))) {
    return "من فضلك أدخل رقم موبايل مصري صحيح مكوّن من 11 رقمًا.";
  }

  if (!visitDate || !visitTime) {
    return "من فضلك اختر تاريخ ووقت الزيارة.";
  }

  return null;
}

rooms.onchange = calcPrice;
bathrooms.onchange = calcPrice;
kitchen.onchange = calcPrice;
stairs.onchange = calcPrice;

locationButton.onclick = () => {

  if (!navigator.geolocation) {
    locationButtonText.innerText = "الموقع غير مدعوم على هذا الجهاز";
    return;
  }

  locationButton.disabled = true;
  locationButtonText.innerText = "جاري تحديد الموقع...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      locationInput.value = `https://www.google.com/maps?q=${lat},${lng}`;
      locationButtonText.innerText = "تم تحديد الموقع ✅";
      locationButton.disabled = false;
    },
    () => {
      locationButtonText.innerText = "تعذر تحديد الموقع — حاول مرة أخرى";
      locationButton.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000
    }
  );
};

document.getElementById("floatingOrderBtn").onclick = () => {
  scrollToSection("bookingSection");
};

document.querySelectorAll(".navItem[data-target]").forEach((item) => {
  item.onclick = () => {
    document.querySelectorAll(".navItem").forEach((nav) => {
      nav.classList.remove("active");
    });

    item.classList.add("active");
    scrollToSection(item.dataset.target);
  };
});

const visitDateInput = document.getElementById("visitDate");
visitDateInput.min = new Date().toISOString().split("T")[0];

async function init() {

  const projectId =
    new URLSearchParams(location.search).get("project");

  if (!projectId) {
    showProjectUnavailable();
    return;
  }

  let snap;

  try {
    snap = await getDoc(doc(db, "projects", projectId));
  } catch (error) {
    showProjectUnavailable();
    return;
  }

  if (!snap.exists()) {
    showProjectUnavailable();
    return;
  }

  const data = snap.data();

  if (data.template !== "cleaning" || !data.isActive || data.status !== "active") {
    showProjectUnavailable();
    return;
  }

  if (!hasConfiguredPricing(data.priceConfig || {})) {
    showProjectUnavailable("مقدم الخدمة لم يجهز أسعار المشروع بعد. يرجى المحاولة لاحقًا.");
    return;
  }

  document.getElementById("businessTitle").innerText =
    data.businessName || "خدمة تنظيف";

  priceConfig = {
    base: Number(data.priceConfig.base),
    room: Number(data.priceConfig.room),
    bathroom: Number(data.priceConfig.bathroom),
    kitchen: Number(data.priceConfig.kitchen),
    stairs: Number(data.priceConfig.stairs)
  };

  calcPrice();

  if (data.whatsappNumber) {
    whatsappBtn.href =
      `https://wa.me/${normalizeEgyptWhatsapp(data.whatsappNumber)}`;
  } else {
    whatsappBtn.style.display = "none";
  }

  if (data.instapayLink) {
    paymentBtn.href = data.instapayLink;
  } else {
    paymentBtn.style.display = "none";
  }

  submitOrderBtn.onclick = async () => {

    const validationError = validateBooking();

    if (validationError) {
      bookingStatus.innerText = validationError;
      return;
    }

    bookingStatus.innerText = "جاري إرسال الطلب...";
    submitOrderBtn.disabled = true;

    const order = {
      projectId,
      providerId: projectId,
      templateType: "cleaning",

      customerName: document.getElementById("customerName").value.trim(),
      customerPhone: document.getElementById("customerPhone").value.trim(),
      customerAddress: document.getElementById("customerAddress").value.trim(),

      location: locationInput.value,

      rooms: Number(rooms.value),
      bathrooms: Number(bathrooms.value),
      kitchen: kitchen.value,
      stairs: stairs.value,
      visitDate: document.getElementById("visitDate").value,
      visitTime: document.getElementById("visitTime").value,
      price: calcPrice(),
      status: "new"
    };

    const res = await createOrder(order);

    bookingStatus.innerText =
      res.success
        ? "تم استلام الطلب بنجاح 🎉"
        : res.error;

    submitOrderBtn.disabled = false;

    if (res.success) {
      submitOrderBtn.innerText = "تم إرسال الطلب ✅";
    }
  };

  calcPrice();
}

init();
