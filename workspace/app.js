import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import projects, { canCreateTemplate, getDiscoverableProjects } from "../templates/projects.js";
import {
  createProject,
  loadUserProjects
} from "../templates/engine/project-engine.js";
import {
  getProjectDocId
} from "../core/projects/project-service.js";
import { REFERRAL_CONFIG, formatEgp } from "../core/config/platform-config.js";
import { isSubscriptionActive, subscriptionExpiryDate } from "../core/subscriptions/subscription-service.js";
const userName =
document.getElementById("userName");

const subscriptionStatus =
document.getElementById("subscriptionStatus");
const templatesContainer =
document.getElementById("templatesContainer");
const referralLink = document.getElementById("referralLink");
const copyReferralBtn = document.getElementById("copyReferralBtn");
const referralStatus = document.getElementById("referralStatus");
function projectManagementUrl(templateId, projectDocId) {
  if (templateId === "supermarket") {
    return `../supermarket/?project=${encodeURIComponent(projectDocId)}`;
  }
  if (templateId === "laundry") {
    return `../laundry/?project=${encodeURIComponent(projectDocId)}`;
  }
  return `../dashboard/?project=${encodeURIComponent(projectDocId)}`;
}

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
    const subscriptionActive = isSubscriptionActive(data);
    const myProjects = await loadUserProjects(user.uid);

    if (referralLink) {
      const referralUrl = new URL("../", window.location.href);
      referralUrl.search = "";
      referralUrl.hash = "";
      referralUrl.searchParams.set("ref", user.uid);
      referralLink.value = referralUrl.toString();
    }

    if (copyReferralBtn) {
      copyReferralBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(referralLink.value);
          referralStatus.innerText = `تم نسخ الرابط — عمولة الإحالة المؤهلة ${formatEgp(REFERRAL_CONFIG.qualifiedReferralReward)}`;
        } catch {
          referralLink.select();
          document.execCommand("copy");
          referralStatus.innerText = "تم نسخ رابط الإحالة";
        }
      };
    }

const myProjectIds = myProjects.map(project => project.projectId);
templatesContainer.innerHTML = "";

getDiscoverableProjects().forEach(project => {

  const existingProject =
    myProjects.find(item => item.projectId === project.id);
  const created = myProjectIds.includes(project.id);
  const projectDocId =
    existingProject?.projectDocId ||
    getProjectDocId(user.uid, project.id);
  const available = project.status === "active" && project.visibility === "public";
  const creationEnabled = canCreateTemplate(project);
  const disabled = !subscriptionActive || !available || (!created && !creationEnabled);

  templatesContainer.innerHTML += `

    <div class="projectCard ${available ? "" : "comingSoon"}">

      <div class="projectIcon">
        ${project.icon}
      </div>

      <div class="projectInfo">

        <h3>${project.title}</h3>

        ${!creationEnabled && !created ? '<div class="comingSoonBadge">قريبًا للتشغيل</div>' : ""}

        <button
          class="projectBtn"
          data-template-id="${project.id}"
          data-project-doc-id="${projectDocId}"
          data-available="${available}"
          ${disabled ? "disabled" : ""}>

          ${
            !subscriptionActive
              ? "الاشتراك غير مفعل"
              : created
                ? "إدارة المشروع"
                : creationEnabled
                  ? "إنشاء المشروع"
                  : "قريبًا للتشغيل"
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
        projectManagementUrl(templateId, projectDocId);

      return;

    }

    const project =
      projects.find(p => p.id === templateId && canCreateTemplate(p));

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

    const expiry = subscriptionExpiryDate(data);
    subscriptionStatus.innerText = subscriptionActive
      ? `✅ الاشتراك مفعل${expiry ? ` حتى ${expiry.toLocaleDateString("ar-EG")}` : ""}`
      : "⏳ الاشتراك قيد المراجعة أو غير مفعل";

  }

  catch(error){

    console.error(error);

    userName.innerText =
    "حدث خطأ أثناء تحميل البيانات";

  }

});
