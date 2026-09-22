import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";
import { createOrResumeSupermarketSetup, getSupermarketProjectBundle } from "../core/supermarket/supermarket-service.js";
import { proposeCommission } from "../core/commissions/commission-service.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const projectId = new URLSearchParams(location.search).get("project") || "";
let currentUser = null;
let currentProject = null;
let bundle = null;

function money(value){return `${Number(value||0).toLocaleString("ar-EG")} جنيه`;}
function statusText(status){
  return ({accepted:"مقبول",pending:"بانتظار الموافقة",rejected:"مرفوض",not_proposed:"لم يبدأ"})[status] || status || "—";
}
function baseUrl(path){return new URL(path, window.location.href).toString();}

async function copyValue(id){
  const value=$(id)?.value||"";
  if(!value)return;
  try{await navigator.clipboard.writeText(value);}catch{ $(id).select(); document.execCommand("copy"); }
}

document.querySelectorAll("[data-copy]").forEach(btn=>btn.onclick=()=>copyValue(btn.dataset.copy));

async function loadEarnings(){
  const snap=await getDocs(query(collection(db,"commissionLedger"),where("userId","==",currentUser.uid),where("projectId","==",projectId)));
  const entries=snap.docs.map(d=>d.data()).filter(x=>x.sourceType==="project_order");
  $("completedOrders").innerText=entries.length;
  $("earnedCommission").innerText=money(entries.reduce((s,x)=>s+Number(x.amount||0),0));
}

function render(){
  const {supermarket,operator,agreement}=bundle;
  const configured=Boolean(supermarket&&operator);

  $("setupSection").classList.toggle("hidden",configured);
  $("projectSection").classList.toggle("hidden",!configured);

  if(!configured){
    $("statusBanner").innerText="ابدأ بربط سوبرماركت واحد بالمشروع وتحديد العمولة المقترحة.";
    return;
  }

  const accepted=agreement?.status==="accepted" && agreement?.currentAmount!=null;
  const pending=agreement?.pendingStatus==="pending";

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
    ["الإيميل",supermarket.email||operator.email||"—"],
    ["مصاريف التوصيل",money(supermarket.deliveryFee||0)]
  ].map(([k,v])=>`<div class="metaItem"><b>${k}</b><div>${v}</div></div>`).join("");

  if(pending && agreement?.pendingAmount!=null){
    $("commissionMessage").innerText=`في انتظار موافقة السوبرماركت على ${money(agreement.pendingAmount)} لكل طلب مكتمل.`;
  } else {
    $("commissionMessage").innerText="";
  }

  const operatorUrl=new URL("../supermarket-operator/",location.href);
  operatorUrl.searchParams.set("project",projectId);
  $("operatorLink").value=operatorUrl.toString();

  const customerUrl=new URL("../templates/supermarket/",location.href);
  customerUrl.searchParams.set("project",projectId);
  $("customerLink").value=accepted&&operator.isActive?customerUrl.toString():"";
  $("linksHint").innerText=accepted&&operator.isActive
    ?"السوبرماركت جاهز للتشغيل. ابعت له رابط لوحته، وهو يشارك رابط الطلب مع عملائه."
    :"رابط العملاء سيتفعل بعد قبول السوبرماركت لاتفاق العمولة وتفعيل حسابه.";
}

async function refresh(){
  bundle=await getSupermarketProjectBundle(projectId);
  render();
  if(bundle.supermarket) await loadEarnings();
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
      email:$("operatorEmail").value,
      phone:$("storePhone").value,
      whatsapp:$("storeWhatsapp").value,
      address:$("storeAddress").value,
      location:$("storeLocation").value,
      deliveryFee:$("deliveryFee").value,
      commissionAmount:$("commissionAmount").value
    });
    $("setupMessage").innerText="تم ربط السوبرماركت وإرسال اتفاق العمولة ✅";
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
