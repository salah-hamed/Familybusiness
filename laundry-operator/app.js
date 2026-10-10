import auth from "../core/firebase/firebase-auth.js";
import { friendlyOperatorError } from "../core/operators/operator-errors.js";
import db from "../core/firebase/firebase-db.js";
import { claimOperatorAccess,getOperator,operatorCanOperate,buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { acceptPendingCommission,rejectPendingCommission,getCommissionAgreement } from "../core/commissions/commission-service.js";
import { renderOperatorFinancePanel } from "../core/commissions/finance-panel.js";
import { requestCommissionReversal } from "../core/commissions/reversal-service.js";
import { getLaundry,updateLaundrySettings } from "../core/laundry/laundry-service.js";
import { WORKER_ROLES,createWorker,listProjectWorkers,setWorkerActive } from "../core/workers/worker-service.js";
import { assignWorkerAndPrepareWhatsApp, rollbackPreparedAssignment } from "../core/workers/worker-dispatch-service.js";
import { buildWorkerWhatsAppUrl, openWhatsAppPlaceholder, navigatePreparedWhatsAppWindow } from "../core/whatsapp/dispatch-service.js";
import { listLaundryOperationalOrders,listLaundryHistoryPage,countLaundryDeliveredOrders,currentLaundryStage,allowedLaundryNextStages,changeLaundryStage } from "../core/laundry/order-service.js";
import { getOrderOperationalAlert, summarizeOperationalAlerts } from "../core/orders/operational-alerts.js";
import { createGuide } from "../core/onboarding/guide.js";
import { buildOperatorGuide } from "../core/onboarding/guide-state.js";

import {createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {doc,getDoc,updateDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { renderCustomerQr } from "../core/qr/customer-qr.js?v=20261010-operator-qr2";

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const projectId=params.get("project")||"";
const inviteToken=params.get("invite")||"";
const inviteAuthEmail=buildOperatorAuthEmail(inviteToken);
let user=null,operator=null,agreement=null,laundry=null,workers=[],orders=[];
let operationalOrders=[],historyOrders=[],historyCursor=null,historyHasMore=false;
let operatorGuide=null,currentPriceConfig={};
function refreshOperatorFirstRunGuide({autoOpen=false}={}){
  const activePickup=workers.some(w=>w.isActive===true&&w.role==="pickup_agent");
  const activeDelivery=workers.some(w=>w.isActive===true&&w.role==="delivery_agent");
  const contentReady=Object.values(currentPriceConfig||{}).some(value=>Number(value)>0);
  const journey=buildOperatorGuide({
    templateId:"laundry",
    partner:laundry||{},
    contentReady,
    teamReady:activePickup&&activeDelivery
  });
  if(operatorGuide)operatorGuide.update(journey,{autoOpen});
  else operatorGuide=createGuide(journey,{autoOpen:true});
}

const money=v=>`${Number(v||0).toLocaleString("ar-EG")} جنيه`;
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const setVisible=(id,on)=>$(id).classList.toggle("hidden",!on);
const operatorAccessErrorMessage=error=>
  friendlyOperatorError(error,"تعذر فتح لوحة التشغيل. حاول تحديث الصفحة أو اطلب رابط دعوة جديد.");
const stageLabel=s=>({new:"جديد",accepted:"مقبول",pickup_assigned:"تم تعيين الاستلام",picked_up:"تم الاستلام",processing:"جاري التجهيز",ready_delivery:"جاهز للتوصيل",out_for_delivery:"خرج للتوصيل",delivered:"تم التوصيل",canceled:"ملغي"})[s]||s;

const pricing=[
 ["shirt","قميص","shirtWash","shirtIron"],["trousers","بنطلون","trousersWash","trousersIron"],
 ["tshirt","تيشيرت","tshirtWash","tshirtIron"],["dress","فستان / عباية","dressWash","dressIron"],
 ["galabeya","جلابية","galabeyaWash","galabeyaIron"],["suit","بدلة","suitWash","suitIron"],
 ["shoes","كوتشي","shoesWash",null]
];

function renderPricing(config={}){
  $("pricingGrid").innerHTML=pricing.map(([key,label,wash,iron])=>`<div class="priceGroup"><h4>${label}</h4><div class="pricePair"><label>غسيل<input type="number" min="0" step="0.5" data-price="${wash}" value="${Number(config[wash]??0)}"></label>${iron?`<label>مكواة<input type="number" min="0" step="0.5" data-price="${iron}" value="${Number(config[iron]??0)}"></label>`:""}</div></div>`).join("");
}

async function refreshAccount(){
  if(!user)return;
  if(!projectId){$("pageStatus").innerText="الرابط غير مكتمل.";return;}
  try{await claimOperatorAccess(projectId,user);}catch(e){$("pageStatus").innerText=operatorAccessErrorMessage(e);setVisible("operationsPanel",false);return;}
  operator=await getOperator(projectId);agreement=await getCommissionAgreement(projectId);laundry=await getLaundry(projectId);
  setVisible("authPanel",false);$("logoutBtn").classList.remove("hidden");
  const pending=agreement?.pendingStatus==="pending"&&agreement?.pendingAmount!=null;
  setVisible("agreementPanel",pending);
  if(pending){$("agreementText").innerText=`${agreement.currentAmount!=null?`العمولة الحالية ${money(agreement.currentAmount)} — المقترح الجديد`:"العمولة المقترحة"}: ${money(agreement.pendingAmount)} لكل طلب يتم إرساله للتوصيل`;}
  const canOperate=operatorCanOperate(operator)&&agreement?.status==="accepted"&&agreement?.currentAmount!=null;
  setVisible("operationsPanel",canOperate);
  $("pageStatus").innerText=canOperate?`مرحبًا ${operator?.name||"بالمغسلة"} — التشغيل جاهز.`:"التشغيل متوقف لحد قبول أول اتفاق عمولة.";
  if(canOperate) await loadOperations();
}

onAuthStateChanged(auth,async current=>{user=current;if(!projectId||!inviteAuthEmail){setVisible("authPanel",false);setVisible("agreementPanel",false);setVisible("operationsPanel",false);$("logoutBtn").classList.add("hidden");$("pageStatus").innerText="دعوة واتساب غير مكتملة أو غير صالحة.";return;}if(current&&String(current.email||"").toLowerCase()!==inviteAuthEmail.toLowerCase()){await signOut(auth);return;}if(!current){setVisible("authPanel",true);setVisible("agreementPanel",false);setVisible("operationsPanel",false);$("logoutBtn").classList.add("hidden");$("pageStatus").innerText="فعّل الدعوة بكلمة مرور أول مرة، أو سجل دخولك لو فعلتها قبل كده.";return;}refreshAccount();});
$("registerBtn").onclick=async()=>{try{await createUserWithEmailAndPassword(auth,inviteAuthEmail,$("authPassword").value);$("authMessage").innerText="تم تفعيل الدعوة ✅";}catch(e){$("authMessage").innerText=e.code==="auth/email-already-in-use"?"الدعوة مفعلة بالفعل. استخدم تسجيل الدخول بنفس كلمة المرور.":friendlyOperatorError(e,"تعذر تفعيل الدعوة. راجع كلمة المرور وحاول مرة أخرى.");}};
$("loginBtn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,inviteAuthEmail,$("authPassword").value);$("authMessage").innerText="";}catch(e){$("authMessage").innerText="تعذر الدخول. راجع كلمة المرور أو تأكد أنك تستخدم نفس رابط الدعوة.";}};
$("logoutBtn").onclick=()=>signOut(auth);
$("acceptAgreementBtn").onclick=async()=>{try{await acceptPendingCommission({projectDocId:projectId,operatorAuthUid:user.uid});await refreshAccount();}catch(e){$("agreementMessage").innerText=friendlyOperatorError(e,"تعذر تحديث اتفاق العمولة.");}};
$("rejectAgreementBtn").onclick=async()=>{try{await rejectPendingCommission({projectDocId:projectId,operatorAuthUid:user.uid});await refreshAccount();}catch(e){$("agreementMessage").innerText=friendlyOperatorError(e,"تعذر تحديث اتفاق العمولة.");}};

async function loadOperations(){
  laundry=await getLaundry(projectId);agreement=await getCommissionAgreement(projectId);
  $("laundryTitle").innerText=laundry?.name||operator?.name||"المغسلة";$("statCommission").innerText=money(agreement?.currentAmount||0);
  $("settingsName").value=laundry?.name||"";$("settingsPhone").value=laundry?.phone||"";$("settingsWhatsapp").value=laundry?.whatsapp||"";$("settingsAddress").value=laundry?.address||"";$("settingsLocation").value=laundry?.location||"";$("settingsInstapay").value=laundry?.instapayLink||"";$("acceptingOrders").checked=laundry?.isAcceptingOrders===true;
  const url=new URL("../templates/laundry/",location.href);url.searchParams.set("project",projectId);$("customerOrderLink").value=url.toString();renderCustomerQr({inputId:"customerOrderLink",mountId:"operatorCustomerQrMount",projectName:laundry?.name||operator?.name||"المغسلة"});
  const projectSnap=await getDoc(doc(db,"projects",projectId));currentPriceConfig=projectSnap.data()?.priceConfig||{};renderPricing(currentPriceConfig);
  await Promise.all([loadWorkers(),loadOrders()]);
  await renderOperatorFinancePanel({
    container:$("operationsPanel"),
    projectId,
    operatorUid:user.uid
  });
  refreshOperatorFirstRunGuide({autoOpen:true});
}
$("saveSettingsBtn").onclick=async()=>{try{await updateLaundrySettings(projectId,{name:$("settingsName").value,phone:$("settingsPhone").value,whatsapp:$("settingsWhatsapp").value,address:$("settingsAddress").value,location:$("settingsLocation").value,instapayLink:$("settingsInstapay").value,isAcceptingOrders:$("acceptingOrders").checked});$("settingsMessage").innerText="تم الحفظ ✅";laundry=await getLaundry(projectId);refreshOperatorFirstRunGuide();}catch(e){$("settingsMessage").innerText=friendlyOperatorError(e,"تعذر حفظ الإعدادات. راجع البيانات وحاول مرة أخرى.");}};
$("copyCustomerLinkBtn").onclick=async()=>{try{await navigator.clipboard.writeText($("customerOrderLink").value);}catch{$("customerOrderLink").select();document.execCommand("copy");}$("settingsMessage").innerText="تم نسخ رابط العملاء ✅";};
$("savePricingBtn").onclick=async()=>{const config={};document.querySelectorAll("[data-price]").forEach(i=>config[i.dataset.price]=Number(i.value));if(Object.values(config).some(v=>!Number.isFinite(v)||v<0)){$("pricingMessage").innerText="راجع الأسعار.";return;}try{await updateDoc(doc(db,"projects",projectId),{priceConfig:config});currentPriceConfig=config;$("pricingMessage").innerText="تم حفظ الأسعار ✅";refreshOperatorFirstRunGuide();}catch(e){$("pricingMessage").innerText=friendlyOperatorError(e,"تعذر حفظ الأسعار. حاول مرة أخرى.");}};

async function loadWorkers(){
  workers=await listProjectWorkers(projectId,{activeOnly:false});
  $("workersList").innerHTML=workers.length?workers.map(w=>`<article class="rowCard"><div class="rowTop"><div><b>${esc(w.name)}</b><div class="muted">${w.role==="pickup_agent"?"استلام":"توصيل"} · ${esc(w.whatsapp)}</div></div><span class="pill">${w.isActive?"نشط":"متوقف"}</span></div><button class="secondary toggleWorker" data-worker="${w.workerId}">${w.isActive?"إيقاف":"تفعيل"}</button></article>`).join(""):'<p class="muted">أضف أول مندوب استلام أو توصيل.</p>';
  document.querySelectorAll(".toggleWorker").forEach(btn=>btn.onclick=async()=>{const w=workers.find(x=>x.workerId===btn.dataset.worker);await setWorkerActive({workerId:w.workerId,projectId,actorUid:user.uid,isActive:!w.isActive});await loadWorkers();});
  if(operatorGuide)refreshOperatorFirstRunGuide();
}
$("addWorkerBtn").onclick=async()=>{try{await createWorker({projectId,actorUid:user.uid,name:$("workerName").value,whatsapp:$("workerWhatsapp").value,role:$("workerRole").value});$("workerName").value="";$("workerWhatsapp").value="";$("workerMessage").innerText="تمت الإضافة ✅";await loadWorkers();}catch(e){$("workerMessage").innerText=friendlyOperatorError(e,"تعذر تحديث العامل. راجع البيانات وحاول مرة أخرى.");}};

function itemSummary(order){return (order.items||[]).filter(x=>Number(x.quantity||0)>0).map(x=>`${Number(x.quantity)} × ${esc(x.label||x.key)} — ${esc(x.serviceLabel||x.service)}`).join("<br>");}
function workerSelect(role,orderId){const list=workers.filter(w=>w.isActive&&w.role===role);return `<select data-worker-select="${orderId}"><option value="">اختر العامل</option>${list.map(w=>`<option value="${w.workerId}">${esc(w.name)}</option>`).join("")}</select>`;}

function reversalReasonOptions(){
  return `
    <option value="customer_canceled_after_dispatch">العميل ألغى بعد الإرسال</option>
    <option value="delivery_failed">تعذر التوصيل</option>
    <option value="duplicate_order">طلب مكرر</option>
    <option value="operator_error">خطأ تشغيلي</option>
    <option value="other">سبب آخر</option>
  `;
}
function reversalErrorMessage(error){
  if(error?.message==="REVERSAL_ALREADY_EXISTS")return "تم إرسال طلب عكس العمولة لهذا الأوردر بالفعل.";
  if(error?.message==="REVERSAL_EXCEEDS_OUTSTANDING")return "لا يمكن عكس العمولة لأن الرصيد المستحق الحالي أقل من قيمة العمولة.";
  return error?.message||"تعذر إرسال طلب عكس العمولة.";
}
async function assignAndDispatch(order,role,nextStage){
  const select=document.querySelector(`[data-worker-select="${order.orderId}"]`);
  const workerId=select?.value;
  if(!workerId){alert("اختار العامل أولًا");return;}

  const popup=openWhatsAppPlaceholder();

  try{
    const result=await assignWorkerAndPrepareWhatsApp({
      projectId,
      orderId:order.orderId,
      workerId,
      actorUid:user.uid,
      businessName:laundry?.name||""
    });

    try{
      await changeLaundryStage({
        projectId,
        orderId:order.orderId,
        actorUid:user.uid,
        nextStage
      });
    }catch(stageError){
      await rollbackPreparedAssignment({
        projectId,
        orderId:order.orderId,
        actorUid:user.uid
      });
      throw stageError;
    }

    const opened=navigatePreparedWhatsAppWindow(popup,result.whatsappUrl);
    await loadOrders();

    if(!opened){
      alert("تم تعيين المندوب وتحديث الطلب، لكن المتصفح منع فتح واتساب. اضغط «إعادة إرسال واتساب» من الطلب.");
    }
  }catch(e){
    try{popup?.close();}catch{}
    alert(friendlyOperatorError(e,"تعذر تنفيذ الإجراء على الطلب. حدّث الطلبات وحاول مرة أخرى."));
  }
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
    const page=await listLaundryHistoryPage(projectId,{pageSize:50,cursor:historyCursor});
    const known=new Set(historyOrders.map(order=>order.orderId));
    historyOrders.push(...page.orders.filter(order=>!known.has(order.orderId)));
    historyCursor=page.nextCursor;
    historyHasMore=page.hasMore;
  }else{
    const [active,page,deliveredCount]=await Promise.all([
      listLaundryOperationalOrders(projectId),
      listLaundryHistoryPage(projectId,{pageSize:50}),
      countLaundryDeliveredOrders(projectId)
    ]);
    operationalOrders=active;
    historyOrders=page.orders;
    historyCursor=page.nextCursor;
    historyHasMore=page.hasMore;
    $("statDone").innerText=deliveredCount;
  }

  orders=mergeVisibleOrders();
  let newCount=0,activeCount=0;
  operationalOrders.forEach(o=>{const s=currentLaundryStage(o);if(s==="new")newCount++;else if(s!=="canceled")activeCount++;});
  $("statNew").innerText=newCount;$("statActive").innerText=activeCount;
  $("loadOlderOrdersBtn").classList.toggle("hidden",!historyHasMore);
  const alerts=operationalOrders.map(order=>getOrderOperationalAlert(order)).filter(Boolean);
  $("ordersMessage").innerText=summarizeOperationalAlerts(alerts);
  $("ordersList").innerHTML=orders.length?orders.map(order=>{
    const stage=currentLaundryStage(order),next=allowedLaundryNextStages(order);let controls="";
    if(stage==="new")controls+='<button class="primary stageBtn" data-stage="accepted">قبول الطلب</button>';
    if(stage==="accepted")controls+=workerSelect("pickup_agent",order.orderId)+'<button class="primary pickupBtn">تعيين الاستلام + واتساب</button>';
    if(stage==="pickup_assigned")controls+='<button class="primary stageBtn" data-stage="picked_up">تم الاستلام</button>';
    if(stage==="picked_up")controls+='<button class="primary stageBtn" data-stage="processing">بدء التجهيز</button>';
    if(stage==="processing")controls+='<button class="primary stageBtn" data-stage="ready_delivery">جاهز للتوصيل</button>';
    if(stage==="ready_delivery")controls+=workerSelect("delivery_agent",order.orderId)+'<button class="primary deliveryBtn">تعيين التوصيل + واتساب</button>';
    if(stage==="out_for_delivery")controls+='<button class="primary stageBtn" data-stage="delivered">تم التوصيل</button>';
    if(order.assignedWorkerWhatsapp&&["pickup_assigned","out_for_delivery"].includes(stage))controls+='<button class="secondary resendWhatsapp">إعادة إرسال واتساب</button>';
    if(order.status==="canceled"&&order.commissionLocked===true)controls+=`<select class="reversalReasonSelect">${reversalReasonOptions()}</select><button class="secondary requestReversal">طلب عكس العمولة</button>`;
    if(next.includes("canceled"))controls+='<button class="danger stageBtn" data-stage="canceled">إلغاء</button>';
    return `<article class="orderCard" data-order="${order.orderId}"><div class="orderTop"><div><b>${esc(order.customerName||"عميل")}</b><div class="muted">${esc(order.customerPhone||"")} · ${esc(order.customerAddress||"")}</div></div><span class="pill">${stageLabel(stage)}</span></div>${getOrderOperationalAlert(order)?`<div class="message">${esc(getOrderOperationalAlert(order).message)}</div>`:""}<div class="orderItems">${itemSummary(order)}</div><b>${money(order.price)}</b><div class="orderActions">${controls}</div></article>`;
  }).join(""):'<p class="muted">لا توجد طلبات بعد.</p>';

  document.querySelectorAll(".orderCard").forEach(card=>{
    const order=orders.find(o=>o.orderId===card.dataset.order);
    card.querySelectorAll(".stageBtn").forEach(btn=>btn.onclick=async()=>{try{await changeLaundryStage({projectId,orderId:order.orderId,actorUid:user.uid,nextStage:btn.dataset.stage});await loadOrders();}catch(e){alert(friendlyOperatorError(e,"تعذر تنفيذ الإجراء على الطلب. حدّث الطلبات وحاول مرة أخرى."));}});
    card.querySelector(".pickupBtn")?.addEventListener("click",()=>assignAndDispatch(order,"pickup_agent","pickup_assigned"));
    card.querySelector(".deliveryBtn")?.addEventListener("click",()=>assignAndDispatch(order,"delivery_agent","out_for_delivery"));
    card.querySelector(".requestReversal")?.addEventListener("click",async()=>{
      const button=card.querySelector(".requestReversal");
      const reasonCode=card.querySelector(".reversalReasonSelect")?.value||"other";
      button.disabled=true;
      try{
        await requestCommissionReversal({
          projectId,
          orderId:order.orderId,
          operatorUid:user.uid,
          reasonCode
        });
        alert("تم إرسال طلب عكس العمولة لصاحب المشروع للمراجعة.");
        await renderOperatorFinancePanel({
          container:$("operationsPanel"),
          projectId,
          operatorUid:user.uid
        });
      }catch(e){
        alert(reversalErrorMessage(e));
      }finally{
        button.disabled=false;
      }
    });

    card.querySelector(".resendWhatsapp")?.addEventListener("click",()=>{
      const worker={
        name:order.assignedWorkerName,
        whatsapp:order.assignedWorkerWhatsapp
      };
      const url=buildWorkerWhatsAppUrl({
        templateId:"laundry",
        orderId:order.orderId,
        order,
        worker,
        businessName:laundry?.name||""
      });
      const opened=window.open(url,"_blank","noopener");
      if(!opened)alert("المتصفح منع فتح واتساب. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.");
    });
  });
}
$("refreshOrdersBtn").onclick=()=>loadOrders();
$("loadOlderOrdersBtn").onclick=async()=>{const btn=$("loadOlderOrdersBtn");btn.disabled=true;try{await loadOrders({appendHistory:true});}finally{btn.disabled=false;}};
