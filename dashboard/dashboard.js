import { protectPage } from "../core/auth/auth-guard.js";
import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { logoutUser } from "../core/auth/auth.js";
import { loadCurrentProject } from "./project.js";
import { getDashboardTemplate, getTemplateKey } from "./template-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let stats = { new: 0, accepted: 0, done: 0, canceled: 0 };
let currentUser = null, currentProjectId = null, currentProjectOwnerId = null, currentTemplateKey = "cleaning";
let isAuthReady = false, activeTab = "all", searchTerm = "";

const $ = id => document.getElementById(id);
const userName = $("userName"), userEmail = $("userEmail"), projectType = $("projectType"), status = $("status");
const projectLink = $("projectLink"), businessName = $("businessName"), whatsappNumber = $("whatsappNumber"), instapayLink = $("instapayLink"), ordersSearch = $("ordersSearch");

function normalizeArabicNumbers(value) { return String(value).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)); }
function escapeHTML(value) { return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }
function cleanPhone(value) { const d=String(value||"").replace(/\D/g,""); if(!d)return ""; if(d.startsWith("20"))return d; if(d.startsWith("0"))return `20${d.slice(1)}`; return `20${d}`; }
function scrollToSection(id) { $(id)?.scrollIntoView({behavior:"smooth",block:"start"}); }

function configureDashboard(project) {
  currentTemplateKey = getTemplateKey(project);
  const config = getDashboardTemplate(project);
  projectType.innerText = `المشروع: ${config.label}`;
  const todayLabel = $("todayOrders")?.closest("article")?.querySelector(".statLabel");
  if (todayLabel) todayLabel.innerText = config.todayLabel;

  const allowedIds = new Set(config.pricing.map(([id]) => id));
  ["basePrice","roomPrice","bathroomPrice","kitchenPrice","stairsPrice"].forEach(id => {
    const input = $(id); if (!input) return;
    const label = input.closest("label");
    if (label) label.style.display = allowedIds.has(id) ? "" : "none";
  });
  config.pricing.forEach(([id,label]) => { const input=$(id); const span=input?.closest("label")?.querySelector("span"); if(span) span.innerText=label; });

  if (currentTemplateKey === "carwash") {
    const theme = $("creativeTheme")?.querySelector('option[value="cleanPro"]');
    if (theme) theme.textContent = "غسيل سيارات احترافي — صورة في إطار";
    if ($("creativeHeadline")) $("creativeHeadline").value = config.marketing.headline;
  }
}

protectPage();
onAuthStateChanged(auth, async user => {
  currentUser=user||null; isAuthReady=!!user; if(!user)return;
  try {
    const result=await loadCurrentProject(user.uid);
    if(!result.success){ currentProjectId=null; currentProjectOwnerId=null; userName.innerText=result.reason==="access-denied"?"غير مسموح لك بإدارة هذا المشروع":"لم يتم العثور على المشروع"; status.innerText=result.reason==="access-denied"?"تم رفض الوصول إلى المشروع.":"تحقق من رابط المشروع وحاول مرة أخرى."; ["projectLink","copyLinkBtn","openProjectBtn","shareProjectBtn"].forEach(id=>{if($(id))$(id).style.display="none";}); return; }
    const data=result.project; currentProjectId=result.projectDocId; currentProjectOwnerId=data.ownerId;
    if(!data.isActive){ ["projectLink","copyLinkBtn","openProjectBtn","shareProjectBtn"].forEach(id=>{if($(id))$(id).style.display="none";}); status.innerText="⏳ المشروع غير مفعل"; return; }
    userName.innerText=data.businessName||"مشروعك"; userEmail.innerText=""; status.innerText="● نشط"; configureDashboard(data);
    projectLink.value=`${window.location.origin}/Familybusiness/templates/${data.template}/?project=${currentProjectId}`;
    businessName.value=data.businessName||""; whatsappNumber.value=data.whatsappNumber||""; instapayLink.value=data.instapayLink||"";
    const pc=data.priceConfig||{}; $("basePrice").value=pc.base??""; $("roomPrice").value=pc.room??""; $("bathroomPrice").value=pc.bathroom??""; $("kitchenPrice").value=pc.kitchen??""; $("stairsPrice").value=pc.stairs??"";
    await loadOrders(currentProjectId);
  } catch(error){ console.log(error); }
});

$("logoutBtn").addEventListener("click",async()=>{await logoutUser();window.location.href="/Familybusiness/";});
$("copyLinkBtn").addEventListener("click",async()=>{await navigator.clipboard.writeText(projectLink.value);$("copyStatus").innerText="تم نسخ الرابط ✅";});
$("openProjectBtn").addEventListener("click",()=>{if(projectLink.value)window.open(projectLink.value,"_blank","noopener");});
$("shareProjectBtn").addEventListener("click",async()=>{if(!projectLink.value)return;const text=`احجز خدمتك من ${businessName.value||"مشروعي"}`;if(navigator.share){try{await navigator.share({title:businessName.value||"مشروعي",text,url:projectLink.value});return;}catch(e){if(e.name==="AbortError")return;}}window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${projectLink.value}`)}`,"_blank","noopener");});
document.querySelectorAll(".navItem[data-target]").forEach(item=>item.addEventListener("click",()=>{document.querySelectorAll(".navItem").forEach(n=>n.classList.remove("active"));item.classList.add("active");scrollToSection(item.dataset.target);}));

$("saveSettingsBtn").addEventListener("click",async()=>{try{if(!isAuthReady||!currentUser||!currentProjectId||currentProjectOwnerId!==currentUser.uid)return;await updateDoc(doc(db,"projects",currentProjectId),{businessName:businessName.value.trim(),whatsappNumber:whatsappNumber.value.trim(),instapayLink:instapayLink.value.trim()});userName.innerText=businessName.value.trim()||"مشروعك";$("settingsStatus").innerText="تم حفظ الإعدادات ✅";}catch(e){$("settingsStatus").innerText=e.message;}});

$("savePricingBtn").addEventListener("click",async()=>{try{if(!isAuthReady||!currentUser||!currentProjectId||currentProjectOwnerId!==currentUser.uid)return;let priceConfig;if(currentTemplateKey==="carwash"){priceConfig={base:Number(normalizeArabicNumbers($("basePrice").value))};}else{priceConfig={base:Number(normalizeArabicNumbers($("basePrice").value)),room:Number(normalizeArabicNumbers($("roomPrice").value)),bathroom:Number(normalizeArabicNumbers($("bathroomPrice").value)),kitchen:Number(normalizeArabicNumbers($("kitchenPrice").value)),stairs:Number(normalizeArabicNumbers($("stairsPrice").value))};}await updateDoc(doc(db,"projects",currentProjectId),{priceConfig});$("pricingStatus").innerText="تم حفظ الأسعار ✅";}catch(e){$("pricingStatus").innerText=e.message;}});

async function updateOrderStatus(orderId,projectId,nextStatus){if(!isAuthReady||!currentUser||!currentProjectId||currentProjectOwnerId!==currentUser.uid||projectId!==currentProjectId)return false;const ref=doc(db,"orders",orderId),snap=await getDoc(ref);if(!snap.exists()||snap.data().projectId!==currentProjectId)return false;await updateDoc(ref,{status:nextStatus});return true;}
function refreshOrderVisibility(){document.querySelectorAll("#ordersContainer .orderCard").forEach(card=>{const okTab=activeTab==="all"||card.dataset.status===activeTab,okSearch=!searchTerm||(card.dataset.search||"").includes(searchTerm);card.classList.toggle("hiddenByFilter",!(okTab&&okSearch));});}
function setupTabs(){document.querySelectorAll(".tabBtn").forEach(btn=>btn.onclick=()=>{document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");activeTab=btn.dataset.tab;refreshOrderVisibility();});}
ordersSearch.addEventListener("input",()=>{searchTerm=ordersSearch.value.trim().toLowerCase();refreshOrderVisibility();});

function orderDetails(order){
  if(currentTemplateKey==="carwash"){
    const carModel=escapeHTML(order.carModel||order.carType||"-"); const color=escapeHTML(order.carColor||"-"); const plate=escapeHTML(order.plateNumber||order.carPlate||"-"); const notes=escapeHTML(order.notes||"-");
    return `<div class="orderInfo"><b>🚗 السيارة</b>${carModel}</div><div class="orderInfo"><b>🎨 اللون / اللوحة</b>${color} — ${plate}</div><div class="orderInfo"><b>📍 عنوان الركنة</b>${escapeHTML(order.customerAddress||order.parkingAddress||"-")}</div><div class="orderInfo"><b>📝 ملاحظات</b>${notes}</div>`;
  }
  return `<div class="orderInfo"><b>📍 العنوان</b>${escapeHTML(order.customerAddress||"-")}</div><div class="orderInfo"><b>🏠 تفاصيل المكان</b>${escapeHTML(order.rooms||"-")} غرف / ${escapeHTML(order.bathrooms||"-")} حمام</div><div class="orderInfo"><b>✨ إضافات</b>مطبخ: ${escapeHTML(order.kitchen||"-")} / سلم: ${escapeHTML(order.stairs||"-")}</div>`;
}

async function loadOrders(projectId){const box=$("ordersContainer");box.innerHTML='<div class="emptyState">جاري تحميل الطلبات...</div>';try{const snapshot=await getDocs(query(collection(db,"orders"),where("projectId","==",projectId)));stats={new:0,accepted:0,done:0,canceled:0};let doneRevenue=0,todayOrders=0;const today=new Date().toISOString().split("T")[0];box.innerHTML="";
snapshot.forEach(ds=>{const order=ds.data(),s=order.status||"new";if(s in stats)stats[s]++;if(s==="done")doneRevenue+=Number(order.price||0);if(order.visitDate===today)todayOrders++;const id=ds.id,name=escapeHTML(order.customerName||"عميل"),phone=escapeHTML(order.customerPhone||"-"),date=escapeHTML(order.visitDate||"-"),time=escapeHTML(order.visitTime||"-"),maps=typeof order.location==="string"&&order.location.startsWith("http")?order.location:"",wa=cleanPhone(order.customerPhone);const label={new:"جديد",accepted:"مقبول",done:"تم التنفيذ",canceled:"ملغي"}[s]||s;const card=document.createElement("article");card.className="orderCard";card.dataset.status=s;card.dataset.search=`${order.customerName||""} ${order.customerPhone||""} ${order.carModel||""} ${order.plateNumber||""}`.toLowerCase();card.innerHTML=`<div class="orderTop"><div><h3>${name}</h3><span class="muted">${phone}</span></div><span class="orderStatus status-${s}">${label}</span></div><div class="orderGrid"><div class="orderInfo"><b>📅 الموعد</b>${date} — ${time}</div>${orderDetails(order)}</div><div class="orderPrice">💰 ${Number(order.price||0)} جنيه</div><div class="orderActions">${wa?`<a class="orderAction whatsapp" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 واتساب</a>`:""}${maps?`<a class="orderAction maps" href="${escapeHTML(maps)}" target="_blank" rel="noopener">🗺️ فتح الموقع</a>`:""}${s==="new"?'<button class="orderAction accept acceptBtn" type="button">قبول الطلب</button>':""}${s==="accepted"?'<button class="orderAction done doneBtn" type="button">تم التنفيذ</button>':""}${["new","accepted"].includes(s)?'<button class="orderAction cancel cancelBtn" type="button">إلغاء</button>':""}</div>`;box.appendChild(card);card.querySelector(".acceptBtn")?.addEventListener("click",async()=>{if(await updateOrderStatus(id,projectId,"accepted"))loadOrders(projectId);});card.querySelector(".doneBtn")?.addEventListener("click",async()=>{if(await updateOrderStatus(id,projectId,"done"))loadOrders(projectId);});card.querySelector(".cancelBtn")?.addEventListener("click",async()=>{if(await updateOrderStatus(id,projectId,"canceled"))loadOrders(projectId);});});
$("newOrders").innerText=stats.new;$("acceptedOrders").innerText=stats.accepted;$("doneOrders").innerText=stats.done;$("canceledOrders").innerText=stats.canceled;$("todayOrders").innerText=todayOrders;$("doneRevenue").innerText=doneRevenue;if(snapshot.empty)box.innerHTML='<div class="emptyState">لا توجد طلبات بعد. شارك رابط مشروعك لاستقبال أول طلب ✨</div>';setupTabs();refreshOrderVisibility();}catch(e){box.innerHTML=`<div class="emptyState">${escapeHTML(e.message)}</div>`;console.log(e);}}
