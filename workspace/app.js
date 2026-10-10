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
  buildWhatsAppProofMessage,
  buildWhatsAppProofUrl,
  getLatestSubscriptionPayment,
  paymentStatusCopy,
  prepareSubscriptionPaymentWhatsApp,
  requiredSubscriptionPayment
} from "../core/subscriptions/payment-service.js";
import { createGuide } from "../core/onboarding/guide.js";
import { buildWorkspaceGuide } from "../core/onboarding/guide-state.js";
import { getProjectCommissionSummary, subscribeLatestUserCommission, subscribeProjectPaymentState } from "../core/commissions/earnings-service.js?v=20261010-commission1";
const userName =
document.getElementById("userName");

const subscriptionStatus =
document.getElementById("subscriptionStatus");
const templatesContainer =
document.getElementById("templatesContainer");
const referralLink = document.getElementById("referralLink");
const copyReferralBtn = document.getElementById("copyReferralBtn");
const shareReferralWhatsappBtn = document.getElementById("shareReferralWhatsappBtn");
const referralStatus = document.getElementById("referralStatus");
const logoutBtn = document.getElementById("logoutBtn");
const projectCount = document.getElementById("projectCount");
const workspaceAccountState = document.getElementById("workspaceAccountState");
const subscriptionHint = document.getElementById("subscriptionHint");
const subscriptionPaymentPanel = document.getElementById("subscriptionPaymentPanel");
const payWithInstapayBtn = document.getElementById("payWithInstapayBtn");
const paymentRequiredText = document.getElementById("paymentRequiredText");
const paymentAmount = document.getElementById("paymentAmount");
const paymentBadge = document.getElementById("paymentBadge");
const paymentReference = document.getElementById("paymentReference");
const submitPaymentProofBtn = document.getElementById("submitPaymentProofBtn");
const reopenPaymentWhatsappBtn = document.getElementById("reopenPaymentWhatsappBtn");
const paymentReviewStatus = document.getElementById("paymentReviewStatus");
const paymentForm = document.getElementById("paymentForm");
let stopWorkspaceLatestCommission=()=>{};
let stopWorkspacePaymentStates=[];
let workspaceFinanceProjectIds=new Set();
let workspaceFinanceUserId="";

function workspaceCommissionNode(projectDocId){
  return [...document.querySelectorAll("[data-project-commission]")]
    .find(node=>node.dataset.projectCommission===projectDocId)||null;
}

function renderWorkspaceCommission(projectDocId,summary){
  const node=workspaceCommissionNode(projectDocId);
  if(!node)return;
  node.querySelector("[data-earned]").innerText=formatEgp(summary.earnedAmount);
  node.querySelector("[data-due]").innerText=formatEgp(summary.outstandingAmount);
  node.querySelector("[data-count]").innerText=`${Number(summary.completedOrderCount||0).toLocaleString("ar-EG")} طلب محتسب`;
  node.classList.remove("loading");
}

async function refreshWorkspaceCommission(userId,projectDocId){
  const node=workspaceCommissionNode(projectDocId);
  if(!node)return;
  try{
    const summary=await getProjectCommissionSummary(userId,projectDocId);
    renderWorkspaceCommission(projectDocId,summary);
  }catch(error){
    console.error("Workspace commission refresh failed",error);
    node.querySelector("[data-earned]").innerText="—";
    node.querySelector("[data-due]").innerText="—";
    node.querySelector("[data-count]").innerText="تعذر تحديث العمولة";
    node.classList.remove("loading");
  }
}

function stopWorkspaceFinanceLive(){
  stopWorkspaceLatestCommission();
  stopWorkspaceLatestCommission=()=>{};
  stopWorkspacePaymentStates.forEach(stop=>stop());
  stopWorkspacePaymentStates=[];
  workspaceFinanceProjectIds=new Set();
  workspaceFinanceUserId="";
}

function startWorkspaceFinanceLive(user,projectDocIds){
  stopWorkspaceFinanceLive();
  const ids=[...new Set(projectDocIds.filter(Boolean))];
  workspaceFinanceProjectIds=new Set(ids);
  workspaceFinanceUserId=user.uid;
  if(!ids.length)return;

  let latestReady=false;
  stopWorkspaceLatestCommission=subscribeLatestUserCommission(
    user.uid,
    entry=>{
      if(!latestReady){latestReady=true;return;}
      if(entry?.sourceType==="project_order"&&workspaceFinanceProjectIds.has(entry.projectId)){
        refreshWorkspaceCommission(user.uid,entry.projectId);
      }
    },
    error=>console.error("Workspace commission live update failed",error)
  );

  stopWorkspacePaymentStates=ids.map(projectDocId=>{
    let paymentReady=false;
    return subscribeProjectPaymentState(
      projectDocId,
      ()=>{
        if(!paymentReady)paymentReady=true;
        refreshWorkspaceCommission(user.uid,projectDocId);
      },
      error=>console.error("Workspace payment-state live update failed",error)
    );
  });
}

window.addEventListener("pagehide",stopWorkspaceFinanceLive);
document.addEventListener("visibilitychange",()=>{
  if(document.hidden||!workspaceFinanceUserId)return;
  workspaceFinanceProjectIds.forEach(projectDocId=>{
    refreshWorkspaceCommission(workspaceFinanceUserId,projectDocId);
  });
});


function paymentErrorMessage(error) {
  const message = String(error?.message || "");
  if (message === "PAYMENT_ALREADY_PENDING") {
    return "عندك إثبات دفع بانتظار المراجعة بالفعل.";
  }
  if (message === "INVALID_PAYMENT_REFERENCE") {
    return "راجع مرجع عملية InstaPay واكتبه كما يظهر في التحويل.";
  }
  return "تعذر تسجيل الدفعة أو فتح واتساب. تأكد من الإنترنت وحاول مرة أخرى.";
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

  const instapayPaymentUrl = String(PLATFORM_BILLING.instapayPaymentUrl || "").trim();
  const paymentConfigReady = Boolean(
    instapayPaymentUrl
    && PLATFORM_BILLING.paymentWhatsapp
  );

  if (payWithInstapayBtn) {
    payWithInstapayBtn.href = instapayPaymentUrl || "#";
    payWithInstapayBtn.classList.toggle("disabled", !instapayPaymentUrl);
    payWithInstapayBtn.setAttribute("aria-disabled", instapayPaymentUrl ? "false" : "true");
    payWithInstapayBtn.onclick = event => {
      if (!instapayPaymentUrl) {
        event.preventDefault();
        paymentReviewStatus.innerText = "رابط الدفع عبر InstaPay غير مضبوط بعد.";
        return;
      }
      paymentReviewStatus.innerText = "بعد إتمام التحويل ارجع للصفحة واكتب مرجع العملية كما يظهر في InstaPay.";
    };
  }

  let latest = null;
  try {
    latest = await getLatestSubscriptionPayment(user.uid);
  } catch (error) {
    console.error(error);
    paymentReviewStatus.innerText = String(error?.code || "").includes("failed-precondition")
      ? "سجل الدفع يحتاج نشر Firestore Index النهائي قبل استخدامه Live."
      : "تعذر تحميل حالة آخر دفعة.";
  }

  const pending = latest?.status === "pending_review";
  paymentForm.classList.toggle("hidden", pending);
  reopenPaymentWhatsappBtn.classList.toggle("hidden", !pending);
  paymentBadge.className = `paymentBadge ${latest?.status || ""}`;
  paymentBadge.innerText = pending
    ? "قيد المراجعة"
    : latest?.status === "rejected"
      ? "يحتاج إثبات جديد"
      : "بانتظار الدفع";

  paymentReviewStatus.innerText = paymentStatusCopy(latest)
    || (paymentConfigReady
      ? "بعد التحويل اكتب مرجع العملية. سنجهز لك رسالة واتساب فيها كود الدفع، وأنت أرفق Screenshot التحويل ثم أرسلها."
      : "يجب ضبط رابط InstaPay ورقم واتساب الدفع للمنصة قبل استقبال دفعات حقيقية.");

  function openWhatsappForPayment(payment) {
    const message = buildWhatsAppProofMessage({
      paymentCode: payment.paymentCode,
      paymentType: payment.paymentType,
      amount: payment.amount,
      currency: payment.currency,
      paymentReference: payment.paymentReference,
      userEmail: user.email || ""
    });
    const url = buildWhatsAppProofUrl(PLATFORM_BILLING.paymentWhatsapp, message);
    if (!url) {
      paymentReviewStatus.innerText = "رقم واتساب الدفع غير مضبوط بعد.";
      return;
    }
    window.location.href = url;
  }

  reopenPaymentWhatsappBtn.onclick = () => {
    if (latest) openWhatsappForPayment(latest);
  };

  submitPaymentProofBtn.disabled = !paymentConfigReady;

  submitPaymentProofBtn.onclick = async () => {
    if (!paymentConfigReady) return;

    submitPaymentProofBtn.disabled = true;
    paymentReviewStatus.innerText = "جاري تسجيل الدفعة وتجهيز رسالة واتساب...";

    try {
      const result = await prepareSubscriptionPaymentWhatsApp({
        user,
        userData,
        paymentReference: paymentReference.value
      });

      latest = {
        ...result,
        userId: user.uid,
        userEmail: user.email || ""
      };

      paymentForm.classList.add("hidden");
      reopenPaymentWhatsappBtn.classList.remove("hidden");
      paymentBadge.className = "paymentBadge pending";
      paymentBadge.innerText = "قيد المراجعة";
      paymentReviewStatus.innerText = paymentStatusCopy(latest);
      openWhatsappForPayment(latest);
    } catch (error) {
      console.error(error);
      paymentReviewStatus.innerText = paymentErrorMessage(error);
      submitPaymentProofBtn.disabled = !paymentConfigReady;
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
      const referralUrl = new URL("../home/", window.location.href);
      referralUrl.search = "";
      referralUrl.hash = "";
      referralUrl.searchParams.set("ref", user.uid);
      referralLink.value = referralUrl.toString();
    }

    if (copyReferralBtn) {
      copyReferralBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(referralLink.value);
          referralStatus.innerText = `تم نسخ الرابط — كل تفعيل مدفوع مؤهل من لينكك يضيف ${formatEgp(REFERRAL_CONFIG.qualifiedReferralReward)} عمولة إحالة`;
        } catch {
          referralLink.select();
          document.execCommand("copy");
          referralStatus.innerText = "تم نسخ رابط الإحالة";
        }
      };
    }
    if (shareReferralWhatsappBtn) {
      shareReferralWhatsappBtn.onclick = () => {
        const message = [
          "شوفت Family Business؟",
          "منصة بتخليك تربط نفسك بسوبرماركت ومطعم ومخبز ومغسلة شغالين بالفعل، وتتابع عمولتك على الطلبات من موبايلك.",
          "",
          "ادخل شوف الفكرة بالتفصيل من هنا:",
          referralLink.value
        ].join("\n");
        window.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
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

        ${created ? `
          <div class="projectCommissionMini loading" data-project-commission="${projectDocId}">
            <div><span>إجمالي العمولة</span><strong data-earned>جاري التحديث...</strong></div>
            <div><span>المستحق لك</span><strong data-due>جاري التحديث...</strong></div>
            <small data-count>جاري حساب الطلبات...</small>
          </div>
        ` : ""}

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
    const visibleProjectDocIds = myProjects
      .map(item => item.projectDocId)
      .filter(projectDocId => workspaceCommissionNode(projectDocId));
    startWorkspaceFinanceLive(user, visibleProjectDocIds);

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
        : "حوّل عبر InstaPay ثم سجّل مرجع العملية وابعت Screenshot التحويل على واتساب. بعد المراجعة سيتفعل الحساب.";
    }

    await renderSubscriptionPayment(user, data, subscriptionActive);

  }

  catch(error){

    console.error(error);

    userName.innerText =
    "حدث خطأ أثناء تحميل البيانات";

  }

});
