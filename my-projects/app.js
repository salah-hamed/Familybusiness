import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const container =
  document.getElementById("projectsContainer");

onAuthStateChanged(auth, async (user) => {

  if (!user) {

    window.location.href = "/Familybusiness/login/";
    return;

  }

  const snap =
    await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) {

    container.innerHTML = "المستخدم غير موجود";
    return;

  }

  const data = snap.data();

  container.innerHTML = `
    <h2>مرحباً ${data.name}</h2>

    <p>حالة الاشتراك:
      ${data.subscriptionStatus || "غير مفعل"}
    </p>
  `;

});
