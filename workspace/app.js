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
import {
  isSubscriptionActive,
  subscriptionExpiryDate,
  subscriptionAccessState,
  remainingWholeDays
} from "../core/subscriptions/subscription-service.js";
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

async function renderSubscriptionPayment(user, userData, accessState) {
  if (!subscriptionPaymentPanel) return;

  const networkV2 = userData.subscriptionModel === "network_v2";
  const state = accessState?.state || userData.subscriptionStatus || "inactive";
  const paymentDue = networkV2
    ? ["merchant_linked_payment_due","suspended_payment_due","expired"].includes(state)
    : !accessState?.hasAccess;

  subscriptionPaymentPanel.classList.toggle("hidden", !paymentDue);
  if (!paymentDue) return;

  const required = requiredSubscriptionPayment(userData);
  paymentAmount.innerText = formatEgp(required.amount);
  paymentRequiredText.innerText = networkV2
    ? (state === "merchant_linked_payment_due"
      ? "تم ربط أول مشروع ✅ سدّد أول اشتراك شهري خلال المهلة لاستمرار الإدارة."
      : "سدّد الاشتراك الشهري لإعادة تشغيل إدارة مشاريعك.")
    : (required.paymentType === "initial"
      ? "دفعة تفعيل قديمة لحساب تم إنشاؤه قبل نظام الاشتراك الجديد."
      : "تجديد الاشتراك الشهري لإعادة تشغيل المشاريع.");

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

  if (submitPaymentProofBtn) {
    submitPaymentProofBtn.disabled = !paymentConfigReady;
  }

  if (paymentForm) {
    paymentForm.classList.toggle("disabled", !paymentConfigReady);
  }

  const latest = await getLatestSubscriptionPayment(user.uid);

  if (latest) {
    paymentBadge.innerText = latest.status === "pending_review"
      ? "بانتظار المراجعة"
      : latest.status === "approved"
        ? "معتمد"
        : latest.status === "rejected"
          ? "مرفوض"
          : "جاهز للدفع";
    paymentReviewStatus.innerText = paymentStatusCopy(latest);
  } else {
    paymentBadge.innerText = "جاهز للدفع";
    paymentReviewStatus.innerText = "";
  }

  let lastPrepared = null;

  if (submitPaymentProofBtn) {
    submitPaymentProofBtn.onclick = async () => {
      submitPaymentProofBtn.disabled = true;
      paymentReviewStatus.innerText = "جاري تجهيز كود الدفع...";
      try {
        const prepared = await prepareSubscriptionPaymentWhatsApp({
          user,
          userData,
          paymentReference: paymentReference?.value
        });
        lastPrepared = prepared;

        const message = buildWhatsAppProofMessage({
          paymentCode: prepared.paymentCode,
          paymentType: prepared.paymentType,
          amount: prepared.amount,
          currency: prepared.currency,
          paymentReference: prepared.paymentReference,
          userEmail: user.email
        });
        const url = buildWhatsAppProofUrl(PLATFORM_BILLING.paymentWhatsapp, message);
        paymentBadge.innerText = "بانتظار المراجعة";
        paymentReviewStatus.innerText = paymentStatusCopy(prepared);

        if (url) window.open(url, "_blank", "noopener");
      } catch (error) {
        paymentReviewStatus.innerText = paymentErrorMessage(error);
      } finally {
        submitPaymentProofBtn.disabled = false;
      }
    };
  }

  if (reopenPaymentWhatsappBtn) {
    reopenPaymentWhatsappBtn.onclick = () => {
      const item = lastPrepared || latest;
      if (!item) {
        paymentReviewStatus.innerText = "سجّل الدفعة أولًا علشان نجهز رسالة واتساب.";
        return;
      }
      const message = buildWhatsAppProofMessage({
        paymentCode: item.paymentCode,
        paymentType: item.paymentType,
        amount: item.amount,
        currency: item.currency,
        paymentReference: item.paymentReference,
        userEmail: user.email
      });
      const url = buildWhatsAppProofUrl(PLATFORM_BILLING.paymentWhatsapp, message);
      if (url) window.open(url, "_blank", "noopener");
    };
  }
}

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
    const accessState = subscriptionAccessState(data);
    const subscriptionActive = accessState.hasAccess;
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
          ? "⛔ الحساب متوقف حسب مهلة الربط أو الاشتراك"
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
    const networkV2 = data.subscriptionModel === "network_v2";
    const daysLeft = remainingWholeDays(accessState.deadline);
    const expiry = subscriptionExpiryDate(data);

    if (workspaceAccountState) {
      workspaceAccountState.innerText = ({
        onboarding_active: "جاهز لربط أول مشروع",
        merchant_linked_payment_due: "المشروع مرتبط — الاشتراك مستحق",
        active_paid: "اشتراك نشط",
        suspended_no_merchant: "متوقف لعدم ربط مشروع",
        suspended_payment_due: "متوقف لعدم سداد الاشتراك",
        expired: "الاشتراك منتهي"
      })[accessState.state] || (subscriptionActive ? "جاهز للتشغيل" : "متوقف");
    }

    if (networkV2) {
      if (accessState.state === "onboarding_active") {
        subscriptionStatus.innerText = `✅ الحساب مفعل تلقائيًا — باقي ${daysLeft ?? "—"} يوم لربط أول مشروع`;
        if (subscriptionHint) subscriptionHint.innerText = "اربط أول محل حقيقي خلال 7 أيام. لا يوجد أي مبلغ مطلوب قبل نجاح الربط.";
      } else if (accessState.state === "merchant_linked_payment_due") {
        subscriptionStatus.innerText = `✅ تم ربط أول مشروع — باقي ${daysLeft ?? "—"} يوم لسداد أول اشتراك شهري`;
        if (subscriptionHint) subscriptionHint.innerText = `المطلوب الآن ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} اشتراك شهري. المشروع يظل محفوظًا على المنصة حتى لو توقف حسابك.`;
      } else if (accessState.state === "active_paid") {
        subscriptionStatus.innerText = `✅ الاشتراك نشط${expiry ? ` حتى ${expiry.toLocaleDateString("ar-EG")}` : ""}`;
        if (subscriptionHint) subscriptionHint.innerText = "حسابك نشط ومشاريعك مرتبطة بشبكة Family Business.";
      } else if (accessState.state === "suspended_no_merchant") {
        subscriptionStatus.innerText = "⛔ انتهت مهلة ربط أول مشروع";
        if (subscriptionHint) subscriptionHint.innerText = "تم إيقاف إدارة الحساب مؤقتًا. بياناتك محفوظة؛ تواصل مع الدعم لاستعادة مسار الربط.";
      } else {
        subscriptionStatus.innerText = "⛔ الاشتراك الشهري مستحق";
        if (subscriptionHint) subscriptionHint.innerText = "تم إيقاف إدارة الحساب مؤقتًا حتى اعتماد الاشتراك الشهري. بيانات المشاريع لا تُحذف.";
      }
    } else {
      subscriptionStatus.innerText = subscriptionActive
        ? `✅ الاشتراك مفعل${expiry ? ` حتى ${expiry.toLocaleDateString("ar-EG")}` : ""}`
        : "⏳ الحساب القديم غير نشط";
      if (subscriptionHint) {
        subscriptionHint.innerText = subscriptionActive
          ? "أداتك جاهزة. اختار مشروع من تحت وابدأ ربط أول نشاط شغال حواليك."
          : "هذا حساب قديم. راجع الاشتراك أو تواصل مع الدعم.";
      }
    }

    await renderSubscriptionPayment(user, data, accessState);

  }

  catch(error){

    console.error(error);

    userName.innerText =
    "حدث خطأ أثناء تحميل البيانات";

  }

});
