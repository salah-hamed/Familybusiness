import auth from "../firebase/firebase-auth.js";
import db from "../firebase/firebase-db.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function protectAdmin(callback) {

  onAuthStateChanged(auth, async (user) => {

    if (!user) {
      window.location.href = "/Familybusiness/";
      return;
    }

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));

      if (!userSnap.exists()) {
        callback({
          authorized: false,
          reason: "user-not-found",
          user
        });
        return;
      }

      const userData = userSnap.data();

      if (userData.role !== "admin") {
        callback({
          authorized: false,
          reason: "access-denied",
          user,
          userData
        });
        return;
      }

      callback({
        authorized: true,
        user,
        userData
      });

    } catch (error) {
      callback({
        authorized: false,
        reason: "error",
        user,
        error
      });
    }

  });

}
