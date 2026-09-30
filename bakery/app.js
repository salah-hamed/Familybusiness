import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";
import { escapeHTML } from "../core/utils/helpers.js";
import { createOrResumeRestaurantSetup, getRestaurantProjectBundle } from "../core/restaurant/restaurant-service.js";
import { ensureOperatorInviteAccess, getOperatorInviteToken, rotateOperatorInviteAccess } from "../core/partners/partner-service.js";
import { normalizeWhatsAppPhone } from "../core/whatsapp/dispatch-service.js";
import { proposeCommission } from "../core/commissions/commission-service.js";
import { createGuide } from "../core/onboarding/guide.js";
import { buildPartnerProjectGuide } from "../core/onboarding/guide-state.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
let currentUser=null;
let currentProject=null;
let bundle=null;

const guideController = createGuide(
  buildPartnerProjectGuide({ templateId: "bakery", bundle: null }),
  { autoOpen: false }
);

function money(value){return `${Number(value||0).toLocaleString("ar-EG")} جنيه`;}
function statusText(status){
  return ({accepted:"مقبول",pending:"بانتظار الموافقة",rejected:"مرفوض",not_proposed:"لم يبدأ"})[status]||status||"—";
}
async function copyValue(id){
  const value=$(id)?.value||"";
  if(!value)return;
  try{await navigator.clipboard.writeText(value);}catch{$(id).select();document.execCommand("copy");}
}
document.querySelectorAll("[data-copy]").forEach(btn=>btn.onclick=()=>copyValue(btn.dataset.copy));

async function loadEarnings(){
  const snap=await getDocs(query(collection(db,"commissionLedger"),where("userId","==",currentUser.uid)));
  const entries=snap.docs.map(d=>d.data()).filter(x=>x.sourceType==="project_order"&&x.projectId===projectId);
  const earned=entries.reduce((s,x)=>s+Number(x.amount||0),0);
  const paid=entries.filter(x=>x.status==="paid"||x.paidAt).reduce((s,x)=>s+Number(x.amount||0),0);
  $("completedOrders").innerText=entries.length;
  $("earnedCommission").innerText=money(earned);
  $("paidCommission").innerText=money(paid);
  $("outstandingCommission").innerText=money(Math.max(0,earned-paid));
}

function render(){
  const {restaurant,operator,agreement}=bundle;
  const configured=Boolean(restaurant&&operator);
  guideController.update(buildPartnerProjectGuide({ templateId: "bakery", bundle }), { autoOpen: true });

  $("setupSection").classList.toggle("hidden",configured);
  $("projectSection").classList.toggle("hidden",!configured);

  if(!configured){
    $("statusBanner").innerText="ابدأ بربط مخبز أو محل مخبوزات بالمشروع وتحديد العمولة المقترحة.";
    return;
  }

  const accepted=agreement?.status==="accepted"&&agreement?.currentAmount!=null;
  const pending=agreement?.pendingStatus==="pending";

  $("statusBanner").innerText=accepted
    ?"المشروع مرتبط. المخبز يقدر يدير هويته والمنيو والطلبات، وأنت تتابع العمولة."
    :"المشروع في انتظار استكمال اتفاق العمولة مع المخبز.";

  $("linkedRestaurantName").innerText=restaurant.name||operator.name||"المخبز";
  $("operatorState").innerText=operator.isActive?"نشط":"بانتظار التفعيل";
  $("agreementStatus").innerText=pending
    ? `${statusText(agreement?.status)} · تعديل منتظر`
    : statusText(agreement?.status||operator.agreementStatus);
  $("currentCommission").innerText=accepted?money(agreement.currentAmount):"لم تُعتمد بعد";

  $("restaurantMeta").innerHTML=[
    ["نوع المخبوزات",restaurant.cuisine||"—"],
    ["المسؤول",restaurant.contactName||operator.contactName||"—"],
    ["الهاتف",restaurant.phone||operator.phone||"—"],
    ["واتساب",operator.whatsapp||restaurant.whatsapp||"—"],
    ["مصاريف التوصيل",money(restaurant.deliveryFee||0)]
  ].map(([k,v])=>`<div class="metaItem"><b>${escapeHTML(k)}</b><div>${escapeHTML(v)}</div></div>`).join("");

  $("commissionMessage").innerText=pending&&agreement?.pendingAmount!=null
    ? `في انتظار موافقة المخبز على ${money(agreement.pendingAmount)} لكل طلب مكتمل.`
    :"";

  const operatorUrl=new URL("../bakery-operator/",location.href);
  operatorUrl.searchParams.set("project",projectId);
  const inviteToken=getOperatorInviteToken(operator);
  if(inviteToken)operatorUrl.searchParams.set("invite",inviteToken);
  $("operatorLink").value=operatorUrl.toString();
  $("sendOperatorWhatsappBtn").disabled=!(inviteToken&&(operator.whatsapp||operator.phone));

  const customerUrl=new URL("../templates/bakery/",location.href);
  customerUrl.searchParams.set("project",projectId);
  $("customerLink").value=accepted&&operator.isActive?customerUrl.toString():"";
  $("linksHint").innerText=accepted&&operator.isActive
    ?"المخبز جاهز. ابعت له رابط لوحته، وهو يشارك رابط الطلب مع عملائه."
    :"رابط العملاء سيتفعل بعد قبول اتفاق العمولة وتفعيل حساب المخبز.";
}

async function refresh(){
  bundle=await getRestaurantProjectBundle(projectId);
  if(bundle?.operator&&!bundle.operator.authLoginEmail&&!bundle.operator.authUid){
    bundle.operator=await ensureOperatorInviteAccess(projectId,currentUser.uid);
  }
  render();
  if(bundle.restaurant)await loadEarnings();
}

protectPage(async user=>{
  currentUser=user;
  if(!projectId){$("statusBanner").innerText="رابط المشروع غير مكتمل.";return;}

  const projectSnap=await getDoc(doc(db,"projects",projectId));
  if(!projectSnap.exists()){$("statusBanner").innerText="المشروع غير موجود.";return;}

  currentProject={projectDocId:projectSnap.id,...projectSnap.data()};
  if(currentProject.ownerId!==user.uid||currentProject.template!=="bakery"){
    $("statusBanner").innerText="غير مسموح لك بإدارة هذا المشروع.";
    return;
  }

  await refresh();
});

$("createSetupBtn").onclick=async()=>{
  if(!currentUser||!currentProject)return;
  $("setupMessage").innerText="جاري حفظ بيانات المخبز...";
  $("createSetupBtn").disabled=true;
  try{
    await createOrResumeRestaurantSetup({
      projectId,
      templateId:"bakery",
      ownerId:currentUser.uid,
      name:$("restaurantName").value,
      cuisine:$("cuisine").value,
      contactName:$("contactName").value,
      phone:$("restaurantPhone").value,
      whatsapp:$("restaurantWhatsapp").value,
      address:$("restaurantAddress").value,
      location:$("restaurantLocation").value,
      deliveryFee:$("deliveryFee").value,
      commissionAmount:$("commissionAmount").value
    });
    $("setupMessage").innerText="تم ربط المخبز. ابعت دعوة التشغيل من زر واتساب ✅";
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
      templateId:"bakery",
      amount:$("newCommissionAmount").value
    });
    $("commissionMessage").innerText="تم إرسال العمولة الجديدة للمخبز للموافقة ✅";
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
    $("linksHint").innerText="تم إصدار رابط دخول جديد ✅ الرابط القديم لم يعد صالحًا. ابعت الرابط الجديد لمسؤول المخبز.";
  }catch(e){
    $("linksHint").innerText=`تعذر إصدار رابط جديد: ${e.message}`;
  }finally{
    btn.disabled=false;
  }
};

$("sendOperatorWhatsappBtn").onclick=()=>{
  const operator=bundle?.operator;
  const phone=normalizeWhatsAppPhone(operator?.whatsapp||operator?.phone);
  const link=$("operatorLink").value;
  if(!phone||!link)return;
  const message=`دعوة من Family Business لإدارة ${bundle?.restaurant?.name||"المخبز"}.\nافتح الرابط الشخصي التالي، أنشئ كلمة مرور أول مرة ثم وافق على العمولة لبدء التشغيل:\n${link}\n\nمهم: الرابط شخصي، لا تعمله Forward لأي شخص.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,"_blank","noopener");
};
