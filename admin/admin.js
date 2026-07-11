import db from "../core/firebase/firebase-db.js";

import {
  collection,
  getDocs,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const usersContainer =
  document.getElementById("usersContainer");

loadUsers();

async function loadUsers() {

  const snapshot =
    await getDocs(collection(db, "users"));

  usersContainer.innerHTML = "";

  snapshot.forEach((userDoc) => {

    const data = userDoc.data();

    const card = document.createElement("div");

    card.style.border = "1px solid #ddd";
    card.style.padding = "10px";
    card.style.margin = "10px 0";

    card.innerHTML = `

      <p><b>${data.name}</b></p>
      <p>${data.email}</p>
      <p>Active: ${data.isActive}</p>

      <select id="project-${data.uid}">
        <option value="cleaning">cleaning</option>
        <option value="coffee">coffee</option>
        <option value="gas">gas</option>
        <option value="services">services</option>
        <option value="carwash">carwash</option>
      </select>

      <br><br>

      <button id="activate-${data.uid}">
  Activate
</button>

<button id="deactivate-${data.uid}">
  Deactivate
</button>

    `;

    usersContainer.appendChild(card);

    setTimeout(() => {

      document
        .getElementById(`activate-${data.uid}`)
        .addEventListener("click", async () => {

          const selectedProject =
            document.getElementById(`project-${data.uid}`).value;

          await updateDoc(
  doc(db, "users", data.uid),
  {
    isActive: true,

    projectType: selectedProject,

    projects: [selectedProject],

    subscriptionStatus: "active",

    activatedAt: new Date()
  }
);

          alert("Updated Successfully");

          loadUsers();

        });
document
  .getElementById(`deactivate-${data.uid}`)
  .addEventListener("click", async () => {

    await updateDoc(
      doc(db, "users", data.uid),
      {
        isActive: false,
        subscriptionStatus: "inactive"
      }
    );

    alert("User Deactivated");

    loadUsers();

  });
    }, 100);

  });

}
