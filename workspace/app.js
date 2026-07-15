import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const userName =
  document.getElementById("userName");

const subscriptionStatus =
  document.getElementById("subscriptionStatus");

onAuthStateChanged(auth, async (user) => {

  if (!user) {

    window.location.href = "../index.html";
    return;

  }

  try {

    const userRef =
      doc(db, "users", user.uid);

    const userSnap =
      await getDoc(userRef);

    if (!userSnap.exists()) {

      userName.innerText = "المستخدم غير موجود";

      return;

    }

    const data =
      userSnap.data();

    userName.innerText =
      `أهلاً ${data.name}`;

    subscriptionStatus.innerText =
      data.isActive
      ? "✅ الاشتراك مفعل"
      : "⏳ الاشتراك قيد المراجعة";

  } catch (error) {

    console.error(error);

    userName.innerText =
      "حدث خطأ أثناء تحميل البيانات";

  }

});
