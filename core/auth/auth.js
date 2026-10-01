import auth from "../firebase/firebase-auth.js";
import db from "../firebase/firebase-db.js";
import { friendlyAuthError } from "./auth-errors.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
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
      return { success: false, error: "اكتب اسمًا صحيحًا لا يزيد عن 100 حرف." };
    }

    if (!normalizedEmail || normalizedEmail.length > 254) {
      return { success: false, error: "راجع البريد الإلكتروني وتأكد أنه مكتوب بشكل صحيح." };
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
      error: friendlyAuthError(error, "تعذر إنشاء الحساب. راجع البيانات وحاول مرة أخرى.")
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
      error: friendlyAuthError(error, "تعذر تسجيل الدخول. حاول مرة أخرى.")
    };

  }

}

export async function requestPasswordReset(email) {
  const normalizedEmail = String(email || "").trim();

  if (!normalizedEmail || normalizedEmail.length > 254 || !normalizedEmail.includes("@")) {
    return {
      success: false,
      error: "راجع البريد الإلكتروني وتأكد أنه مكتوب بشكل صحيح."
    };
  }

  try {
    await sendPasswordResetEmail(auth, normalizedEmail);

    return {
      success: true,
      message: "لو البريد مسجل عندنا، هيوصلك رابط لتغيير كلمة المرور. راجع صندوق الوارد والرسائل غير المرغوب فيها."
    };
  } catch (error) {
    const code = String(error?.code || "").toLowerCase();

    if (code.includes("auth/user-not-found")) {
      return {
        success: true,
        message: "لو البريد مسجل عندنا، هيوصلك رابط لتغيير كلمة المرور. راجع صندوق الوارد والرسائل غير المرغوب فيها."
      };
    }

    return {
      success: false,
      error: friendlyAuthError(error, "تعذر إرسال رابط استعادة كلمة المرور. حاول مرة أخرى بعد قليل.")
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
