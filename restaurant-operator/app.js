import auth from "../core/firebase/firebase-auth.js";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { acceptPendingCommission, rejectPendingCommission, getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getRestaurant, updateRestaurantSettings } from "../core/restaurant/restaurant-service.js";
import { WORKER_ROLES, createWorker, listProjectWorkers, setWorkerActive } from "../core/workers/worker-service.js";
import { assignWorkerAndPrepareWhatsApp } from "../core/workers/worker-dispatch-service.js";
import { allowedNextRestaurantStatuses, listRestaurantOrders, acceptRestaurantOrder, changeRestaurantOrderStatus } from "../core/restaurant/order-service.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const projectId=params.get("project")||"";
const inviteToken=params.get("invite")||"";
const inviteAuthEmail=buildOperatorAuthEmail(inviteToken);

let currentUser=null;
let currentOperator=null;
let currentAgreement=null;
let currentRestaurant=null;
let riders=[];
let orders=[];

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function statusLabel(s){return ({new:"جديد",accepted:"مقبول",preparing:"جاري التحضير",ready:"جاهز",assigned:"تم تعيين مندوب",out_for_delivery:"خرج للتوصيل",delivered:"تم التوصيل",canceled:"ملغي"})[s]||s;}
function setVisible(id,visible){$(id).classList.toggle("hidden",!visible);}

async function refreshAccount(){
  if(!currentUser)return;

  try{
    await claimOperatorAccess(projectId,currentUser);
  }catch(e){
    if(e.message!=="OPERATOR_ALREADY_CLAIMED"){
      $("pageStatus").innerText=`تعذر ربط الحساب: ${e.message}`;
      return;
    }
  }

  [currentOperator,currentAgreement,currentRestaurant]=await Promise.all([
    getOperator(projectId),
    getCommissionAgreement(projectId),
    getRestaurant(projectId)
  ]);

  setVisible("authPanel",false);
  $("logoutBtn").classList.remove("hidden");

  const hasPending=currentAgreement?.pendingStatus==="pending"&&currentAgreement?.pendingAmount!=null;
  setVisible("agreementPanel",hasPending);

  if(hasPending){
    const prefix=currentAgreement.currentAmount!=null
      ? `العمولة الحالية ${money(currentAgreement.currentAmount)} — التعديل المقترح`
      :"العمولة المقترحة";
    $("agreementText").innerText=`${prefix}: ${money(currentAgreement.pendingAmount)} لكل طلب مكتمل`;
  }

  const canOperate=operatorCanOperate(currentOperator)&&currentAgreement?.status==="accepted"&&currentAgreement?.currentAmount!=null;
  setVisible("operationsPanel",canOperate);
  $("pageStatus").innerText=canOperate
    ? `مرحبًا ${currentRestaurant?.name||currentOperator?.name||"بالمطعم"} — لوحة التشغيل جاهزة.`
    :"لا يمكن تشغيل الطلبات قبل قبول أول اتفاق عمولة.";

  if(canOperate)await loadOperations();
}

onAuthStateChanged(auth,async user=>{
  currentUser=user;

  if(!projectId||!inviteAuthEmail){
    setVisible("authPanel",false);setVisible("agreementPanel",false);setVisible("operationsPanel",false);
    $("pageStatus").innerText="دعوة واتساب غير مكتملة أو غير صالحة.";
    return;
  }

  if(user&&String(user.email||"").toLowerCase()!==inviteAuthEmail.toLowerCase()){
    await signOut(auth);
    return;
  }

  if(!user){
    setVisible("authPanel",true);setVisible("agreementPanel",false);setVisible("operationsPanel",false);
    $("logoutBtn").classList.add("hidden");
    $("pageStatus").innerText="فعّل الدعوة بكلمة مرور أول مرة، أو سجل دخولك لو فعلتها قبل كده.";
    return;
  }

  refreshAccount();
});

$("registerBtn").onclick=async()=>{
  $("authMessage").innerText="جاري تفعيل الدعوة...";
  try{
    await createUserWithEmailAndPassword(auth,inviteAuthEmail,$("authPassword").value);
    $("authMessage").innerText="تم تفعيل الدعوة ✅";
  }catch(e){
    $("authMessage").innerText=e.code==="auth/email-already-in-use"
      ?"الدعوة مفعلة بالفعل. استخدم تسجيل الدخول."
      :e.message;
  }
};

$("loginBtn").onclick=async()=>{
  $("authMessage").innerText="جاري تسجيل الدخول...";
  try{
    await signInWithEmailAndPassword(auth,inviteAuthEmail,$("authPassword").value);
    $("authMessage").innerText="";
  }catch{
    $("authMessage").innerText="تعذر الدخول. راجع كلمة المرور أو رابط الدعوة.";
  }
};

$("logoutBtn").onclick=()=>signOut(auth);

$("acceptAgreementBtn").onclick=async()=>{
  $("agreementMessage").innerText="جاري قبول الاتفاق...";
  try{
    await acceptPendingCommission({projectDocId:projectId,operatorAuthUid:currentUser.uid});
    $("agreementMessage").innerText="تم قبول العمولة ✅";
    await refreshAccount();
  }catch(e){$("agreementMessage").innerText=e.message;}
};

$("rejectAgreementBtn").onclick=async()=>{
  try{
    await rejectPendingCommission({projectDocId:projectId,operatorAuthUid:currentUser.uid});
    $("agreementMessage").innerText="تم رفض العمولة.";
    await refreshAccount();
  }catch(e){$("agreementMessage").innerText=e.message;}
};

async function loadOperations(){
  currentRestaurant=await getRestaurant(projectId);
  currentAgreement=await getCommissionAgreement(projectId);
  $("statCommission").innerText=money(currentAgreement?.currentAmount||0);

  if(currentRestaurant){
    $("restaurantTitle").innerText=currentRestaurant.name||"المطعم";
    $("settingsName").value=currentRestaurant.name||"";
    $("settingsCuisine").value=currentRestaurant.cuisine||"";
    $("settingsSlogan").value=currentRestaurant.slogan||"";
    $("settingsPhone").value=currentRestaurant.phone||"";
    $("settingsWhatsapp").value=currentRestaurant.whatsapp||"";
    $("settingsAddress").value=currentRestaurant.address||"";
    $("settingsLocation").value=currentRestaurant.location||"";
    $("settingsDeliveryFee").value=currentRestaurant.deliveryFee??0;
    $("settingsLogo").value=currentRestaurant.logo||"";
    $("settingsCover").value=currentRestaurant.coverImage||"";
    $("settingsColor").value=currentRestaurant.primaryColor||"#EA580C";
    $("acceptingOrders").checked=currentRestaurant.isAcceptingOrders===true;

    const customerUrl=new URL("../templates/restaurant/",location.href);
    customerUrl.searchParams.set("project",projectId);
    $("customerOrderLink").value=customerUrl.toString();
  }

  const menuUrl=new URL("./menu.html",location.href);
  menuUrl.searchParams.set("project",projectId);
  if(inviteToken)menuUrl.searchParams.set("invite",inviteToken);
  $("menuLink").href=menuUrl.toString();
  $("openMenuBtn").href=menuUrl.toString();

  await Promise.all([loadRiders(),loadOrders()]);
}

$("copyCustomerLinkBtn").onclick=async()=>{
  const value=$("customerOrderLink").value;
  try{await navigator.clipboard.writeText(value);}catch{$("customerOrderLink").select();document.execCommand("copy");}
  $("settingsMessage").innerText="تم نسخ رابط العملاء ✅";
};

$("saveSettingsBtn").onclick=async()=>{
  $("settingsMessage").innerText="جاري الحفظ...";
  try{
    await updateRestaurantSettings(projectId,{
      name:$("settingsName").value,
      cuisine:$("settingsCuisine").value,
      slogan:$("settingsSlogan").value,
      phone:$("settingsPhone").value,
      whatsapp:$("settingsWhatsapp").value,
      address:$("settingsAddress").value,
      location:$("settingsLocation").value,
      deliveryFee:$("settingsDeliveryFee").value,
      logo:$("settingsLogo").value,
      coverImage:$("settingsCover").value,
      primaryColor:$("settingsColor").value,
      isAcceptingOrders:$("acceptingOrders").checked
    });
    $("settingsMessage").innerText="تم حفظ الهوية والإعدادات ✅";
    await loadOperations();
  }catch(e){$("settingsMessage").innerText=e.message;}
};

async function loadRiders(){
  riders=await listProjectWorkers(projectId,{role:WORKER_ROLES.RIDER,activeOnly:false});
  $("ridersList").innerHTML=riders.length?riders.map(r=>`
    <article class="rowCard">
      <div class="rowTop"><div><b>${escapeHTML(r.name)}</b><div class="muted">${escapeHTML(r.whatsapp||r.phone)}</div></div><span class="pill">${r.isActive?"نشط":"متوقف"}</span></div>
      <button class="secondary riderToggle" data-rider="${r.workerId}">${r.isActive?"إيقاف":"تفعيل"}</button>
    </article>`).join(""):'<p class="muted">أضف أول مندوب علشان تقدر تعيّن الطلبات.</p>';

  document.querySelectorAll(".riderToggle").forEach(btn=>btn.onclick=async()=>{
    const rider=riders.find(x=>x.workerId===btn.dataset.rider);
    await setWorkerActive({workerId:rider.workerId,projectId,actorUid:currentUser.uid,isActive:!rider.isActive});
    await loadRiders();
  });
}

$("addRiderBtn").onclick=async()=>{
  $("riderMessage").innerText="جاري الإضافة...";
  try{
    await createWorker({
      projectId,
      actorUid:currentUser.uid,
      name:$("riderName").value,
      role:WORKER_ROLES.RIDER,
      phone:$("riderPhone").value,
      whatsapp:$("riderPhone").value
    });
    $("riderName").value="";
    $("riderPhone").value="";
    $("riderMessage").innerText="تمت إضافة المندوب ✅";
    await loadRiders();
  }catch(e){$("riderMessage").innerText=e.message;}
};

function activeRiderOptions(){
  return riders.filter(r=>r.isActive).map(r=>`<option value="${r.workerId}">${escapeHTML(r.name)}</option>`).join("");
}

async function loadOrders(){
  orders=await listRestaurantOrders(projectId);
  $("statNew").innerText=orders.filter(o=>o.status==="new").length;
  $("statActive").innerText=orders.filter(o=>!["new","delivered","canceled"].includes(o.status)).length;
  $("statDelivered").innerText=orders.filter(o=>o.status==="delivered").length;

  $("ordersList").innerHTML=orders.length?orders.map(o=>{
    const items=(o.items||[]).map(i=>`${Number(i.quantity||0)} × ${escapeHTML(i.name)}`).join("<br>");
    const next=allowedNextRestaurantStatuses(o.status);
    const canCancel=next.includes("canceled");
    const riderSelect=o.status==="ready"
      ? `<select class="riderSelect"><option value="">اختر المندوب</option>${activeRiderOptions()}</select><button class="primary assignRider">تعيين وإرسال واتساب</button>`
      :"";
    const nextButton=o.status==="new"?'<button class="primary statusAction" data-next="accepted">قبول الطلب</button>':
      o.status==="accepted"?'<button class="primary statusAction" data-next="preparing">بدء التحضير</button>':
      o.status==="preparing"?'<button class="primary statusAction" data-next="ready">جاهز للتوصيل</button>':
      o.status==="assigned"?'<button class="primary statusAction" data-next="out_for_delivery">خرج للتوصيل</button>':
      o.status==="out_for_delivery"?'<button class="primary statusAction" data-next="delivered">تأكيد التوصيل</button>':"";

    return `<article class="rowCard orderCard" data-order="${o.orderId}">
      <div class="rowTop"><div><b>طلب #${o.orderId.slice(0,7)}</b><div class="muted">${escapeHTML(o.customerName)} · ${escapeHTML(o.customerPhone)}</div></div><span class="pill">${statusLabel(o.status)}</span></div>
      <div class="orderItems">${items||"لا توجد تفاصيل"}</div>
      <div class="muted">${escapeHTML(o.customerAddress||"")} · الإجمالي <b>${money(o.total||o.price)}</b></div>
      ${o.assignedWorkerName?`<div class="muted">المندوب: <b>${escapeHTML(o.assignedWorkerName)}</b></div>`:""}
      <div class="orderActions">${riderSelect}${nextButton}${canCancel?'<button class="danger statusAction" data-next="canceled">إلغاء</button>':""}</div>
    </article>`;
  }).join(""):'<p class="muted">لا توجد طلبات حتى الآن.</p>';

  document.querySelectorAll(".orderCard").forEach(card=>{
    const order=orders.find(o=>o.orderId===card.dataset.order);

    card.querySelectorAll(".statusAction").forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      try{
        if(btn.dataset.next==="accepted"){
          await acceptRestaurantOrder({projectId,orderId:order.orderId,actorUid:currentUser.uid});
        }else{
          await changeRestaurantOrderStatus({projectId,orderId:order.orderId,actorUid:currentUser.uid,nextStatus:btn.dataset.next});
        }
        await loadOrders();
      }catch(e){alert(e.message);}finally{btn.disabled=false;}
    });

    card.querySelector(".assignRider")?.addEventListener("click",async()=>{
      const workerId=card.querySelector(".riderSelect").value;
      if(!workerId){alert("اختار المندوب الأول");return;}
      try{
        const result=await assignWorkerAndPrepareWhatsApp({projectId,orderId:order.orderId,workerId,actorUid:currentUser.uid});
        await changeRestaurantOrderStatus({projectId,orderId:order.orderId,actorUid:currentUser.uid,nextStatus:"assigned"});
        window.open(result.whatsappUrl,"_blank","noopener");
        await loadOrders();
      }catch(e){alert(e.message);}
    });
  });
}

$("refreshOrdersBtn").onclick=loadOrders;
document.querySelectorAll(".tabs button").forEach(btn=>btn.onclick=()=>document.getElementById(btn.dataset.target)?.scrollIntoView({behavior:"smooth",block:"start"}));
