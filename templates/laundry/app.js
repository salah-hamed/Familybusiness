import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentProjectId = "";
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
function normalizeEgyptWhatsapp(number){let clean=String(number||"").replace(/\D/g,"");if(clean.startsWith("0020"))clean=clean.slice(2);if(clean.startsWith("20"))return clean;if(clean.startsWith("0"))clean=clean.slice(1);return `20${clean}`;}
function unavailable(message="يرجى التواصل مع صاحب المشروع."){document.querySelector(".app").innerHTML=`<section class="card" style="text-align:center"><h2>🔒 المشروع غير متاح</h2><p>${message}</p></section>`;}
function today(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().split("T")[0];}
function readSaved(){try{return JSON.parse(localStorage.getItem(storageKey())||"null");}catch{return null;}}
function saveCustomer(){localStorage.setItem(storageKey(),JSON.stringify({customerName:$("customerName").value.trim(),customerPhone:$("customerPhone").value.trim(),customerAddress:$("customerAddress").value.trim(),location:$("location").value}));}
function fillSaved(){const p=readSaved();if(!p)return;["customerName","customerPhone","customerAddress","location"].forEach(id=>{if(p[id])$(id).value=p[id];});}

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

function serviceLabel(service){
  if(service === "wash") return "غسيل";
  if(service === "iron") return "مكواة";
  return "غسيل + مكواة";
}

function totals(){
  let pieces=0,price=0;
  itemDefinitions.forEach(item=>{
    pieces += quantities[item.key];
    price += quantities[item.key] * servicePrice(item, services[item.key]);
  });
  $("piecesCount").innerText=`${pieces} قطعة`;
  $("priceBox").innerText=`${price} جنيه`;
  return {pieces,price};
}

function updateItemPrice(item){
  const el = $(`price-${item.key}`);
  if(!el) return;
  const price = servicePrice(item, services[item.key]);
  el.innerText = `${price} جنيه / قطعة — ${serviceLabel(services[item.key])}`;
}

function renderItems(){
  const box=$("itemsList");
  box.innerHTML="";
  itemDefinitions.forEach(item=>{
    const row=document.createElement("div");
    row.className="itemRow";
    const serviceControl = item.washOnly
      ? '<span class="serviceFixed">غسيل فقط</span>'
      : `<select class="serviceSelect" data-service-key="${item.key}" aria-label="نوع الخدمة لـ ${item.label}">
          <option value="wash">غسيل فقط</option>
          <option value="iron">مكواة فقط</option>
          <option value="wash_iron" selected>غسيل + مكواة</option>
        </select>`;
    row.innerHTML=`
      <div class="itemDetails">
        <span class="itemName">${item.icon} ${item.label}</span>
        ${serviceControl}
        <span class="itemPrice" id="price-${item.key}"></span>
      </div>
      <div class="counter">
        <button type="button" data-key="${item.key}" data-step="-1">−</button>
        <strong id="qty-${item.key}">${quantities[item.key]}</strong>
        <button type="button" data-key="${item.key}" data-step="1">+</button>
      </div>`;
    box.appendChild(row);
    updateItemPrice(item);
  });

  box.querySelectorAll("button[data-key]").forEach(btn=>btn.onclick=()=>{
    const key=btn.dataset.key;
    quantities[key]=Math.max(0,quantities[key]+Number(btn.dataset.step));
    $(`qty-${key}`).innerText=quantities[key];
    totals();
  });

  box.querySelectorAll("select[data-service-key]").forEach(select=>select.onchange=()=>{
    const key=select.dataset.serviceKey;
    services[key]=select.value;
    const item=itemDefinitions.find(def=>def.key===key);
    updateItemPrice(item);
    totals();
  });
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
  if(!hasConfiguredPricing(data.priceConfig||{})){unavailable("مقدم الخدمة لم يجهز أسعار الغسيل والمكواة بعد. يرجى المحاولة لاحقًا.");return;}
  $("businessTitle").innerText=data.businessName||"غسيل ومكواة الملابس";
  priceConfig={...priceConfig,...data.priceConfig};
  renderItems();fillSaved();
  if(data.whatsappNumber)$("whatsappBtn").href=`https://wa.me/${normalizeEgyptWhatsapp(data.whatsappNumber)}`;else $("whatsappBtn").style.display="none";
  if(data.instapayLink)$("paymentBtn").href=data.instapayLink;else $("paymentBtn").style.display="none";
  $("submitOrder").onclick=async()=>{
    const error=validate();if(error){$("status").innerText=error;return;}
    const {pieces,price}=totals();
    const items=itemDefinitions.map(item=>({
      key:item.key,
      label:item.label,
      service:services[item.key],
      serviceLabel:serviceLabel(services[item.key]),
      quantity:quantities[item.key],
      unitPrice:servicePrice(item,services[item.key]),
      subtotal:quantities[item.key]*servicePrice(item,services[item.key])
    }));
    const order={projectId:currentProjectId,providerId:currentProjectId,templateType:"laundry",serviceType:"laundry_per_piece",customerName:$("customerName").value.trim(),customerPhone:$("customerPhone").value.trim(),customerAddress:$("customerAddress").value.trim(),location:$("location").value,pickupDate:$("pickupDate").value,pickupTime:$("pickupTime").value,visitDate:$("pickupDate").value,visitTime:$("pickupTime").value,notes:$("notes").value.trim(),items,totalPieces:pieces,price,status:"new"};
    $("submitOrder").disabled=true;$("status").innerText="جاري إرسال الطلب...";
    const result=await createOrder(order);$("submitOrder").disabled=false;
    if(result.success){saveCustomer();$("status").innerText="تم إرسال طلب الاستلام بنجاح 🎉";$("submitOrder").innerText="تم إرسال الطلب ✅";}else $("status").innerText=result.error;
  };
}
init();
