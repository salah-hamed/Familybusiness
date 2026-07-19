import db from "../core/firebase/firebase-db.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const usersContainer =
  document.getElementById("usersContainer");

loadUsers();

async function loadUsers() {

  const snapshot =
    await getDocs(collection(db, "users"));
document.getElementById("usersCount").innerText =
  `إجمالي المستخدمين: ${snapshot.size}`;
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
await updateUserProjects(data.uid, true);
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
await updateUserProjects(data.uid, false);
    alert("User Deactivated");

    loadUsers();

  });
    }, 100);

  });

}
async function updateUserProjects(userId, active) {

  const q = query(
    collection(db, "projects"),
    where("ownerId", "==", userId)
  );

  const snapshot = await getDocs(q);

  for (const projectDoc of snapshot.docs) {

    await updateDoc(projectDoc.ref, {
      isActive: active,
      status: active ? "active" : "inactive"
    });

  }

}
