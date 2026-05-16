import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const customerName = document.getElementById("customerName");
const customerPhone = document.getElementById("customerPhone");
const customerAddress = document.getElementById("customerAddress");
const status = document.getElementById("status");

const businessTitle = document.getElementById("businessTitle");
const whatsappBtn = document.getElementById("whatsappBtn");
const paymentBtn = document.getElementById("paymentBtn");

init();

async function init() {

  const params =
    new URLSearchParams(window.location.search);

  const providerId =
    params.get("user");

  if (!providerId) {

    status.innerText = "الرابط غير صالح";
    return;

  }

  const userRef =
    doc(db, "users", providerId);

  const userSnap =
    await getDoc(userRef);

  if (!userSnap.exists()) return;

  const userData =
    userSnap.data();

  businessTitle.innerText =
    userData.businessName || "خدمة تنظيف";

  if (userData.whatsappNumber) {

    whatsappBtn.href =
      `https://wa.me/${userData.whatsappNumber}`;

  }

  if (userData.instapayLink) {

    paymentBtn.href =
      userData.instapayLink;

  }

  document
    .getElementById("submitOrder")
    .addEventListener("click", async () => {

      const order = {

        providerId,
        templateType: "cleaning",
        customerName: customerName.value,
        customerPhone: customerPhone.value,
        customerAddress: customerAddress.value,
        status: "new"

      };

      const result =
        await createOrder(order);

      status.innerText =
        result.success
          ? "تم إرسال الطلب ✅"
          : result.error;

    });

}
