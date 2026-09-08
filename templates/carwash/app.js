import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const priceBox = $("priceBox");
const locationInput = $("location");
const locationButton = $("getLocationBtn");
const locationButtonText = $("locationBtnText");
const submitOrderBtn = $("submitOrder");
const bookingStatus = $("status");
const whatsappBtn = $("whatsappBtn");
const paymentBtn = $("paymentBtn");
let washPrice = 0;

function calcPrice(){ priceBox.innerText = `${Number(washPrice || 0)} جنيه`; return Number(washPrice || 0); }
function unavailable(){ document.querySelector(".app").innerHTML='<div style="text-align:center;padding:40px 20px;max-width:500px;margin:40px auto;background:#fff;border-radius:22px"><div style="font-size:44px">🔒</div><h2>المشروع غير متاح</h2><p>هذا المشروع غير متاح حاليًا. يرجى التواصل مع صاحب المشروع.</p></div>'; }
function normalizeEgyptWhatsapp(number){ let clean=String(number||"").replace(/\D/g,""); if(clean.startsWith("0020"))clean=clean.slice(2); if(clean.startsWith("20"))return clean; if(clean.startsWith("0"))clean=clean.slice(1); return `20${clean}`; }
function validate(){
  const required=[$("customerName").value.trim(),$("customerPhone").value.trim(),$("carModel").value.trim(),$("carColor").value.trim(),$("plateNumber").value.trim(),$("customerAddress").value.trim(),$("visitDate").value,$("visitTime").value];
  if(required.some(v=>!v)) return "من فضلك أكمل بيانات العميل والسيارة والمكان والموعد.";
  if(!/^01\d{9}$/.test($("customerPhone").value.replace(/\s/g,""))) return "من فضلك أدخل رقم موبايل مصري صحيح مكوّن من 11 رقمًا.";
  return null;
}
function scrollToSection(id){ $(id)?.scrollIntoView({behavior:"smooth",block:"start"}); }

locationButton.onclick=()=>{
  if(!navigator.geolocation){locationButtonText.innerText="الموقع غير مدعوم على هذا الجهاز";return;}
  locationButton.disabled=true; locationButtonText.innerText="جاري تحديد الموقع...";
  navigator.geolocation.getCurrentPosition(pos=>{locationInput.value=`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;locationButtonText.innerText="تم تحديد الموقع ✅";locationButton.disabled=false;},()=>{locationButtonText.innerText="تعذر تحديد الموقع — حاول مرة أخرى";locationButton.disabled=false;},{enableHighAccuracy:true,timeout:10000});
};
$("floatingOrderBtn").onclick=()=>scrollToSection("bookingSection");
document.querySelectorAll(".navItem[data-target]").forEach(item=>item.onclick=()=>{document.querySelectorAll(".navItem").forEach(n=>n.classList.remove("active"));item.classList.add("active");scrollToSection(item.dataset.target);});
$("visitDate").min=new Date().toISOString().split("T")[0];

async function init(){
  const projectId=new URLSearchParams(location.search).get("project");
  if(!projectId){unavailable();return;}
  let snap; try{snap=await getDoc(doc(db,"projects",projectId));}catch{unavailable();return;}
  if(!snap.exists()){unavailable();return;}
  const data=snap.data();
  if(!data.isActive||data.status!=="active"||data.template!=="carwash"){unavailable();return;}
  $("businessTitle").innerText=data.businessName||"غسيل السيارات";
  washPrice=Number(data.priceConfig?.base ?? 0); calcPrice();
  if(data.whatsappNumber) whatsappBtn.href=`https://wa.me/${normalizeEgyptWhatsapp(data.whatsappNumber)}`; else whatsappBtn.style.display="none";
  if(data.instapayLink) paymentBtn.href=data.instapayLink; else paymentBtn.style.display="none";

  submitOrderBtn.onclick=async()=>{
    const error=validate(); if(error){bookingStatus.innerText=error;return;}
    bookingStatus.innerText="جاري إرسال الطلب..."; submitOrderBtn.disabled=true;
    const order={projectId,providerId:projectId,templateType:"carwash",serviceType:"external_car_wash",customerName:$("customerName").value.trim(),customerPhone:$("customerPhone").value.trim(),customerAddress:$("customerAddress").value.trim(),location:locationInput.value,carModel:$("carModel").value.trim(),carColor:$("carColor").value.trim(),plateNumber:$("plateNumber").value.trim(),notes:$("notes").value.trim(),visitDate:$("visitDate").value,visitTime:$("visitTime").value,price:calcPrice(),status:"new"};
    const res=await createOrder(order); bookingStatus.innerText=res.success?"تم استلام طلب غسيل السيارة بنجاح 🎉":res.error; submitOrderBtn.disabled=false; if(res.success)submitOrderBtn.innerText="تم إرسال الطلب ✅";
  };
}
init();
