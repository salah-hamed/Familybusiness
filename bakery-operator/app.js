import auth from "../core/firebase/firebase-auth.js";
import { friendlyOperatorError } from "../core/operators/operator-errors.js";
import { renderCustomerQr } from "../core/qr/customer-qr.js?v=20261010-operator-qr2";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { acceptPendingCommission, rejectPendingCommission, getCommissionAgreement } from "../core/commissions/commission-service.js";
import { renderOperatorFinancePanel } from "../core/commissions/finance-panel.js";
import { requestCommissionReversal } from "../core/commissions/reversal-service.js";
import { getRestaurant, updateRestaurantSettings } from "../core/restaurant/restaurant-service.js";
import { WORKER_ROLES, createWorker, listProjectWorkers, setWorkerActive } from "../core/workers/worker-service.js";
import { assignWorkerAndPrepareWhatsApp, rollbackPreparedAssignment } from "../core/workers/worker-dispatch-service.js";
import { buildWorkerWhatsAppUrl, openWhatsAppPlaceholder, navigatePreparedWhatsAppWindow } from "../core/whatsapp/dispatch-service.js";
import { allowedNextRestaurantStatuses, listRestaurantOperationalOrders, subscribeRestaurantOperationalOrders, listRestaurantHistoryPage, countRestaurantDeliveredOrders, acceptRestaurantOrder, changeRestaurantOrderStatus } from "../core/restaurant/order-service.js";
import { getOrderOperationalAlert, summarizeOperationalAlerts } from "../core/orders/operational-alerts.js";
import { createGuide } from "../core/onboarding/guide.js";
import { buildOperatorGuide } from "../core/onboarding/guide-state.js";

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
let operationalOrders=[];
let historyOrders=[];
let historyCursor=null;
let historyHasMore=false;
let operatorGuide=null;
let stopOrdersLive=()=>{};

function refreshOperatorFirstRunGuide({autoOpen=false}={}){
  const journey=buildOperatorGuide({
    templateId:"bakery",
    partner:currentRestaurant||{},
    contentReady:Number(currentRestaurant?.menuItemCount||0)>0,
    teamReady:riders.some(r=>r.isActive===true)
  });
  if(operatorGuide)operatorGuide.update(journey,{autoOpen});
  else operatorGuide=createGuide(journey,{autoOpen:true});
}

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function statusLabel(s){return ({new:"جديد",accepted:"مقبول",preparing:"جاري التحضير",ready:"جاهز",assigned:"تم تعيين مندوب",out_for_delivery:"خرج للتوصيل",delivered:"تم التوصيل",canceled:"ملغي"})[s]||s;}
function setVisible(id,visible){$(id).classList.toggle("hidden",!visible);}
function operatorAccessErrorMessage(error){
  return friendlyOperatorError(error,"تعذر فتح لوحة التشغيل. حاول تحديث الصفحة أو اطلب رابط دعوة جديد.");
}

async function refreshAccount(){
  if(!currentUser)return;

  try{
    await claimOperatorAccess(projectId,currentUser);
  }catch(e){
    $("pageStatus").innerText=operatorAccessErrorMessage(e);
    setVisible("operationsPanel",false);
    return;
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
    $("agreementText").innerText=`${prefix}: ${money(currentAgreement.pendingAmount)} لكل طلب يتم إرساله للتوصيل`;
  }

  const canOperate=operatorCanOperate(currentOperator)&&currentAgreement?.status==="accepted"&&currentAgreement?.currentAmount!=null;
  setVisible("operationsPanel",canOperate);
  $("pageStatus").innerText=canOperate
    ? `مرحبًا ${currentRestaurant?.name||currentOperator?.name||"بالمخبز"} — لوحة التشغيل جاهزة.`
    :"لا يمكن تشغيل الطلبات قبل قبول أول اتفاق عمولة.";

  if(canOperate) await loadOperations();
}

onAuthStateChanged(auth,async user=>{
  currentUser=user;

  if(!projectId||!inviteAuthEmail){
    setVisible("authPanel",false);setVisible("agreementPanel",false);setVisible("operationsPanel",false);
    $("pageStatus").innerText="دعوة واتساب غير مكتملة أو غير صالحة.";
    return;
  }

  if(user&&String(user.email||"").toLowerCase()!==inviteAuthEmail.toLowerCase()){
    stopOrdersLive();
    currentUser=null;
    setVisible("authPanel",true);setVisible("agreementPanel",false);setVisible("operationsPanel",false);
    $("logoutBtn").classList.add("hidden");
    $("pageStatus").innerText="يوجد حساب Family Business مختلف مفتوح في المتصفح. لن يتم تسجيل خروجه تلقائيًا.";
    $("authMessage").innerText="اضغط تسجيل الدخول هنا لتبديل الحساب إلى مشغل هذا المشروع.";
    return;
  }

  if(!user){
    stopOrdersLive();
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
      :friendlyOperatorError(e,"تعذر تفعيل الدعوة. راجع كلمة المرور وحاول مرة أخرى.");
  }
};

$("loginBtn").onclick=async()=>{
  $("authMessage").innerText="جاري تسجيل الدخول...";
  $("loginBtn").disabled=true;
  try{
    const activeEmail=String(auth.currentUser?.email||"").toLowerCase();
    if(auth.currentUser&&activeEmail!==inviteAuthEmail.toLowerCase())await signOut(auth);
    await signInWithEmailAndPassword(auth,inviteAuthEmail,$("authPassword").value);
    $("authMessage").innerText="";
  }catch(e){
    $("authMessage").innerText="تعذر الدخول. راجع كلمة المرور أو تأكد أنك تستخدم نفس رابط الدعوة.";
  }finally{
    $("loginBtn").disabled=false;
  }
};

$("logoutBtn").onclick=()=>signOut(auth);

$("acceptAgreementBtn").onclick=async()=>{
  $("agreementMessage").innerText="جاري قبول الاتفاق...";
  try{
    await acceptPendingCommission({projectDocId:projectId,operatorAuthUid:currentUser.uid});
    $("agreementMessage").innerText="تم قبول العمولة ✅";
    await refreshAccount();
  }catch(e){$("agreementMessage").innerText=friendlyOperatorError(e,"تعذر تحديث اتفاق العمولة.");}
};

$("rejectAgreementBtn").onclick=async()=>{
  try{
    await rejectPendingCommission({projectDocId:projectId,operatorAuthUid:currentUser.uid});
    $("agreementMessage").innerText="تم رفض العمولة.";
    await refreshAccount();
  }catch(e){$("agreementMessage").innerText=friendlyOperatorError(e,"تعذر تحديث اتفاق العمولة.");}
};

function renderRestaurantSettings(){
  if(!currentRestaurant)return;

  $("restaurantTitle").innerText=currentRestaurant.name||"المخبز";
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
  $("settingsColor").value=currentRestaurant.primaryColor||"#D97706";
  $("acceptingOrders").checked=currentRestaurant.isAcceptingOrders===true;

  const customerUrl=new URL("../templates/bakery/",location.href);
  customerUrl.searchParams.set("project",projectId);
  $("customerOrderLink").value=customerUrl.toString();
  renderCustomerQr({ inputId:"customerOrderLink", mountId:"operatorCustomerQrMount", projectName:currentRestaurant.name||"المخبز" });

  updateMediaPreview();
}

function safeImageUrl(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  try{
    const url=new URL(raw);
    return url.protocol==="https:"?url.toString():"";
  }catch{
    return "";
  }
}

function testImageUrl(value,timeout=8000){
  const url=safeImageUrl(value);
  if(!String(value||"").trim())return Promise.resolve(true);
  if(!url)return Promise.resolve(false);

  return new Promise(resolve=>{
    const image=new Image();
    const timer=setTimeout(()=>resolve(false),timeout);
    image.onload=()=>{clearTimeout(timer);resolve(true);};
    image.onerror=()=>{clearTimeout(timer);resolve(false);};
    image.src=url;
  });
}

function setPreview(containerId,url,fallback){
  const node=$(containerId);
  node.innerHTML="";

  if(!url){
    node.innerHTML=`<span>${fallback}</span>`;
    return;
  }

  const image=document.createElement("img");
  image.src=url;
  image.alt="";
  image.referrerPolicy="no-referrer";
  image.onload=()=>{
    $("mediaPreviewMessage").innerText="";
  };
  image.onerror=()=>{
    node.innerHTML=`<span>${fallback}</span>`;
    $("mediaPreviewMessage").innerText="تعذر عرض إحدى الصور. استخدم رابط صورة مباشر HTTPS يسمح بالعرض الخارجي.";
  };
  node.appendChild(image);
}

function updateMediaPreview(){
  setPreview("logoPreview",safeImageUrl($("settingsLogo").value),"🥐");
  setPreview("coverPreview",safeImageUrl($("settingsCover").value),"لا توجد صورة غلاف");
}

async function loadOperations(){
  [currentRestaurant,currentAgreement]=await Promise.all([
    getRestaurant(projectId),
    getCommissionAgreement(projectId)
  ]);

  $("statCommission").innerText=money(currentAgreement?.currentAmount||0);
  renderRestaurantSettings();

  const menuUrl=new URL("./menu.html",location.href);
  menuUrl.searchParams.set("project",projectId);
  if(inviteToken)menuUrl.searchParams.set("invite",inviteToken);
  $("menuLink").href=menuUrl.toString();
  $("openMenuBtn").href=menuUrl.toString();

  const [ridersResult,ordersResult]=await Promise.allSettled([
    loadRiders(),
    loadOrders()
  ]);

  if(ridersResult.status==="rejected"){
    $("riderMessage").innerText=friendlyOperatorError(ridersResult.reason,"تعذر تحميل المندوبين. اضغط تحديث وحاول مرة أخرى.");
  }

  if(ordersResult.status==="rejected"){
    $("ordersMessage").innerText=friendlyOperatorError(ordersResult.reason,"تعذر تحميل الطلبات. اضغط تحديث وحاول مرة أخرى.");
  }else{
    startOrdersLive();
  }
  await renderOperatorFinancePanel({
    container:$("operationsPanel"),
    projectId,
    operatorUid:currentUser.uid
  });
  refreshOperatorFirstRunGuide({autoOpen:true});
}

$("copyCustomerLinkBtn").onclick=async()=>{
  const value=$("customerOrderLink").value;
  try{await navigator.clipboard.writeText(value);}catch{$("customerOrderLink").select();document.execCommand("copy");}
  $("settingsMessage").innerText="تم نسخ رابط العملاء ✅";
};

$("saveSettingsBtn").onclick=async()=>{
  $("settingsMessage").innerText="جاري فحص الصور وحفظ الإعدادات...";
  $("saveSettingsBtn").disabled=true;

  try{
    const logo=$("settingsLogo").value.trim();
    const coverImage=$("settingsCover").value.trim();

    const [logoOk,coverOk]=await Promise.all([
      testImageUrl(logo),
      testImageUrl(coverImage)
    ]);

    if(!logoOk)throw new Error("رابط اللوجو غير صالح أو الموقع يمنع عرض الصورة خارجيًا.");
    if(!coverOk)throw new Error("رابط صورة الغلاف غير صالح أو الموقع يمنع عرض الصورة خارجيًا.");

    await updateRestaurantSettings(projectId,{
      name:$("settingsName").value,
      cuisine:$("settingsCuisine").value,
      slogan:$("settingsSlogan").value,
      phone:$("settingsPhone").value,
      whatsapp:$("settingsWhatsapp").value,
      address:$("settingsAddress").value,
      location:$("settingsLocation").value,
      deliveryFee:$("settingsDeliveryFee").value,
      logo,
      coverImage,
      primaryColor:$("settingsColor").value,
      isAcceptingOrders:$("acceptingOrders").checked
    });

    $("settingsMessage").innerText="تم حفظ الهوية والإعدادات ✅";
    currentRestaurant=await getRestaurant(projectId);
    renderRestaurantSettings();

    Promise.allSettled([loadRiders(),loadOrders()]).then(([ridersResult,ordersResult])=>{
      if(ridersResult.status==="rejected"){
        $("riderMessage").innerText=`تم حفظ الإعدادات، لكن ${friendlyOperatorError(ridersResult.reason,"تعذر تحديث المندوبين.")}`;
      }
      if(ordersResult.status==="rejected"){
        $("ordersMessage").innerText=`تم حفظ الإعدادات، لكن ${friendlyOperatorError(ordersResult.reason,"تعذر تحديث الطلبات.")}`;
      }
    });
  }catch(e){
    $("settingsMessage").innerText=friendlyOperatorError(e,"تعذر حفظ الإعدادات. راجع البيانات وحاول مرة أخرى.");
  }finally{
    $("saveSettingsBtn").disabled=false;
  }
};

["settingsLogo","settingsCover"].forEach(id=>{
  $(id).addEventListener("input",updateMediaPreview);
});

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
  if(operatorGuide)refreshOperatorFirstRunGuide();
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
  }catch(e){$("riderMessage").innerText=friendlyOperatorError(e,"تعذر تحديث المندوب. راجع البيانات وحاول مرة أخرى.");}
};

function activeRiderOptions(){
  return riders.filter(r=>r.isActive).map(r=>`<option value="${r.workerId}">${escapeHTML(r.name)}</option>`).join("");
}

function orderTime(order){
  if(typeof order.createdAt?.toMillis==="function")return order.createdAt.toMillis();
  return Number(order.createdAt?.seconds||0)*1000;
}
function mergeVisibleOrders(){
  const map=new Map();
  [...operationalOrders,...historyOrders].forEach(order=>map.set(order.orderId,order));
  return [...map.values()].sort((a,b)=>orderTime(b)-orderTime(a));
}

async function loadOrders({appendHistory=false}={}){
  $("ordersMessage").innerText="";
  if(appendHistory){
    const page=await listRestaurantHistoryPage(projectId,{pageSize:50,templateType:"bakery",cursor:historyCursor});
    const known=new Set(historyOrders.map(order=>order.orderId));
    historyOrders.push(...page.orders.filter(order=>!known.has(order.orderId)));
    historyCursor=page.nextCursor;
    historyHasMore=page.hasMore;
  }else{
    const [active,page,deliveredCount]=await Promise.all([
      listRestaurantOperationalOrders(projectId,{templateType:"bakery"}),
      listRestaurantHistoryPage(projectId,{pageSize:50,templateType:"bakery"}),
      countRestaurantDeliveredOrders(projectId,{templateType:"bakery"})
    ]);
    operationalOrders=active;
    historyOrders=page.orders;
    historyCursor=page.nextCursor;
    historyHasMore=page.hasMore;
    $("statDelivered").innerText=deliveredCount;
  }

  renderOrders();
}

function renderOrders(){
  orders=mergeVisibleOrders();
  $("statNew").innerText=operationalOrders.filter(o=>o.status==="new").length;
  $("statActive").innerText=operationalOrders.filter(o=>o.status!=="new").length;
  $("loadOlderOrdersBtn").classList.toggle("hidden",!historyHasMore);
  const alerts=operationalOrders.map(order=>getOrderOperationalAlert(order)).filter(Boolean);
  $("ordersMessage").innerText=summarizeOperationalAlerts(alerts);

  $("ordersList").innerHTML=orders.length?orders.map(o=>{
    const items=(o.items||[]).map(i=>`${Number(i.quantity||0)} × ${escapeHTML(i.name)} (${escapeHTML(i.unit||"قطعة")})`).join("<br>");
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
    const resend=o.assignedWorkerWhatsapp?'<button class="secondary resendWhatsapp">إعادة إرسال واتساب</button>':"";
    const reversalControl=o.status==="canceled"&&o.commissionLocked===true
      ? `<select class="reversalReasonSelect">${reversalReasonOptions()}</select><button class="secondary requestReversal">طلب عكس العمولة</button>`
      :"";

    return `<article class="rowCard orderCard" data-order="${o.orderId}">
      <div class="rowTop"><div><b>طلب #${o.orderId.slice(0,7)}</b><div class="muted">${escapeHTML(o.customerName)} · ${escapeHTML(o.customerPhone)}</div></div><span class="pill">${statusLabel(o.status)}</span></div>
      ${getOrderOperationalAlert(o)?`<div class="message">${escapeHTML(getOrderOperationalAlert(o).message)}</div>`:""}
      <div class="orderItems">${items||"لا توجد تفاصيل"}</div>
      <div class="muted">${escapeHTML(o.customerAddress||"")} · الإجمالي <b>${money(o.total||o.price)}</b></div>
      ${o.assignedWorkerName?`<div class="muted">المندوب: <b>${escapeHTML(o.assignedWorkerName)}</b></div>`:""}
      <div class="orderActions">${riderSelect}${nextButton}${resend}${reversalControl}${canCancel?'<button class="danger statusAction" data-next="canceled">إلغاء</button>':""}</div>
    </article>`;
  }).join(""):'<p class="muted">لا توجد طلبات حتى الآن.</p>';

  document.querySelectorAll(".orderCard").forEach(card=>{
    const order=orders.find(o=>o.orderId===card.dataset.order);

    card.querySelectorAll(".statusAction").forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      try{
        if(btn.dataset.next==="accepted"){
          await acceptRestaurantOrder({projectId,orderId:order.orderId,actorUid:currentUser.uid,templateType:"bakery"});
        }else{
          await changeRestaurantOrderStatus({projectId,orderId:order.orderId,actorUid:currentUser.uid,nextStatus:btn.dataset.next,templateType:"bakery"});
        }
        await loadOrders();
      }catch(e){alert(friendlyOperatorError(e,"تعذر تنفيذ الإجراء على الطلب. حدّث الطلبات وحاول مرة أخرى."));}finally{btn.disabled=false;}
    });

    card.querySelector(".assignRider")?.addEventListener("click",async()=>{
      const workerId=card.querySelector(".riderSelect").value;
      if(!workerId){alert("اختار المندوب الأول");return;}

      const popup=openWhatsAppPlaceholder();

      try{
        const result=await assignWorkerAndPrepareWhatsApp({
          projectId,
          orderId:order.orderId,
          workerId,
          actorUid:currentUser.uid,
          businessName:currentRestaurant?.name||""
        });

        try{
          await changeRestaurantOrderStatus({projectId,orderId:order.orderId,actorUid:currentUser.uid,nextStatus:"assigned",templateType:"bakery"});
        }catch(statusError){
          await rollbackPreparedAssignment({
            projectId,
            orderId:order.orderId,
            actorUid:currentUser.uid
          });
          throw statusError;
        }

        const opened=navigatePreparedWhatsAppWindow(popup,result.whatsappUrl);
        await loadOrders();

        if(!opened){
          alert("تم تعيين المندوب واحتساب العمولة، لكن المتصفح منع فتح واتساب. اضغط «إعادة إرسال واتساب» من الطلب.");
        }
      }catch(e){
        try{popup?.close();}catch{}
        alert(friendlyOperatorError(e,"تعذر تنفيذ الإجراء على الطلب. حدّث الطلبات وحاول مرة أخرى."));
      }
    });

    card.querySelector(".resendWhatsapp")?.addEventListener("click",()=>{
      const worker={
        name:order.assignedWorkerName,
        whatsapp:order.assignedWorkerWhatsapp
      };
      const url=buildWorkerWhatsAppUrl({
        templateId:"bakery",
        orderId:order.orderId,
        order,
        worker,
        businessName:currentRestaurant?.name||""
      });
      const opened=window.open(url,"_blank","noopener");
      if(!opened) alert("المتصفح منع فتح واتساب. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.");
    });

    card.querySelector(".requestReversal")?.addEventListener("click",async()=>{
      const button=card.querySelector(".requestReversal");
      const reasonCode=card.querySelector(".reversalReasonSelect")?.value||"other";
      button.disabled=true;
      try{
        await requestCommissionReversal({
          projectId,
          orderId:order.orderId,
          operatorUid:currentUser.uid,
          reasonCode
        });
        alert("تم إرسال طلب عكس العمولة لصاحب المشروع للمراجعة.");
        await renderOperatorFinancePanel({
          container:$("operationsPanel"),
          projectId,
          operatorUid:currentUser.uid
        });
      }catch(e){
        alert(reversalErrorMessage(e));
      }finally{
        button.disabled=false;
      }
    });
  });
}

function startOrdersLive(){
  stopOrdersLive();
  stopOrdersLive=subscribeRestaurantOperationalOrders(
    projectId,
    liveOrders=>{
      operationalOrders=liveOrders;
      renderOrders();
    },
    error=>{
      console.error("Bakery realtime orders failed",error);
      $("ordersMessage").innerText=friendlyOperatorError(error,"تعذر التحديث اللحظي للطلبات. استخدم زر تحديث مؤقتًا.");
    },
    {templateType:"bakery"}
  );
}

window.addEventListener("pagehide",()=>stopOrdersLive());
$("refreshOrdersBtn").onclick=async()=>{
  $("ordersMessage").innerText="جاري تحديث الطلبات...";
  try{
    await loadOrders();
  }catch(e){
    $("ordersMessage").innerText=friendlyOperatorError(e,"تعذر تحديث الطلبات. حاول مرة أخرى.");
  }
};
$("loadOlderOrdersBtn").onclick=async()=>{
  const btn=$("loadOlderOrdersBtn");
  btn.disabled=true;
  $("ordersMessage").innerText="جاري تحميل طلبات أقدم...";
  try{await loadOrders({appendHistory:true});}catch(e){$("ordersMessage").innerText=friendlyOperatorError(e,"تعذر تحميل طلبات أقدم. حاول مرة أخرى.");}finally{btn.disabled=false;}
};
document.querySelectorAll(".tabs button").forEach(btn=>btn.onclick=()=>document.getElementById(btn.dataset.target)?.scrollIntoView({behavior:"smooth",block:"start"}));
