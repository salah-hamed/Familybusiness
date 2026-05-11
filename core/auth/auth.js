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
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// Register
export async function registerUser(name, email, password) {

  try {

    const userCredential =
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

    const user = userCredential.user;

    // Save user in Firestore
    await setDoc(doc(db, "users", user.uid), {

      uid: user.uid,
      name: name,
      email: email,
      projectType: "",
      isActive: false,
      createdAt: new Date()

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
