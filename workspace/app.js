import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import projects from "../templates/projects.js";
import {
  createProject,
  loadUserProjects
} from "../templates/engine/project-engine.js";
const userName =
document.getElementById("userName");

const subscriptionStatus =
document.getElementById("subscriptionStatus");
const templatesContainer =
document.getElementById("templatesContainer");
protectPage(async (user) => {

  try {

    const userRef =
    doc(db, "users", user.uid);

    const userSnap =
    await getDoc(userRef);

    if (!userSnap.exists()) {

      userName.innerText =
      "المستخدم غير موجود";

      return;

    }

    const data =
    userSnap.data();
    const myProjects = await loadUserProjects(user.uid);

const myProjectIds = myProjects.map(project => project.projectId);
templatesContainer.innerHTML = "";

projects.forEach(project => {

  const created = myProjectIds.includes(project.id);

  templatesContainer.innerHTML += `

    <div class="projectCard">

      <div class="projectIcon">
        ${project.icon}
      </div>

      <div class="projectInfo">

        <h3>${project.title}</h3>

        <button
          class="projectBtn"
          data-project="${project.id}">

          ${created ? "إدارة المشروع" : "إنشاء المشروع"}

        </button>

      </div>

    </div>

  `;

});
    document.querySelectorAll(".projectBtn").forEach(btn => {

  btn.onclick = async () => {

    const projectId = btn.dataset.project;

    if (btn.innerText.trim() === "إدارة المشروع") {

      window.location.href =
        `../dashboard/?project=${projectId}`;

      return;

    }

    const project =
      projects.find(p => p.id === projectId);

    await createProject(user.uid, project);

    btn.innerText = "إدارة المشروع";

  };

});
    userName.innerText =
    `أهلاً ${data.name}`;

    subscriptionStatus.innerText =
    data.isActive
    ? "✅ الاشتراك مفعل"
    : "⏳ الاشتراك قيد المراجعة";

  }

  catch(error){

    console.error(error);

    userName.innerText =
    "حدث خطأ أثناء تحميل البيانات";

  }

});
