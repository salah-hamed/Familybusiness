import { protectPage } from "../core/auth/auth-guard.js";
import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";

import { logoutUser } from "../core/auth/auth.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
    projectType.innerText = "Project: " + (data.projectType || "Not selected");
    status.innerText = "Active: " + data.isActive;

  }

});

document
  .getElementById("logoutBtn")
  .addEventListener("click", async () => {

    await logoutUser();

    window.location.href = "/Familybusiness/";

  });
