import auth from "../core/firebase/firebase-auth.js";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { acceptPendingCommission, rejectPendingCommission, getCommissionAgreement } from "../core/commissions/commission-service.js";
import { renderOperatorFinancePanel } from "../core/commissions/finance-panel.js";
import { getSupermarket, updateSupermarketSettings } from "../core/supermarket/supermarket-service.js";
import { WORKER_ROLES, createWorker, listProjectWorkers, setWorkerActive } from "../core/workers/worker-service.js";
import { assignWorkerAndPrepareWhatsApp, rollbackPreparedAssignment } from "../core/workers/worker-dispatch-service.js";
import { buildWorkerWhatsAppUrl, openWhatsAppPlaceholder, navigatePreparedWhatsAppWindow } from "../core/whatsapp/dispatch-service.js";
import { allowedNextSupermarketStatuses, listSupermarketOperationalOrders, listSupermarketHistoryPage, countSupermarketDeliveredOrders, acceptSupermarketOrder, changeSupermarketOrderStatus } from "../core/supermarket/order-service.js";

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
let currentStore=null;
let riders=[];
let orders=[];
let operationalOrders=[];
let historyOrders=[];
let historyCursor=null;
let historyHasMore=false;

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function statusLabel(s){return ({new:"جديد",accepted:"مقبول",preparing:"جاري التحضير",ready:"جاهز",assigned:"تم تعيين مندوب",out_for_delivery:"خرج للتوصيل",delivered:"تم التوصيل",canceled:"ملغي"})[s]||s;}
function setVisible(id,visible){$(id).classList.toggle("hidden",!visible);}
function operatorAccessErrorMessage(error){
  const code=String(error?.code||"");
  const message=String(error?.message||"");
  if(
    code.includes("permission-denied")
    || message==="OPERATOR_ALREADY_CLAIMED"
    || message==="OPERATOR_INVITE_MISMATCH"
  ){
    return "رابط الدخول ده اتلغى أو تم استبداله. اطلب رابط دخول جديد من صاحب المشروع.";
  }
  return `تعذر ربط الحساب: ${message||"UNKNOWN_ERROR"}`;
}

async function refreshAccount(){
  if(!currentUser)return;
  if(!projectId){
    $("pageStatus").innerText="رابط السوبرماركت غير مكتمل.";
    setVisible("authPanel",false);
      setVisible("agreementPanel",false);
    setVisible("operationsPanel",false);
    return;
  }
  try{
    await claimOperatorAccess(projectId,currentUser);
  }catch(e){
    $("pageStatus").innerText=operatorAccessErrorMessage(e);
    setVisible("operationsPanel",false);
    return;
  }

  currentOperator=await getOperator(projectId);
  currentAgreement=await getCommissionAgreement(projectId);
  currentStore=await getSupermarket(projectId);

  setVisible("authPanel",false);
  $("logoutBtn").classList.remove("hidden");

  const hasPending=currentAgreement?.pendingStatus==="pending" && currentAgreement?.pendingAmount!=null;
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
    ?`مرحبًا ${currentOperator?.name||"بالسوبرماركت"} — لوحة التشغيل جاهزة.`
    :"لا يمكن تشغيل الطلبات قبل قبول أول اتفاق عمولة.";

  if(canOperate) await loadOperations();
}

onAuthStateChanged(auth,async user=>{
  currentUser=user;

  if(!projectId||!inviteAuthEmail){
    setVisible("authPanel",false);setVisible("agreementPanel",false);setVisible("operationsPanel",false);
    $("logoutBtn").classList.add("hidden");
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
    $("pageStatus").innerText="افتح الدعوة وأنشئ كلمة مرور أول مرة، أو سجل دخولك لو فعلتها قبل كده.";
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
      ?"الدعوة مفعلة بالفعل. استخدم تسجيل الدخول بنفس كلمة المرور."
      :e.message;
  }
};
$("loginBtn").onclick=async()=>{
  $("authMessage").innerText="جاري تسجيل الدخول...";
  try{
    await signInWithEmailAndPassword(auth,inviteAuthEmail,$("authPassword").value);
    $("authMessage").innerText="";
  }catch(e){$("authMessage").innerText="تعذر الدخول. راجع كلمة المرور أو تأكد أنك تستخدم نفس رابط الدعوة.";}
};
$("logoutBtn").onclick=()=>signOut(auth);

$("acceptAgreementBtn").onclick=async()=>{
  $("agreementMessage").innerText="جاري قبول الاتفاق...";
  try{await acceptPendingCommission({projectDocId:projectId,operatorAuthUid:currentUser.uid});$("agreementMessage").innerText="تم قبول العمولة ✅";await refreshAccount();}
  catch(e){$("agreementMessage").innerText=e.message;}
};
$("rejectAgreementBtn").onclick=async()=>{
  $("agreementMessage").innerText="جاري تسجيل الرفض...";
  try{await rejectPendingCommission({projectDocId:projectId,operatorAuthUid:currentUser.uid});$("agreementMessage").innerText="تم رفض العمولة. التشغيل سيظل متوقفًا لو ده أول اتفاق.";await refreshAccount();}
  catch(e){$("agreementMessage").innerText=e.message;}
};

async function loadOperations(){
  currentStore=await getSupermarket(projectId);
  currentAgreement=await getCommissionAgreement(projectId);
  $("statCommission").innerText=money(currentAgreement?.currentAmount||0);

  if(currentStore){
    $("storeTitle").innerText=currentStore.name||"السوبرماركت";
    $("settingsName").value=currentStore.name||"";
    $("settingsPhone").value=currentStore.phone||"";
    $("settingsWhatsapp").value=currentStore.whatsapp||"";
    $("settingsAddress").value=currentStore.address||"";
    $("settingsLocation").value=currentStore.location||"";
    $("settingsDeliveryFee").value=currentStore.deliveryFee??0;
    $("acceptingOrders").checked=currentStore.isAcceptingOrders===true;
    const customerUrl=new URL("../templates/supermarket/",location.href);
    customerUrl.searchParams.set("project",projectId);
    $("customerOrderLink").value=customerUrl.toString();
  }

  const productsUrl=new URL("./products.html",location.href);
  productsUrl.searchParams.set("project",projectId);
  if(inviteToken)productsUrl.searchParams.set("invite",inviteToken);
  $("productLibraryLink").href=productsUrl.toString();
  $("openProductLibraryBtn").href=productsUrl.toString();

  const [ridersResult,ordersResult]=await Promise.allSettled([loadRiders(),loadOrders()]);

  if(ridersResult.status==="rejected"){
    $("ridersList").innerHTML=`<p class="message">تعذر تحميل المندوبين: ${escapeHTML(ridersResult.reason?.message||"UNKNOWN_ERROR")}</p>`;
  }

  if(ordersResult.status==="rejected"){
    $("ordersList").innerHTML=`<p class="message">تعذر تحميل الطلبات: ${escapeHTML(ordersResult.reason?.message||"UNKNOWN_ERROR")}</p>`;
  }
  await renderOperatorFinancePanel({
    container:$("operationsPanel"),
    projectId,
    operatorUid:currentUser.uid
  });
}

$("copyCustomerLinkBtn").onclick=async()=>{
  const value=$("customerOrderLink").value;
  try{await navigator.clipboard.writeText(value);}catch{$("customerOrderLink").select();document.execCommand("copy");}
  $("settingsMessage").innerText="تم نسخ رابط العملاء ✅";
};

$("saveSettingsBtn").onclick=async()=>{
  $("settingsMessage").innerText="جاري الحفظ...";
  try{
    await updateSupermarketSettings(projectId,{
      name:$("settingsName").value,
      phone:$("settingsPhone").value,
      whatsapp:$("settingsWhatsapp").value,
      address:$("settingsAddress").value,
      location:$("settingsLocation").value,
      deliveryFee:$("settingsDeliveryFee").value,
      isAcceptingOrders:$("acceptingOrders").checked
    });
    $("settingsMessage").innerText="تم حفظ الإعدادات ✅";
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
  try{await createWorker({projectId,actorUid:currentUser.uid,name:$("riderName").value,role:WORKER_ROLES.RIDER,phone:$("riderPhone").value,whatsapp:$("riderPhone").value});$("riderName").value="";$("riderPhone").value="";$("riderMessage").innerText="تمت إضافة المندوب ✅";await loadRiders();}
  catch(e){$("riderMessage").innerText=e.message;}
};

function activeRiderOptions(selected=""){
  return riders.filter(r=>r.isActive).map(r=>`<option value="${r.workerId}" ${r.workerId===selected?"selected":""}>${escapeHTML(r.name)}</option>`).join("");
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
  if(appendHistory){
    const page=await listSupermarketHistoryPage(projectId,{pageSize:50,cursor:historyCursor});
    const known=new Set(historyOrders.map(order=>order.orderId));
    historyOrders.push(...page.orders.filter(order=>!known.has(order.orderId)));
    historyCursor=page.nextCursor;
    historyHasMore=page.hasMore;
  }else{
    const [active,page,deliveredCount]=await Promise.all([
      listSupermarketOperationalOrders(projectId),
      listSupermarketHistoryPage(projectId,{pageSize:50}),
      countSupermarketDeliveredOrders(projectId)
    ]);
    operationalOrders=active;
    historyOrders=page.orders;
    historyCursor=page.nextCursor;
    historyHasMore=page.hasMore;
    $("statDelivered").innerText=deliveredCount;
  }

  orders=mergeVisibleOrders();
  const active=operationalOrders.filter(o=>o.status!=="new").length;
  $("statNew").innerText=operationalOrders.filter(o=>o.status==="new").length;
  $("statActive").innerText=active;
  $("loadOlderOrdersBtn").classList.toggle("hidden",!historyHasMore);

  $("ordersList").innerHTML=orders.length?orders.map(o=>{
    const items=(o.items||[]).map(i=>`${Number(i.quantity||0)} × ${escapeHTML(i.name)}`).join("<br>");
    const next=allowedNextSupermarketStatuses(o.status);
    const canCancel=next.includes("canceled");
    const riderSelect=o.status==="ready"?`<select class="riderSelect"><option value="">اختر المندوب</option>${activeRiderOptions()}</select><button class="primary assignRider">تعيين وإرسال واتساب</button>`:"";
    const nextButton=o.status==="new"?'<button class="primary statusAction" data-next="accepted">قبول الطلب</button>':
      o.status==="accepted"?'<button class="primary statusAction" data-next="preparing">بدء التحضير</button>':
      o.status==="preparing"?'<button class="primary statusAction" data-next="ready">جاهز للتوصيل</button>':
      o.status==="assigned"?'<button class="primary statusAction" data-next="out_for_delivery">خرج للتوصيل</button>':
      o.status==="out_for_delivery"?'<button class="primary statusAction" data-next="delivered">تأكيد التوصيل</button>':"";
    const resend=o.assignedWorkerWhatsapp?'<button class="secondary resendWhatsapp">إعادة إرسال واتساب</button>':"";
    return `<article class="rowCard orderCard" data-order="${o.orderId}">
      <div class="rowTop"><div><b>طلب #${o.orderId.slice(0,7)}</b><div class="muted">${escapeHTML(o.customerName)} · ${escapeHTML(o.customerPhone)}</div></div><span class="pill">${statusLabel(o.status)}</span></div>
      <div class="orderItems">${items||"لا توجد تفاصيل"}</div>
      <div class="muted">${escapeHTML(o.customerAddress||"")} · الإجمالي <b>${money(o.total||o.price)}</b></div>
      ${o.assignedWorkerName?`<div class="muted">المندوب: <b>${escapeHTML(o.assignedWorkerName)}</b></div>`:""}
      <div class="orderActions">${riderSelect}${nextButton}${resend}${canCancel?'<button class="danger statusAction" data-next="canceled">إلغاء</button>':""}</div>
    </article>`;
  }).join(""):'<p class="muted">لا توجد طلبات حتى الآن.</p>';

  document.querySelectorAll(".orderCard").forEach(card=>{
    const order=orders.find(o=>o.orderId===card.dataset.order);
    card.querySelectorAll(".statusAction").forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      try{
        if(btn.dataset.next==="accepted"){
          await acceptSupermarketOrder({projectId,orderId:order.orderId,actorUid:currentUser.uid});
        }else{
          await changeSupermarketOrderStatus({projectId,orderId:order.orderId,actorUid:currentUser.uid,nextStatus:btn.dataset.next});
        }
        await loadOrders();
      }
      catch(e){alert(e.message);}finally{btn.disabled=false;}
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
          businessName:currentStore?.name||""
        });

        try{
          await changeSupermarketOrderStatus({
            projectId,
            orderId:order.orderId,
            actorUid:currentUser.uid,
            nextStatus:"assigned"
          });
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
        alert(e.message);
      }
    });

    card.querySelector(".resendWhatsapp")?.addEventListener("click",()=>{
      const worker={
        name:order.assignedWorkerName,
        whatsapp:order.assignedWorkerWhatsapp
      };
      const url=buildWorkerWhatsAppUrl({
        templateId:"supermarket",
        orderId:order.orderId,
        order,
        worker,
        businessName:currentStore?.name||""
      });
      const opened=window.open(url,"_blank","noopener");
      if(!opened) alert("المتصفح منع فتح واتساب. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.");
    });
  });
}
$("refreshOrdersBtn").onclick=()=>loadOrders();
$("loadOlderOrdersBtn").onclick=async()=>{const btn=$("loadOlderOrdersBtn");btn.disabled=true;try{await loadOrders({appendHistory:true});}finally{btn.disabled=false;}};

document.querySelectorAll(".tabs button").forEach(btn=>btn.onclick=()=>document.getElementById(btn.dataset.target)?.scrollIntoView({behavior:"smooth",block:"start"}));
