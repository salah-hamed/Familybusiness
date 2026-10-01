import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";
import { logoutUser } from "../core/auth/auth.js";

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
import { PLATFORM_BILLING, REFERRAL_CONFIG, formatEgp } from "../core/config/platform-config.js";
import { isSubscriptionActive, subscriptionExpiryDate } from "../core/subscriptions/subscription-service.js";
import {
  getLatestSubscriptionPayment,
  paymentStatusCopy,
  requiredSubscriptionPayment,
  submitSubscriptionPaymentProof
} from "../core/subscriptions/payment-service.js";
import { createGuide } from "../core/onboarding/guide.js";
import { buildWorkspaceGuide } from "../core/onboarding/guide-state.js";
const userName =
document.getElementById("userName");

const subscriptionStatus =
document.getElementById("subscriptionStatus");
const templatesContainer =
document.getElementById("templatesContainer");
const referralLink = document.getElementById("referralLink");
const copyReferralBtn = document.getElementById("copyReferralBtn");
const referralStatus = document.getElementById("referralStatus");
const logoutBtn = document.getElementById("logoutBtn");
const projectCount = document.getElementById("projectCount");
const workspaceAccountState = document.getElementById("workspaceAccountState");
const subscriptionHint = document.getElementById("subscriptionHint");
const subscriptionPaymentPanel = document.getElementById("subscriptionPaymentPanel");
const platformInstapayAccount = document.getElementById("platformInstapayAccount");
const paymentRequiredText = document.getElementById("paymentRequiredText");
const paymentAmount = document.getElementById("paymentAmount");
const paymentBadge = document.getElementById("paymentBadge");
const paymentReference = document.getElementById("paymentReference");
const paymentProofFile = document.getElementById("paymentProofFile");
const submitPaymentProofBtn = document.getElementById("submitPaymentProofBtn");
const paymentReviewStatus = document.getElementById("paymentReviewStatus");
const paymentForm = document.getElementById("paymentForm");

function paymentErrorMessage(error) {
  const message = String(error?.message || "");
  if (message === "PAYMENT_ALREADY_PENDING") {
    return "عندك إثبات دفع بانتظار المراجعة بالفعل.";
  }
  if (message === "INVALID_PAYMENT_REFERENCE") {
    return "راجع مرجع عملية InstaPay واكتبه كما يظهر في التحويل.";
  }
  if (message.startsWith("ارفع ") || message.startsWith("صيغة ") || message.startsWith("حجم ") || message.startsWith("ملف ")) {
    return message;
  }
  if (String(error?.code || "").includes("storage/unauthorized")) {
    return "تعذر رفع الإثبات حاليًا بسبب صلاحيات التخزين. حاول بعد تحديث إعدادات المنصة.";
  }
  return "تعذر إرسال إثبات الدفع. تأكد من الإنترنت وحاول مرة أخرى.";
}

async function renderSubscriptionPayment(user, userData, subscriptionActive) {
  if (!subscriptionPaymentPanel) return;

  subscriptionPaymentPanel.classList.toggle("hidden", subscriptionActive);
  if (subscriptionActive) return;

  const required = requiredSubscriptionPayment(userData);
  paymentAmount.innerText = formatEgp(required.amount);
  paymentRequiredText.innerText = required.paymentType === "initial"
    ? "أول تفعيل للحساب. بعد اعتماد الدفعة تقدر تشغّل المشاريع الأربعة."
    : "تجديد الاشتراك الشهري لإعادة تشغيل المشاريع.";
  platformInstapayAccount.innerText = PLATFORM_BILLING.instapayAccount || "لم يتم ضبط حساب التحويل بعد";
  submitPaymentProofBtn.disabled = !PLATFORM_BILLING.instapayAccount;

  let latest = null;
  try {
    latest = await getLatestSubscriptionPayment(user.uid);
  } catch (error) {
    console.error(error);
    paymentReviewStatus.innerText = String(error?.code || "").includes("failed-precondition")
      ? "سجل الدفع يحتاج نشر Firestore Index النهائي قبل استخدامه Live."
      : "تعذر تحميل حالة آخر إثبات دفع.";
  }

  const pending = latest?.status === "pending_review";
  paymentForm.classList.toggle("hidden", pending);
  paymentBadge.className = `paymentBadge ${latest?.status || ""}`;
  paymentBadge.innerText = pending
    ? "قيد المراجعة"
    : latest?.status === "rejected"
      ? "يحتاج إثبات جديد"
      : "بانتظار الدفع";
  paymentReviewStatus.innerText = paymentStatusCopy(latest)
    || (PLATFORM_BILLING.instapayAccount
      ? "بعد التحويل اكتب مرجع العملية وارفع صورة الإثبات للمراجعة."
      : "يجب ضبط حساب InstaPay للمنصة قبل استقبال دفعات حقيقية.");

  submitPaymentProofBtn.onclick = async () => {
    submitPaymentProofBtn.disabled = true;
    paymentReviewStatus.innerText = "جاري رفع الإثبات وتسجيل الدفعة...";
    try {
      await submitSubscriptionPaymentProof({
        user,
        userData,
        paymentReference: paymentReference.value,
        proofFile: paymentProofFile.files?.[0]
      });
      paymentForm.classList.add("hidden");
      paymentBadge.className = "paymentBadge pending";
      paymentBadge.innerText = "قيد المراجعة";
      paymentReviewStatus.innerText = "تم استلام إثبات التحويل وهو الآن بانتظار مراجعة الإدارة.";
    } catch (error) {
      console.error(error);
      paymentReviewStatus.innerText = paymentErrorMessage(error);
      submitPaymentProofBtn.disabled = !PLATFORM_BILLING.instapayAccount;
    }
  };
}

const projectCopy = {
  supermarket: "حوّل سوبرماركت شغال بالفعل لقناة طلبات أونلاين وتابع عمولتك على الأوردرات المكتملة.",
  restaurant: "اربط مطعم قائم عنده زباينه ومنيوه، وخليه يستقبل الطلبات من تطبيق جاهز.",
  bakery: "اربط مخبز أو فرن قائم، وخليه يعرض منتجاته ويستقبل الطلبات من عملائه.",
  laundry: "اربط مغسلة شغالة بالفعل، وخليها تدير الاستلام والتشغيل والتوصيل من تطبيقها."
};

const projectClass = {
  supermarket: "project-supermarket",
  restaurant: "project-restaurant",
  bakery: "project-bakery",
  laundry: "project-laundry"
};

if (logoutBtn) {
  logoutBtn.onclick = async () => {
    logoutBtn.disabled = true;
    try {
      await logoutUser();
      window.location.href = "../";
    } finally {
      logoutBtn.disabled = false;
    }
  };
}
const guideController = createGuide(buildWorkspaceGuide({ loading: true }), { autoOpen: false });
function projectManagementUrl(templateId, projectDocId) {
  if (templateId === "supermarket") {
    return `../supermarket/?project=${encodeURIComponent(projectDocId)}`;
  }
  if (templateId === "laundry") {
    return `../laundry/?project=${encodeURIComponent(projectDocId)}`;
  }
  if (templateId === "restaurant") {
    return `../restaurant/?project=${encodeURIComponent(projectDocId)}`;
  }
  if (templateId === "bakery") {
    return `../bakery/?project=${encodeURIComponent(projectDocId)}`;
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

    guideController.update(
      buildWorkspaceGuide({ userData: data, projects: myProjects, subscriptionActive }),
      { autoOpen: true }
    );

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

    <article class="projectCard ${projectClass[project.id] || ""} ${available ? "" : "comingSoon"}">
      <div class="projectCardTop">
        <div class="projectIcon">${project.icon}</div>
        <span class="projectState">${created ? "مضاف لحسابك" : creationEnabled ? "جاهز للربط" : "قريبًا"}</span>
      </div>

      <div class="projectInfo">
        <h3>${project.title}</h3>
        <p>${projectCopy[project.id] || project.description || ""}</p>

        <button
          class="projectBtn"
          data-template-id="${project.id}"
          data-project-doc-id="${projectDocId}"
          data-created="${created}"
          data-available="${available}"
          ${disabled ? "disabled" : ""}>
          ${
            !subscriptionActive
              ? "فعّل الاشتراك أولاً"
              : created
                ? "افتح المشروع"
                : creationEnabled
                  ? "شغّل المشروع"
                  : "قريبًا للتشغيل"
          }
        </button>
      </div>
    </article>
  `;

});
    document.querySelectorAll(".projectBtn").forEach(btn => {

  btn.onclick = async () => {

    if (!subscriptionActive || btn.dataset.available !== "true") return;

    const templateId = btn.dataset.templateId;
    let projectDocId = btn.dataset.projectDocId;

    if (btn.dataset.created === "true") {

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
    btn.dataset.created = "true";
    window.location.href = projectManagementUrl(templateId, projectDocId);

  };

});
    userName.innerText = `أهلاً ${data.name} 👋`;
    if (projectCount) projectCount.innerText = `${myProjects.length} / 4`;
    if (workspaceAccountState) workspaceAccountState.innerText = subscriptionActive ? "جاهز للتشغيل" : "بانتظار التفعيل";

    const expiry = subscriptionExpiryDate(data);
    subscriptionStatus.innerText = subscriptionActive
      ? `✅ الاشتراك مفعل${expiry ? ` حتى ${expiry.toLocaleDateString("ar-EG")}` : ""}`
      : "⏳ الاشتراك قيد المراجعة أو غير مفعل";

    if (subscriptionHint) {
      subscriptionHint.innerText = subscriptionActive
        ? "أداتك جاهزة. اختار مشروع من تحت وابدأ ربط أول نشاط شغال حواليك."
        : "ارفع إثبات التحويل من بطاقة الدفع أسفل حالة الاشتراك. بعد المراجعة سيتفعل الحساب.";
    }

    await renderSubscriptionPayment(user, data, subscriptionActive);

  }

  catch(error){

    console.error(error);

    userName.innerText =
    "حدث خطأ أثناء تحميل البيانات";

  }

});
