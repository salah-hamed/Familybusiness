import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";
import { escapeHTML } from "../core/utils/helpers.js";
import { createOrResumeSupermarketSetup, getSupermarketProjectBundle } from "../core/supermarket/supermarket-service.js";
import { ensureOperatorInviteAccess, getOperatorInviteToken, rotateOperatorInviteAccess } from "../core/partners/partner-service.js";
import { normalizeWhatsAppPhone } from "../core/whatsapp/dispatch-service.js";
import { proposeCommission } from "../core/commissions/commission-service.js";
import { getProjectCommissionSummary, subscribeLatestUserCommission, subscribeProjectPaymentState } from "../core/commissions/earnings-service.js";
import { renderOwnerFinancePanel } from "../core/commissions/finance-panel.js";
import { createGuide } from "../core/onboarding/guide.js";
import { buildPartnerProjectGuide } from "../core/onboarding/guide-state.js";
import { renderCustomerQr } from "../core/qr/customer-qr.js?v=20261010-qr2";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const projectId = new URLSearchParams(location.search).get("project") || "";
let currentUser = null;
let currentProject = null;
let bundle = null;

const guideController = createGuide(
  buildPartnerProjectGuide({ templateId: "supermarket", bundle: null }),
  { autoOpen: false }
);

function money(value){return `${Number(value||0).toLocaleString("ar-EG")} جنيه`;}
function statusText(status){
  return ({accepted:"مقبول",pending:"بانتظار الموافقة",rejected:"مرفوض",not_proposed:"لم يبدأ"})[status] || status || "—";
}
async function copyValue(id){
  const value=$(id)?.value||"";
  if(!value)return;
  try{await navigator.clipboard.writeText(value);}catch{ $(id).select(); document.execCommand("copy"); }
}

document.querySelectorAll("[data-copy]").forEach(btn=>btn.onclick=()=>copyValue(btn.dataset.copy));

async function loadEarnings(){
  const summary=await getProjectCommissionSummary(currentUser.uid,projectId);
  $("completedOrders").innerText=summary.completedOrderCount;
  $("earnedCommission").innerText=money(summary.earnedAmount);
  $("paidCommission").innerText=money(summary.paidAmount);
  $("outstandingCommission").innerText=money(summary.outstandingAmount);
}

async function refreshOwnerFinance(){
  await loadEarnings();
  await renderOwnerFinancePanel({
    container:$("projectSection"),
    projectId,
    ownerId:currentUser.uid,
    onBalanceChanged:loadEarnings
  });
}

function scheduleOwnerFinanceRefresh(){
  clearTimeout(financeRefreshTimer);
  financeRefreshTimer=setTimeout(()=>{
    if(document.hidden||!currentUser)return;
    refreshOwnerFinance().catch(error=>console.error("Owner finance refresh failed",error));
  },120);
}

function startOwnerFinanceLiveRefresh(){
  stopLatestCommission();
  stopPaymentState();

  let latestReady=false;
  stopLatestCommission=subscribeLatestUserCommission(
    currentUser.uid,
    entry=>{
      if(!latestReady){latestReady=true;return;}
      if(entry?.sourceType==="project_order"&&entry.projectId===projectId){
        scheduleOwnerFinanceRefresh();
      }
    },
    error=>console.error("Commission live update failed",error)
  );

  let paymentReady=false;
  stopPaymentState=subscribeProjectPaymentState(
    projectId,
    ()=>{
      if(!paymentReady){paymentReady=true;return;}
      scheduleOwnerFinanceRefresh();
    },
    error=>console.error("Payment-state live update failed",error)
  );
}

function stopOwnerFinanceLiveRefresh(){
  clearTimeout(financeRefreshTimer);
  stopLatestCommission();
  stopPaymentState();
  stopLatestCommission=()=>{};
  stopPaymentState=()=>{};
}

window.addEventListener("pagehide",stopOwnerFinanceLiveRefresh);
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden&&currentUser)scheduleOwnerFinanceRefresh();
});

function render(){
  const {supermarket,operator,agreement}=bundle;
  const configured=Boolean(supermarket&&operator);
  guideController.update(buildPartnerProjectGuide({ templateId: "supermarket", bundle }), { autoOpen: true });

  $("setupSection").classList.toggle("hidden",configured);
  $("projectSection").classList.toggle("hidden",!configured);

  if(!configured){document.body.dataset.projectStage="setup";
    $("statusBanner").innerText="ابدأ بربط سوبرماركت واحد بالمشروع وتحديد العمولة المقترحة.";
    return;
  }

  const accepted=agreement?.status==="accepted" && agreement?.currentAmount!=null;
  const pending=agreement?.pendingStatus==="pending";
  document.body.dataset.projectStage=accepted&&operator.isActive?"live":"activate";

  $("statusBanner").innerText=accepted
    ?"المشروع مرتبط. السوبرماركت يقدر يدير التشغيل، وأنت تتابع العمولة والنتائج."
    :"المشروع في انتظار استكمال اتفاق العمولة مع السوبرماركت.";

  $("linkedStoreName").innerText=supermarket.name||operator.name||"السوبرماركت";
  $("operatorState").innerText=operator.isActive?"نشط":"بانتظار التفعيل";
  $("agreementStatus").innerText=pending
    ? `${statusText(agreement?.status)} · تعديل منتظر`
    : statusText(agreement?.status || operator.agreementStatus);
  $("currentCommission").innerText=accepted?money(agreement.currentAmount):"لم تُعتمد بعد";

  $("storeMeta").innerHTML=[
    ["المسؤول",supermarket.contactName||operator.contactName||"—"],
    ["الهاتف",supermarket.phone||operator.phone||"—"],
    ["واتساب المسؤول",operator.whatsapp||supermarket.whatsapp||"—"],
    ["مصاريف التوصيل",money(supermarket.deliveryFee||0)]
  ].map(([k,v])=>`<div class="metaItem"><b>${escapeHTML(k)}</b><div>${escapeHTML(v)}</div></div>`).join("");

  if(pending && agreement?.pendingAmount!=null){
    $("commissionMessage").innerText=`في انتظار موافقة السوبرماركت على ${money(agreement.pendingAmount)} لكل طلب يتم إرساله للتوصيل.`;
  } else {
    $("commissionMessage").innerText="";
  }

  const operatorUrl=new URL("../supermarket-operator/",location.href);
  operatorUrl.searchParams.set("project",projectId);
  const inviteToken=getOperatorInviteToken(operator);
  if(inviteToken)operatorUrl.searchParams.set("invite",inviteToken);
  $("operatorLink").value=operatorUrl.toString();
  $("sendOperatorWhatsappBtn").disabled=!(inviteToken&&(operator.whatsapp||operator.phone));

  const customerUrl=new URL("../templates/supermarket/",location.href);
  customerUrl.searchParams.set("project",projectId);
  $("customerLink").value=accepted&&operator.isActive?customerUrl.toString():"";
  renderCustomerQr({ inputId:"customerLink", projectName:supermarket.name||operator.name||"السوبرماركت" });
  $("linksHint").innerText=accepted&&operator.isActive
    ?"السوبرماركت جاهز للتشغيل. ابعت له رابط لوحته، وهو يشارك رابط الطلب مع عملائه."
    :"رابط العملاء سيتفعل بعد قبول السوبرماركت لاتفاق العمولة وتفعيل حسابه.";
}

async function refresh(){
  bundle=await getSupermarketProjectBundle(projectId);
  if(bundle?.operator&&!bundle.operator.authLoginEmail&&!bundle.operator.authUid){
    bundle.operator=await ensureOperatorInviteAccess(projectId,currentUser.uid);
  }
  render();
  if(bundle.supermarket){
    await refreshOwnerFinance();
  }
}

protectPage(async user=>{
  currentUser=user;

  if(!projectId){
    $("statusBanner").innerText="رابط المشروع غير مكتمل.";
    return;
  }

  const projectSnap=await getDoc(doc(db,"projects",projectId));

  if(!projectSnap.exists()){
    $("statusBanner").innerText="المشروع غير موجود.";
    return;
  }

  currentProject={projectDocId:projectSnap.id,...projectSnap.data()};

  if(currentProject.ownerId!==user.uid || currentProject.template!=="supermarket"){
    $("statusBanner").innerText="غير مسموح لك بإدارة هذا المشروع.";
    return;
  }

  await refresh();
  startOwnerFinanceLiveRefresh();
});

$("createSetupBtn").onclick=async()=>{
  if(!currentUser||!currentProject)return;
  $("setupMessage").innerText="جاري حفظ بيانات السوبرماركت...";
  $("createSetupBtn").disabled=true;
  try{
    await createOrResumeSupermarketSetup({
      projectId,
      ownerId:currentUser.uid,
      name:$("storeName").value,
      contactName:$("contactName").value,
      phone:$("storePhone").value,
      whatsapp:$("storeWhatsapp").value,
      address:$("storeAddress").value,
      location:$("storeLocation").value,
      deliveryFee:$("deliveryFee").value,
      commissionAmount:$("commissionAmount").value
    });
    $("setupMessage").innerText="تم ربط السوبرماركت. ابعت دعوة التشغيل من زر واتساب ✅";
    await refresh();
  }catch(e){
    $("setupMessage").innerText=`تعذر الحفظ: ${e.message}`;
  }finally{
    $("createSetupBtn").disabled=false;
  }
};

$("proposeCommissionBtn").onclick=async()=>{
  if(!currentUser||!bundle?.operator)return;
  $("commissionMessage").innerText="جاري إرسال التعديل...";
  try{
    await proposeCommission({
      projectDocId:projectId,
      ownerId:currentUser.uid,
      operatorId:projectId,
      templateId:"supermarket",
      amount:$("newCommissionAmount").value
    });
    $("commissionMessage").innerText="تم إرسال العمولة الجديدة للسوبرماركت للموافقة ✅";
    $("newCommissionAmount").value="";
    await refresh();
  }catch(e){
    $("commissionMessage").innerText=`تعذر إرسال التعديل: ${e.message}`;
  }
};

$("resetOperatorAccessBtn").onclick=async()=>{
  if(!bundle?.operator)return;
  const confirmed=confirm("إصدار رابط دخول جديد سيُلغي وصول الحساب القديم فورًا. بيانات المشروع والعمولة والطلبات لن تتغير. متابعة؟");
  if(!confirmed)return;
  const btn=$("resetOperatorAccessBtn");
  btn.disabled=true;
  try{
    await rotateOperatorInviteAccess(projectId,currentUser.uid);
    await refresh();
    $("linksHint").innerText="تم إصدار رابط دخول جديد ✅ الرابط القديم لم يعد صالحًا. ابعت الرابط الجديد لمسؤول السوبرماركت.";
  }catch(e){
    $("linksHint").innerText="تعذر إصدار رابط دخول جديد. حدّث الصفحة وحاول مرة أخرى. إذا استمرت المشكلة تواصل مع إدارة المنصة.";
  }finally{
    btn.disabled=false;
  }
};

$("sendOperatorWhatsappBtn").onclick=()=>{
  const operator=bundle?.operator;
  const phone=normalizeWhatsAppPhone(operator?.whatsapp||operator?.phone);
  const link=$("operatorLink").value;
  if(!phone||!link){return;}
  const message=`دعوة من Family Business لإدارة ${bundle?.supermarket?.name||"السوبرماركت"}.\nافتح الرابط الشخصي التالي، أنشئ كلمة مرور أول مرة ثم وافق على العمولة لبدء التشغيل:\n${link}\n\nمهم: الرابط شخصي، لا تعمله Forward لأي شخص.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,"_blank","noopener");
};
