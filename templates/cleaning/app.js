import { createOrder } from "./orders.js";

const customerName = document.getElementById("customerName");
const customerPhone = document.getElementById("customerPhone");
const customerAddress = document.getElementById("customerAddress");
const status = document.getElementById("status");

document
  .getElementById("submitOrder")
  .addEventListener("click", async () => {

    const params = new URLSearchParams(window.location.search);

    const providerId = params.get("user");

    if (!providerId) {

      status.innerText = "الرابط غير صالح";
      return;

    }

    const order = {

      providerId,
      templateType: "cleaning",
      customerName: customerName.value,
      customerPhone: customerPhone.value,
      customerAddress: customerAddress.value,
      status: "new"

    };

    const result = await createOrder(order);

    if (result.success) {

      status.innerText = "تم إرسال الطلب ✅";

    } else {

      status.innerText = result.error;

    }

  });
