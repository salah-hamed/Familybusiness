import auth from "../firebase/firebase-auth.js";
import db from "../firebase/firebase-db.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// Register
export async function registerUser(name, email, password, referredByUserId = "") {

  try {

    const normalizedName = String(name || "").trim();
    const normalizedEmail = String(email || "").trim();

    if (!normalizedName || normalizedName.length > 100) {
      return { success: false, error: "INVALID_NAME" };
    }

    if (!normalizedEmail || normalizedEmail.length > 254) {
      return { success: false, error: "INVALID_EMAIL" };
    }

    const userCredential =
      await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password
      );

    const user = userCredential.user;
    const normalizedReferralId = /^[A-Za-z0-9_-]{1,128}$/.test(String(referredByUserId || ""))
      ? String(referredByUserId)
      : "";

    // Save user in Firestore
    await setDoc(doc(db, "users", user.uid), {

      uid: user.uid,
      name: normalizedName,
      email: normalizedEmail,
      projectType: "",
      isActive: false,
      subscriptionStatus: "pending",
      initialActivationPaid: false,
      billingCycle: "initial",
      referredByUserId: normalizedReferralId && normalizedReferralId !== user.uid ? normalizedReferralId : "",
      referralQualified: false,
      createdAt: serverTimestamp()

    });

    return {
      success: true,
      user
    };

  } catch(error) {

    return {
      success: false,
      error: error.message
    };

  }

}


// Login
export async function loginUser(email, password) {

  try {

    const userCredential =
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    return {
      success: true,
      user: userCredential.user
    };

  } catch(error) {

    return {
      success: false,
      error: error.message
    };

  }

}


// Logout
export async function logoutUser() {

  await signOut(auth);

}


// Current User
export function observeAuth(callback) {

  onAuthStateChanged(auth, callback);

        }
