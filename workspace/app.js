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
import {
  getProjectDocId
} from "../core/projects/project-service.js";
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
    const subscriptionActive =
      data.isActive === true &&
      data.subscriptionStatus === "active";
    const myProjects = await loadUserProjects(user.uid);

const myProjectIds = myProjects.map(project => project.projectId);
templatesContainer.innerHTML = "";

projects.forEach(project => {

  const existingProject =
    myProjects.find(item => item.projectId === project.id);
  const created = myProjectIds.includes(project.id);
  const projectDocId =
    existingProject?.projectDocId ||
    getProjectDocId(user.uid, project.id);
  const available = project.active === true;
  const disabled = !subscriptionActive || !available;

  templatesContainer.innerHTML += `

    <div class="projectCard ${available ? "" : "comingSoon"}">

      <div class="projectIcon">
        ${project.icon}
      </div>

      <div class="projectInfo">

        <h3>${project.title}</h3>

        ${available ? "" : '<div class="comingSoonBadge">قريبًا</div>'}

        <button
          class="projectBtn"
          data-template-id="${project.id}"
          data-project-doc-id="${projectDocId}"
          data-available="${available}"
          ${disabled ? "disabled" : ""}>

          ${
            !available
              ? "قريبًا"
              : subscriptionActive
                ? (created ? "إدارة المشروع" : "إنشاء المشروع")
                : "الاشتراك غير مفعل"
          }

        </button>

      </div>

    </div>

  `;

});
    document.querySelectorAll(".projectBtn").forEach(btn => {

  btn.onclick = async () => {

    if (!subscriptionActive || btn.dataset.available !== "true") return;

    const templateId = btn.dataset.templateId;
    let projectDocId = btn.dataset.projectDocId;

    if (btn.innerText.trim() === "إدارة المشروع") {

      window.location.href =
        `../dashboard/?project=${encodeURIComponent(projectDocId)}`;

      return;

    }

    const project =
      projects.find(p => p.id === templateId && p.active === true);

    if (!project) return;

    try {
      projectDocId = await createProject(user.uid, project);
    } catch (error) {
      subscriptionStatus.innerText =
        error.message === "SUBSCRIPTION_NOT_ACTIVE"
          ? "⏳ يجب تفعيل الاشتراك أولاً"
          : "حدث خطأ أثناء إنشاء المشروع";
      return;
    }

    btn.dataset.projectDocId = projectDocId;
    btn.innerText = "إدارة المشروع";

  };

});
    userName.innerText =
    `أهلاً ${data.name}`;

    subscriptionStatus.innerText =
    subscriptionActive
    ? "✅ الاشتراك مفعل"
    : "⏳ الاشتراك قيد المراجعة أو غير مفعل";

  }

  catch(error){

    console.error(error);

    userName.innerText =
    "حدث خطأ أثناء تحميل البيانات";

  }

});
