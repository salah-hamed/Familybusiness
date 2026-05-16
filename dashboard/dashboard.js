import {import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { protectPage } from "../core/auth/auth-guard.js";
import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";

import { logoutUser } from "../core/auth/auth.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

protectPage();

const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const projectType = document.getElementById("projectType");
const status = document.getElementById("status");

onAuthStateChanged(auth, async (user) => {

  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

if (userSnap.exists()) {

  const data = userSnap.data();

  userName.innerText = "Name: " + data.name;
  userEmail.innerText = "Email: " + data.email;
  projectType.innerText = "Project: " + (data.projectType || "cleaning");
  status.innerText = "Active: " + data.isActive;

  const linkInput = document.getElementById("projectLink");

  const projectSlug = data.projectType || "cleaning";

  const link =
    `${window.location.origin}/Familybusiness/templates/${projectSlug}/?user=${user.uid}`;

  linkInput.value = link;
  document.getElementById("businessName").value =
  data.businessName || "";

document.getElementById("whatsappNumber").value =
  data.whatsappNumber || "";

document.getElementById("instapayLink").value =
  data.instapayLink || "";
loadOrders(user.uid);
}

});

document
  .getElementById("logoutBtn")
  .addEventListener("click", async () => {

    await logoutUser();

    window.location.href = "/Familybusiness/";

  });
document
  .getElementById("copyLinkBtn")
  .addEventListener("click", async () => {

    const link = document.getElementById("projectLink").value;

    await navigator.clipboard.writeText(link);

    document.getElementById("copyStatus").innerText =
      "تم نسخ الرابط ✅";

  });
async function loadOrders(providerId) {

  const ordersContainer =
    document.getElementById("ordersContainer");

  ordersContainer.innerHTML = "جاري التحميل...";

  const q = query(
    collection(db, "orders"),
    where("providerId", "==", providerId)
  );

  const snapshot = await getDocs(q);

  ordersContainer.innerHTML = "";

  if (snapshot.empty) {

    ordersContainer.innerHTML =
      "<p>لا توجد طلبات بعد</p>";

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
      <p><b>العنوان:</b> ${order.customerAddress}</p>
      <p><b>الحالة:</b> ${order.status}</p>
    `;

    ordersContainer.appendChild(card);

  });

}
document
  .getElementById("saveSettingsBtn")
  .addEventListener("click", async () => {

    const user = auth.currentUser;

    if (!user) return;

    await updateDoc(
      doc(db, "users", user.uid),
      {
        businessName:
          document.getElementById("businessName").value,

        whatsappNumber:
          document.getElementById("whatsappNumber").value,

        instapayLink:
          document.getElementById("instapayLink").value
      }
    );

    document.getElementById("settingsStatus").innerText =
      "تم حفظ الإعدادات ✅";

  });
