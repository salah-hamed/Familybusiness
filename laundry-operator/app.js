import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { claimOperatorAccess,getOperator,operatorCanOperate } from "../core/partners/partner-service.js";
import { acceptPendingCommission,rejectPendingCommission,getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getLaundry,updateLaundrySettings } from "../core/laundry/laundry-service.js";
import { WORKER_ROLES,createWorker,listProjectWorkers,setWorkerActive } from "../core/workers/worker-service.js";
import { assignWorkerAndPrepareWhatsApp } from "../core/workers/worker-dispatch-service.js";
import { listLaundryOrders,currentLaundryStage,allowedLaundryNextStages,changeLaundryStage } from "../core/laundry/order-service.js";

import {createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,sendEmailVerification,onAuthStateChanged,reload} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {doc,getDoc,updateDoc} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
let user=null,operator=null,agreement=null,laundry=null,workers=[],orders=[];
const money=v=>`${Number(v||0).toLocaleString("ar-EG")} جنيه`;
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const setVisible=(id,on)=>$(id).classList.toggle("hidden",!on);
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
  await reload(user);user=auth.currentUser;
  if(!user.emailVerified){setVisible("authPanel",false);setVisible("verifyPanel",true);setVisible("agreementPanel",false);setVisible("operationsPanel",false);$("pageStatus").innerText="فعّل الإيميل أولًا.";return;}

  try{await claimOperatorAccess(projectId,user);}catch(e){if(e.message!=="OPERATOR_ALREADY_CLAIMED"){$("pageStatus").innerText=`تعذر ربط الحساب: ${e.message}`;return;}}
  operator=await getOperator(projectId);agreement=await getCommissionAgreement(projectId);laundry=await getLaundry(projectId);
  setVisible("authPanel",false);setVisible("verifyPanel",false);$("logoutBtn").classList.remove("hidden");
  const pending=agreement?.pendingStatus==="pending"&&agreement?.pendingAmount!=null;
  setVisible("agreementPanel",pending);
  if(pending){$("agreementText").innerText=`${agreement.currentAmount!=null?`العمولة الحالية ${money(agreement.currentAmount)} — المقترح الجديد`:"العمولة المقترحة"}: ${money(agreement.pendingAmount)} لكل طلب مكتمل`;}
  const canOperate=operatorCanOperate(operator)&&agreement?.status==="accepted"&&agreement?.currentAmount!=null;
  setVisible("operationsPanel",canOperate);
  $("pageStatus").innerText=canOperate?`مرحبًا ${operator?.name||"بالمغسلة"} — التشغيل جاهز.`:"التشغيل متوقف لحد قبول أول اتفاق عمولة.";
  if(canOperate)await loadOperations();
}

onAuthStateChanged(auth,current=>{user=current;if(!current){setVisible("authPanel",true);setVisible("verifyPanel",false);setVisible("agreementPanel",false);setVisible("operationsPanel",false);$("logoutBtn").classList.add("hidden");return;}refreshAccount();});
$("registerBtn").onclick=async()=>{try{const c=await createUserWithEmailAndPassword(auth,$("authEmail").value.trim().toLowerCase(),$("authPassword").value);await sendEmailVerification(c.user);$("authMessage").innerText="تم إنشاء الحساب. فعّل الإيميل ثم ارجع هنا ✅";}catch(e){$("authMessage").innerText=e.message;}};
$("loginBtn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,$("authEmail").value.trim().toLowerCase(),$("authPassword").value);}catch(e){$("authMessage").innerText=e.message;}};
$("logoutBtn").onclick=()=>signOut(auth);
$("resendVerifyBtn").onclick=async()=>{if(auth.currentUser){await sendEmailVerification(auth.currentUser);$("verifyMessage").innerText="تم إرسال رسالة جديدة.";}};$("checkVerifyBtn").onclick=refreshAccount;
$("acceptAgreementBtn").onclick=async()=>{try{await acceptPendingCommission({projectDocId:projectId,operatorAuthUid:user.uid});await refreshAccount();}catch(e){$("agreementMessage").innerText=e.message;}};
$("rejectAgreementBtn").onclick=async()=>{try{await rejectPendingCommission({projectDocId:projectId,operatorAuthUid:user.uid});await refreshAccount();}catch(e){$("agreementMessage").innerText=e.message;}};

async function loadOperations(){
  laundry=await getLaundry(projectId);agreement=await getCommissionAgreement(projectId);
  $("laundryTitle").innerText=laundry?.name||operator?.name||"المغسلة";$("statCommission").innerText=money(agreement?.currentAmount||0);
  $("settingsName").value=laundry?.name||"";$("settingsPhone").value=laundry?.phone||"";$("settingsWhatsapp").value=laundry?.whatsapp||"";$("settingsAddress").value=laundry?.address||"";$("settingsLocation").value=laundry?.location||"";$("acceptingOrders").checked=laundry?.isAcceptingOrders===true;
  const url=new URL("../templates/laundry/",location.href);url.searchParams.set("project",projectId);$("customerOrderLink").value=url;
  const projectSnap=await getDoc(doc(db,"projects",projectId));renderPricing(projectSnap.data()?.priceConfig||{});
  await Promise.all([loadWorkers(),loadOrders()]);
}
$("saveSettingsBtn").onclick=async()=>{try{await updateLaundrySettings(projectId,{name:$("settingsName").value,phone:$("settingsPhone").value,whatsapp:$("settingsWhatsapp").value,address:$("settingsAddress").value,location:$("settingsLocation").value,isAcceptingOrders:$("acceptingOrders").checked});$("settingsMessage").innerText="تم الحفظ ✅";}catch(e){$("settingsMessage").innerText=e.message;}};
$("copyCustomerLinkBtn").onclick=async()=>{try{await navigator.clipboard.writeText($("customerOrderLink").value);}catch{$("customerOrderLink").select();document.execCommand("copy");}$("settingsMessage").innerText="تم نسخ رابط العملاء ✅";};
$("savePricingBtn").onclick=async()=>{const config={};document.querySelectorAll("[data-price]").forEach(i=>config[i.dataset.price]=Number(i.value));if(Object.values(config).some(v=>!Number.isFinite(v)||v<0)){$("pricingMessage").innerText="راجع الأسعار.";return;}try{await updateDoc(doc(db,"projects",projectId),{priceConfig:config});$("pricingMessage").innerText="تم حفظ الأسعار ✅";}catch(e){$("pricingMessage").innerText=e.message;}};

async function loadWorkers(){
  workers=await listProjectWorkers(projectId,{activeOnly:false});
  $("workersList").innerHTML=workers.length?workers.map(w=>`<article class="rowCard"><div class="rowTop"><div><b>${esc(w.name)}</b><div class="muted">${w.role==="pickup_agent"?"استلام":"توصيل"} · ${esc(w.whatsapp)}</div></div><span class="pill">${w.isActive?"نشط":"متوقف"}</span></div><button class="secondary toggleWorker" data-worker="${w.workerId}">${w.isActive?"إيقاف":"تفعيل"}</button></article>`).join(""):'<p class="muted">أضف أول مندوب استلام أو توصيل.</p>';
  document.querySelectorAll(".toggleWorker").forEach(btn=>btn.onclick=async()=>{const w=workers.find(x=>x.workerId===btn.dataset.worker);await setWorkerActive({workerId:w.workerId,projectId,actorUid:user.uid,isActive:!w.isActive});await loadWorkers();});
}
$("addWorkerBtn").onclick=async()=>{try{await createWorker({projectId,actorUid:user.uid,name:$("workerName").value,whatsapp:$("workerWhatsapp").value,role:$("workerRole").value});$("workerName").value="";$("workerWhatsapp").value="";$("workerMessage").innerText="تمت الإضافة ✅";await loadWorkers();}catch(e){$("workerMessage").innerText=e.message;}};

function itemSummary(order){return (order.items||[]).filter(x=>Number(x.quantity||0)>0).map(x=>`${Number(x.quantity)} × ${esc(x.label||x.key)} — ${esc(x.serviceLabel||x.service)}`).join("<br>");}
function workerSelect(role,orderId){const list=workers.filter(w=>w.isActive&&w.role===role);return `<select data-worker-select="${orderId}"><option value="">اختر العامل</option>${list.map(w=>`<option value="${w.workerId}">${esc(w.name)}</option>`).join("")}</select>`;}
async function assignAndDispatch(order,role,nextStage){
  const select=document.querySelector(`[data-worker-select="${order.orderId}"]`);const workerId=select?.value;if(!workerId){alert("اختار العامل أولًا");return;}
  try{
    const result=await assignWorkerAndPrepareWhatsApp({projectId,orderId:order.orderId,workerId,actorUid:user.uid});
    await changeLaundryStage({projectId,orderId:order.orderId,actorUid:user.uid,nextStage});
    window.open(result.whatsappUrl,"_blank","noopener");await loadOrders();
  }catch(e){alert(e.message);}
}

async function loadOrders(){
  orders=await listLaundryOrders(projectId);
  let newCount=0,activeCount=0,doneCount=0;
  orders.forEach(o=>{const s=currentLaundryStage(o);if(s==="new")newCount++;else if(s==="delivered")doneCount++;else if(s!=="canceled")activeCount++;});
  $("statNew").innerText=newCount;$("statActive").innerText=activeCount;$("statDone").innerText=doneCount;
  $("ordersList").innerHTML=orders.length?orders.map(order=>{
    const stage=currentLaundryStage(order),next=allowedLaundryNextStages(order);let controls="";
    if(stage==="new")controls+='<button class="primary stageBtn" data-stage="accepted">قبول الطلب</button>';
    if(stage==="accepted")controls+=workerSelect("pickup_agent",order.orderId)+'<button class="primary pickupBtn">تعيين الاستلام + واتساب</button>';
    if(stage==="pickup_assigned")controls+='<button class="primary stageBtn" data-stage="picked_up">تم الاستلام</button>';
    if(stage==="picked_up")controls+='<button class="primary stageBtn" data-stage="processing">بدء التجهيز</button>';
    if(stage==="processing")controls+='<button class="primary stageBtn" data-stage="ready_delivery">جاهز للتوصيل</button>';
    if(stage==="ready_delivery")controls+=workerSelect("delivery_agent",order.orderId)+'<button class="primary deliveryBtn">تعيين التوصيل + واتساب</button>';
    if(stage==="out_for_delivery")controls+='<button class="primary stageBtn" data-stage="delivered">تم التوصيل</button>';
    if(next.includes("canceled"))controls+='<button class="danger stageBtn" data-stage="canceled">إلغاء</button>';
    return `<article class="orderCard" data-order="${order.orderId}"><div class="orderTop"><div><b>${esc(order.customerName||"عميل")}</b><div class="muted">${esc(order.customerPhone||"")} · ${esc(order.customerAddress||"")}</div></div><span class="pill">${stageLabel(stage)}</span></div><div class="orderItems">${itemSummary(order)}</div><b>${money(order.price)}</b><div class="orderActions">${controls}</div></article>`;
  }).join(""):'<p class="muted">لا توجد طلبات بعد.</p>';

  document.querySelectorAll(".orderCard").forEach(card=>{
    const order=orders.find(o=>o.orderId===card.dataset.order);
    card.querySelectorAll(".stageBtn").forEach(btn=>btn.onclick=async()=>{try{await changeLaundryStage({projectId,orderId:order.orderId,actorUid:user.uid,nextStage:btn.dataset.stage});await loadOrders();}catch(e){alert(e.message);}});
    card.querySelector(".pickupBtn")?.addEventListener("click",()=>assignAndDispatch(order,"pickup_agent","pickup_assigned"));
    card.querySelector(".deliveryBtn")?.addEventListener("click",()=>assignAndDispatch(order,"delivery_agent","out_for_delivery"));
  });
}
$("refreshOrdersBtn").onclick=loadOrders;
