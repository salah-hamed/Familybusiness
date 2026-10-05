import auth from "../firebase/firebase-auth.js";
import db from "../firebase/firebase-db.js";

import {
  onAuthStateChanged,
  browserSessionPersistence,
  setPersistence,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ADMIN_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
let idleGuardInstalled = false;
let idleTimer = null;

function installAdminIdleGuard() {
  if (idleGuardInstalled) return;
  idleGuardInstalled = true;

  const expire = async () => {
    try { await signOut(auth); } catch {}
    window.location.replace("/Familybusiness/");
  };

  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(expire, ADMIN_IDLE_TIMEOUT_MS);
  };

  ["pointerdown","keydown","touchstart","scroll"].forEach(eventName => {
    window.addEventListener(eventName, reset, { passive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reset();
  });
  reset();
}

export function protectAdmin(callback) {

  onAuthStateChanged(auth, async (user) => {

    if (!user) {
      window.location.href = "/Familybusiness/";
      return;
    }

    try {
      await setPersistence(auth, browserSessionPersistence);
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

      installAdminIdleGuard();
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
