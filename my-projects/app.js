import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  getDocs
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

  container.innerHTML = `
<h2>مرحباً ${data.name}</h2>

<p>
ترخيص المنصة:
<b style="color:green;">
${data.isActive ? "مفعل" : "غير مفعل"}
</b>
</p>

<hr>

<div id="projectsList">

جاري تحميل المشاريع...

</div>
`;
const projectsList =
document.getElementById("projectsList");

const templates =
await getDocs(collection(db, "templates"));

projectsList.innerHTML = "";

templates.forEach((templateDoc) => {

  const template = templateDoc.data();
const templateId = templateDoc.id;

  if (!template.active) return;

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

${template.description}

</p>

<button
class="manageProjectBtn"
data-link="${template.dashboard}"
>
إدارة المشروع
</button>
</div>
`;

});
  document.querySelectorAll(".manageProjectBtn")
.forEach((btn) => {

  btn.onclick = () => {

    window.location.href =
      btn.dataset.link;

  };

});
});
