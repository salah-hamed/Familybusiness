import { createOrder, getLaundryOrderTracking, subscribeLaundryOrderTracking } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentProjectId = "";
const orderSubscriptions = new Map();
let trackedOrders = new Map();
let priceConfig = {
  shirtWash: 0, shirtIron: 0,
  trousersWash: 0, trousersIron: 0,
  tshirtWash: 0, tshirtIron: 0,
  dressWash: 0, dressIron: 0,
  galabeyaWash: 0, galabeyaIron: 0,
  suitWash: 0, suitIron: 0,
  shoesWash: 0
};

const itemDefinitions = [
  { key: "shirt", label: "قميص", icon: "👔", washKey: "shirtWash", ironKey: "shirtIron" },
  { key: "trousers", label: "بنطلون", icon: "👖", washKey: "trousersWash", ironKey: "trousersIron" },
  { key: "tshirt", label: "تيشيرت", icon: "👕", washKey: "tshirtWash", ironKey: "tshirtIron" },
  { key: "dress", label: "فستان / عباية", icon: "👗", washKey: "dressWash", ironKey: "dressIron" },
  { key: "galabeya", label: "جلابية", icon: "🥻", washKey: "galabeyaWash", ironKey: "galabeyaIron" },
  { key: "suit", label: "بدلة", icon: "🤵", washKey: "suitWash", ironKey: "suitIron" },
  { key: "shoes", label: "غسيل كوتشي", icon: "👟", washKey: "shoesWash", ironKey: null, washOnly: true }
];

const quantities = Object.fromEntries(itemDefinitions.map(item => [item.key, 0]));
const services = Object.fromEntries(itemDefinitions.map(item => [item.key, item.washOnly ? "wash" : "wash_iron"]));

function storageKey(){ return `familybusiness:laundry:${currentProjectId}:customer`; }
function ordersStorageKey(){ return `familybusiness:laundry:${currentProjectId}:orders`; }
function normalizeEgyptWhatsapp(number){let clean=String(number||"").replace(/\D/g,"");if(clean.startsWith("0020"))clean=clean.slice(2);if(clean.startsWith("20"))return clean;if(clean.startsWith("0"))clean=clean.slice(1);return `20${clean}`;}
function unavailable(message="يرجى التواصل مع صاحب المشروع."){document.querySelector(".app").innerHTML=`<section class="card" style="text-align:center"><h2>🔒 المشروع غير متاح</h2><p>${message}</p></section>`;}
function today(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().split("T")[0];}
function readSaved(){try{return JSON.parse(localStorage.getItem(storageKey())||"null");}catch{return null;}}
function saveCustomer(){localStorage.setItem(storageKey(),JSON.stringify({customerName:$("customerName").value.trim(),customerPhone:$("customerPhone").value.trim(),customerAddress:$("customerAddress").value.trim(),location:$("location").value}));}
function fillSaved(){const p=readSaved();if(!p)return;["customerName","customerPhone","customerAddress","location"].forEach(id=>{if(p[id])$(id).value=p[id];});}

function loadHistoryTokens(){
  try{
    const data=JSON.parse(localStorage.getItem(ordersStorageKey())||"[]");
    return Array.isArray(data)?data.filter(Boolean):[];
  }catch{return [];}
}

function rememberOrder(token){
  if(!token)return;
  const tokens=loadHistoryTokens().filter(item=>item!==token);
  tokens.unshift(token);
  localStorage.setItem(ordersStorageKey(),JSON.stringify(tokens.slice(0,20)));
  refreshOrdersButton();
}

function refreshOrdersButton(){
  const count=loadHistoryTokens().length;
  $("myOrdersBtn").innerText=count?`📦 طلباتي (${count})`:"📦 طلباتي";
}

const laundryStatusSteps=[
  ["new","تم استلام الطلب"],
  ["accepted","تم قبول الطلب"],
  ["pickup_assigned","تم تعيين مندوب الاستلام"],
  ["picked_up","تم استلام الملابس"],
  ["processing","جاري الغسيل والمكواة"],
  ["ready_delivery","الطلب جاهز للتوصيل"],
  ["out_for_delivery","خرج للتوصيل"],
  ["delivered","تم التوصيل"]
];

function laundryStatusLabel(status){
  return Object.fromEntries(laundryStatusSteps)[status]
    ||(status==="canceled"?"تم إلغاء الطلب":status||"—");
}

function formatOrderDate(value){
  const date=value?.toDate?.();
  if(!date)return "";
  return new Intl.DateTimeFormat("ar-EG",{dateStyle:"medium",timeStyle:"short"}).format(date);
}

function renderLaundryTimeline(order){
  if(order.status==="canceled")return '<div class="orderCanceled">تم إلغاء الطلب</div>';
  const current=laundryStatusSteps.findIndex(([status])=>status===order.status);
  return `<div class="trackingTimeline">${laundryStatusSteps.map(([status,label],index)=>`
    <div class="trackingStep ${index<=current?"done":""} ${index===current?"current":""}">
      <span></span><small>${label}</small>
    </div>`).join("")}</div>`;
}

function renderMyOrders(){
  const orders=[...trackedOrders.values()]
    .filter(Boolean)
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

  $("ordersList").innerHTML=orders.length
    ?orders.map(order=>{
      const items=(order.items||[])
        .filter(item=>Number(item.quantity||0)>0)
        .map(item=>`${Number(item.quantity||0)} × ${esc(item.label||item.key||"قطعة")} — ${esc(item.serviceLabel||"")}`)
        .join("، ");

      return `<article class="customerOrderCard" data-tracking-token="${esc(order.trackingToken)}">
        <div class="orderCardHead">
          <div>
            <b>طلب #${esc(String(order.orderId||"").slice(0,7))}</b>
            <small>${esc(formatOrderDate(order.createdAt))}</small>
          </div>
          <span class="orderStatusBadge ${order.status==="delivered"?"delivered":order.status==="canceled"?"canceled":""}">
            ${esc(laundryStatusLabel(order.status))}
          </span>
        </div>
        <div class="orderItemsSummary">${items||"تفاصيل الطلب غير متاحة"}</div>
        <div class="orderTotal">الإجمالي: <b>${money(order.total)}</b></div>
        ${renderLaundryTimeline(order)}
        <button class="repeatLaundryBtn" type="button">اطلب نفس القطع مرة أخرى</button>
      </article>`;
    }).join("")
    :'<p class="ordersEmpty">لا توجد طلبات محفوظة على هذا الجهاز حتى الآن.</p>';

  document.querySelectorAll(".customerOrderCard").forEach(card=>{
    const order=trackedOrders.get(card.dataset.trackingToken);
    card.querySelector(".repeatLaundryBtn").onclick=()=>repeatLaundryOrder(order);
  });
}

async function loadMyOrders(){
  const tokens=loadHistoryTokens();
  if(!tokens.length){
    trackedOrders=new Map();
    renderMyOrders();
    return;
  }

  const results=await Promise.all(tokens.map(async token=>{
    try{return await getLaundryOrderTracking(token);}catch{return null;}
  }));

  trackedOrders=new Map(
    results
      .filter(order=>order&&order.projectId===currentProjectId)
      .map(order=>[order.trackingToken,order])
  );

  for(const [token,order] of trackedOrders){
    if(["delivered","canceled"].includes(order.status)||orderSubscriptions.has(token))continue;

    const unsubscribe=subscribeLaundryOrderTracking(token,updated=>{
      if(!updated)return;
      trackedOrders.set(token,updated);
      renderMyOrders();

      if(["delivered","canceled"].includes(updated.status)){
        orderSubscriptions.get(token)?.();
        orderSubscriptions.delete(token);
      }
    });

    orderSubscriptions.set(token,unsubscribe);
  }

  renderMyOrders();
}

function repeatLaundryOrder(order){
  if(!order?.items?.length)return;

  itemDefinitions.forEach(item=>{
    const previous=order.items.find(entry=>entry.key===item.key);
    quantities[item.key]=Math.max(0,Math.min(100,Number(previous?.quantity||0)));

    if(item.washOnly){
      services[item.key]="wash";
      return;
    }

    const previousService=previous?.service;
    services[item.key]=["wash","iron","wash_iron"].includes(previousService)
      ?previousService
      :"wash_iron";
  });

  renderItems();
  $("ordersSheet").classList.add("hidden");
  $("status").innerText="تم تجهيز نفس القطع والخدمات. اختار موعد استلام جديد ثم أرسل الطلب.";
  $("submitOrder").innerText="إرسال طلب الاستلام";
  $("itemsSection").scrollIntoView({behavior:"smooth",block:"start"});
}


function hasConfiguredPricing(config = {}){
  return [
    "shirtWash","shirtIron","trousersWash","trousersIron","tshirtWash","tshirtIron",
    "dressWash","dressIron","galabeyaWash","galabeyaIron","suitWash","suitIron","shoesWash"
  ].every(key => Object.prototype.hasOwnProperty.call(config,key) && Number.isFinite(Number(config[key])) && Number(config[key]) >= 0);
}

function servicePrice(item, service){
  const wash = Number(priceConfig[item.washKey] || 0);
  const iron = item.ironKey ? Number(priceConfig[item.ironKey] || 0) : 0;
  if (item.washOnly || service === "wash") return wash;
  if (service === "iron") return iron;
  return wash + iron;
}

function serviceLabel(service){if(service === "wash") return "غسيل";if(service === "iron") return "مكواة";return "غسيل + مكواة";}

function totals(){
  let pieces=0,price=0;
  itemDefinitions.forEach(item=>{pieces += quantities[item.key];price += quantities[item.key] * servicePrice(item, services[item.key]);});
  $("piecesCount").innerText=`${pieces} قطعة`;
  $("priceBox").innerText=`${price} جنيه`;
  return {pieces,price};
}

function updateItemPrice(item){const el=$(`price-${item.key}`);if(!el)return;const price=servicePrice(item,services[item.key]);el.innerText=`${price} جنيه / قطعة — ${serviceLabel(services[item.key])}`;}

function renderItems(){
  const box=$("itemsList");
  box.innerHTML="";
  itemDefinitions.forEach(item=>{
    const row=document.createElement("div");
    row.className="itemRow";
    const selectedService=services[item.key];
    const serviceControl=item.washOnly?'<span class="serviceFixed">غسيل فقط</span>':`<select class="serviceSelect" data-service-key="${item.key}" aria-label="نوع الخدمة لـ ${item.label}"><option value="wash" ${selectedService==="wash"?"selected":""}>غسيل فقط</option><option value="iron" ${selectedService==="iron"?"selected":""}>مكواة فقط</option><option value="wash_iron" ${selectedService==="wash_iron"?"selected":""}>غسيل + مكواة</option></select>`;
    row.innerHTML=`<div class="itemDetails"><span class="itemName">${item.icon} ${item.label}</span>${serviceControl}<span class="itemPrice" id="price-${item.key}"></span></div><div class="counter"><button type="button" data-key="${item.key}" data-step="-1">−</button><strong id="qty-${item.key}">${quantities[item.key]}</strong><button type="button" data-key="${item.key}" data-step="1">+</button></div>`;
    box.appendChild(row);updateItemPrice(item);
  });
  box.querySelectorAll("button[data-key]").forEach(btn=>btn.onclick=()=>{const key=btn.dataset.key;quantities[key]=Math.max(0,quantities[key]+Number(btn.dataset.step));$(`qty-${key}`).innerText=quantities[key];totals();});
  box.querySelectorAll("select[data-service-key]").forEach(select=>select.onchange=()=>{const key=select.dataset.serviceKey;services[key]=select.value;updateItemPrice(itemDefinitions.find(def=>def.key===key));totals();});
  totals();
}

function validate(){const {pieces}=totals();if(pieces<1)return "اختار قطعة واحدة على الأقل.";const phone=$("customerPhone").value.replace(/\s/g,"");if(!$("customerName").value.trim()||!phone||!$("customerAddress").value.trim())return "أكمل الاسم ورقم الهاتف والعنوان.";if(!/^01\d{9}$/.test(phone))return "أدخل رقم موبايل مصري صحيح مكوّن من 11 رقمًا.";if(!$("pickupDate").value||!$("pickupTime").value)return "حدد تاريخ ووقت الاستلام.";if($("pickupDate").value<today())return "تاريخ الاستلام لا يمكن أن يكون في الماضي.";return null;}

$("pickupDate").min=today();
$("getLocationBtn").onclick=()=>{if(!navigator.geolocation){$("locationBtnText").innerText="الموقع غير مدعوم";return;}$("getLocationBtn").disabled=true;$("locationBtnText").innerText="جاري تحديد الموقع...";navigator.geolocation.getCurrentPosition(pos=>{$("location").value=`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;$("locationBtnText").innerText="تم تحديد الموقع ✅";$("getLocationBtn").disabled=false;},()=>{$("locationBtnText").innerText="تعذر تحديد الموقع — حاول مرة أخرى";$("getLocationBtn").disabled=false;},{enableHighAccuracy:true,timeout:10000});};

async function init(){
  currentProjectId=new URLSearchParams(location.search).get("project")||"";
  if(!currentProjectId){unavailable();return;}
  let snap;try{snap=await getDoc(doc(db,"projects",currentProjectId));}catch{unavailable();return;}
  if(!snap.exists()){unavailable();return;}
  const data=snap.data();
  if(data.template!=="laundry"||data.isActive!==true||data.status!=="active"){unavailable();return;}

  let laundrySnap;
  try{
    laundrySnap=await getDoc(doc(db,"laundries",currentProjectId));
  }catch{unavailable("المغسلة غير جاهزة لاستقبال الطلبات حاليًا.");return;}

  if(!laundrySnap.exists()){
    unavailable("المغسلة لم تكمل إعداد التشغيل بعد.");return;
  }

  const laundry=laundrySnap.data();
  if(laundry.isAcceptingOrders!==true){unavailable("المغسلة غير متاحة لاستقبال طلبات جديدة حاليًا.");return;}
  if(!hasConfiguredPricing(data.priceConfig||{})){unavailable("المغسلة لم تجهز أسعار الغسيل والمكواة بعد. يرجى المحاولة لاحقًا.");return;}

  $("businessTitle").innerText=laundry.name||data.businessName||"غسيل ومكواة الملابس";
  priceConfig={...priceConfig,...data.priceConfig};
  renderItems();fillSaved();refreshOrdersButton();
  if(laundry.whatsapp)$("whatsappBtn").href=`https://wa.me/${normalizeEgyptWhatsapp(laundry.whatsapp)}`;else $("whatsappBtn").style.display="none";
  if(laundry.instapayLink)$("paymentBtn").href=laundry.instapayLink;else $("paymentBtn").style.display="none";
  $("submitOrder").onclick=async()=>{
    const error=validate();if(error){$("status").innerText=error;return;}
    const {pieces,price}=totals();
    const items=itemDefinitions.map(item=>({key:item.key,label:item.label,service:services[item.key],serviceLabel:serviceLabel(services[item.key]),quantity:quantities[item.key],unitPrice:servicePrice(item,services[item.key]),subtotal:quantities[item.key]*servicePrice(item,services[item.key])}));
    const order={projectId:currentProjectId,providerId:currentProjectId,templateType:"laundry",serviceType:"laundry_per_piece",customerName:$("customerName").value.trim(),customerPhone:$("customerPhone").value.trim(),customerAddress:$("customerAddress").value.trim(),location:$("location").value,pickupDate:$("pickupDate").value,pickupTime:$("pickupTime").value,visitDate:$("pickupDate").value,visitTime:$("pickupTime").value,notes:$("notes").value.trim(),items,totalPieces:pieces,price,status:"new"};
    $("submitOrder").disabled=true;$("status").innerText="جاري إرسال الطلب...";
    const result=await createOrder(order);
    if(result.success){
      saveCustomer();
      rememberOrder(result.trackingToken);
      $("status").innerText=result.trackingEnabled
        ?`تم إرسال طلب الاستلام بنجاح 🎉 رقم الطلب ${result.orderId.slice(0,7)}. تقدر تتابع حالته من «طلباتي».`
        :`تم إرسال طلب الاستلام بنجاح 🎉 رقم الطلب ${result.orderId.slice(0,7)}.`;
      $("submitOrder").innerText="تم إرسال الطلب ✅";
    }else{
      $("status").innerText=result.error;
    }
    $("submitOrder").disabled=false;
  };
}

$("myOrdersBtn").onclick=async()=>{
  $("ordersSheet").classList.remove("hidden");
  $("ordersList").innerHTML='<p class="ordersEmpty">جاري تحميل طلباتك...</p>';
  await loadMyOrders();
};

$("closeOrders").onclick=()=>$("ordersSheet").classList.add("hidden");
$("ordersSheet").addEventListener("click",event=>{
  if(event.target===$("ordersSheet"))$("ordersSheet").classList.add("hidden");
});

init();
