import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { getDiscoverableProjects } from "../templates/projects.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const container =
  document.getElementById("projectsContainer");

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "/Familybusiness/login/";
    return;
  }

  const snap =
    await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) {
    container.innerHTML = "المستخدم غير موجود";
    return;
  }

  const data = snap.data();
  const templates = getDiscoverableProjects();

  container.innerHTML = `
    <h2>مرحباً ${data.name}</h2>

    <p>
      ترخيص المنصة:
      <b style="color:${data.isActive ? "green" : "#b45309"};">
        ${data.isActive ? "مفعل" : "غير مفعل"}
      </b>
    </p>

    <hr>

    <div id="projectsList"></div>
  `;

  const projectsList =
    document.getElementById("projectsList");

  templates.forEach((template) => {

    const readyToStart = template.creationEnabled === true;

    projectsList.innerHTML += `
      <div style="
        border:1px solid #ddd;
        padding:15px;
        margin:15px 0;
        border-radius:12px;
      ">
        <h3>
          ${template.icon}
          ${template.title}
        </h3>

        <p>
          ${template.description || ""}
        </p>

        <small>
          ${template.operatingModel === "partner_operated" ? "تشغيل بالشراكة" : "تشغيل مباشر"}
        </small>

        <div style="margin-top:12px;">
          <a
            href="${readyToStart ? "../workspace/" : "#"}"
            style="${readyToStart ? "" : "pointer-events:none;opacity:.55;"}"
          >
            ${readyToStart ? "فتح مساحة العمل" : "قريبًا للتشغيل"}
          </a>
        </div>
      </div>
    `;

  });

});
