import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentProjectId = "";
let priceConfig = { shirt: 20, trousers: 25, tshirt: 15, dress: 35, suit: 60 };
const itemDefinitions = [
  ["shirt", "قميص", "👔"],
  ["trousers", "بنطلون", "👖"],
  ["tshirt", "تيشيرت", "👕"],
  ["dress", "فستان / عباية", "👗"],
  ["suit", "بدلة", "🤵"]
];
const quantities = Object.fromEntries(itemDefinitions.map(([key]) => [key, 0]));

function storageKey(){ return `familybusiness:laundry:${currentProjectId}:customer`; }
function normalizeEgyptWhatsapp(number){let clean=String(number||"").replace(/\D/g,"");if(clean.startsWith("0020"))clean=clean.slice(2);if(clean.startsWith("20"))return clean;if(clean.startsWith("0"))clean=clean.slice(1);return `20${clean}`;}
function unavailable(){document.querySelector(".app").innerHTML='<section class="card" style="text-align:center"><h2>🔒 المشروع غير متاح</h2><p>يرجى التواصل مع صاحب المشروع.</p></section>';}
function today(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().split("T")[0];}
function readSaved(){try{return JSON.parse(localStorage.getItem(storageKey())||"null");}catch{return null;}}
function saveCustomer(){localStorage.setItem(storageKey(),JSON.stringify({customerName:$("customerName").value.trim(),customerPhone:$("customerPhone").value.trim(),customerAddress:$("customerAddress").value.trim(),location:$("location").value}));}
function fillSaved(){const p=readSaved();if(!p)return;["customerName","customerPhone","customerAddress","location"].forEach(id=>{if(p[id])$(id).value=p[id];});}
function totals(){let pieces=0,price=0;itemDefinitions.forEach(([key])=>{pieces+=quantities[key];price+=quantities[key]*Number(priceConfig[key]||0);});$("piecesCount").innerText=`${pieces} قطعة`;$("priceBox").innerText=`${price} جنيه`;return {pieces,price};}
function renderItems(){const box=$("itemsList");box.innerHTML="";itemDefinitions.forEach(([key,label,icon])=>{const row=document.createElement("div");row.className="itemRow";row.innerHTML=`<div><span class="itemName">${icon} ${label}</span><span class="itemPrice">${Number(priceConfig[key]||0)} جنيه / قطعة</span></div><div class="counter"><button type="button" data-key="${key}" data-step="-1">−</button><strong id="qty-${key}">${quantities[key]}</strong><button type="button" data-key="${key}" data-step="1">+</button></div>`;box.appendChild(row);});box.querySelectorAll("button[data-key]").forEach(btn=>btn.onclick=()=>{const key=btn.dataset.key;quantities[key]=Math.max(0,quantities[key]+Number(btn.dataset.step));$(`qty-${key}`).innerText=quantities[key];totals();});totals();}
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
  $("businessTitle").innerText=data.businessName||"غسيل وكي الملابس";
  priceConfig={...priceConfig,...(data.priceConfig||{})};
  renderItems();fillSaved();
  if(data.whatsappNumber)$("whatsappBtn").href=`https://wa.me/${normalizeEgyptWhatsapp(data.whatsappNumber)}`;else $("whatsappBtn").style.display="none";
  if(data.instapayLink)$("paymentBtn").href=data.instapayLink;else $("paymentBtn").style.display="none";
  $("submitOrder").onclick=async()=>{
    const error=validate();if(error){$("status").innerText=error;return;}
    const {pieces,price}=totals();
    const items=itemDefinitions.filter(([key])=>quantities[key]>0).map(([key,label])=>({key,label,quantity:quantities[key],unitPrice:Number(priceConfig[key]||0),subtotal:quantities[key]*Number(priceConfig[key]||0)}));
    const order={projectId:currentProjectId,providerId:currentProjectId,templateType:"laundry",serviceType:"wash_and_iron",customerName:$("customerName").value.trim(),customerPhone:$("customerPhone").value.trim(),customerAddress:$("customerAddress").value.trim(),location:$("location").value,pickupDate:$("pickupDate").value,pickupTime:$("pickupTime").value,visitDate:$("pickupDate").value,visitTime:$("pickupTime").value,notes:$("notes").value.trim(),items,totalPieces:pieces,price,status:"new"};
    $("submitOrder").disabled=true;$("status").innerText="جاري إرسال الطلب...";
    const result=await createOrder(order);$("submitOrder").disabled=false;
    if(result.success){saveCustomer();$("status").innerText="تم إرسال طلب الاستلام بنجاح 🎉";$("submitOrder").innerText="تم إرسال الطلب ✅";}else $("status").innerText=result.error;
  };
}
init();
