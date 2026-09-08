import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
let pricing = { monthly: 0, monthlyWashes: 4 };
let currentProjectId = "";
let savedProfile = null;
let currentSubscription = null;

function storageKey() { return `familybusiness:carwash:${currentProjectId}:customer`; }
function normalizePhone(value) { return String(value || "").replace(/\D/g, ""); }
function normalizePlate(value) { return String(value || "").trim().replace(/\s+/g, "").toLowerCase(); }
function normalizeEgyptWhatsapp(number) { let clean=String(number||"").replace(/\D/g,""); if(clean.startsWith("0020"))clean=clean.slice(2); if(clean.startsWith("20"))return clean; if(clean.startsWith("0"))clean=clean.slice(1); return `20${clean}`; }
async function subscriptionKey(projectId, phone, plate) { const raw=`${projectId}|${normalizePhone(phone)}|${normalizePlate(plate)}`; const bytes=new TextEncoder().encode(raw); const digest=await crypto.subtle.digest("SHA-256",bytes); return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join(""); }
function scrollToSection(id){ $(id)?.scrollIntoView({behavior:"smooth",block:"start"}); }
function unavailable(){ document.querySelector(".app").innerHTML='<div style="text-align:center;padding:40px 20px;max-width:500px;margin:40px auto;background:#fff;border-radius:22px"><div style="font-size:44px">🔒</div><h2>المشروع غير متاح</h2><p>هذا المشروع غير متاح حاليًا. يرجى التواصل مع صاحب المشروع.</p></div>'; }

function readProfile(){ try { return JSON.parse(localStorage.getItem(storageKey()) || "null"); } catch { return null; } }
function collectProfile(){ return { customerName:$("customerName").value.trim(), customerPhone:$("customerPhone").value.trim(), carModel:$("carModel").value.trim(), carColor:$("carColor").value.trim(), plateNumber:$("plateNumber").value.trim(), customerAddress:$("customerAddress").value.trim(), location:$("location").value, notes:$("notes").value.trim() }; }
function saveProfile(profile){ localStorage.setItem(storageKey(),JSON.stringify(profile)); savedProfile=profile; }
function fillProfile(profile){ if(!profile)return; ["customerName","customerPhone","carModel","carColor","plateNumber","customerAddress","location","notes"].forEach(id=>{ if($(id))$(id).value=profile[id]||""; }); $("savedNotice")?.classList.remove("hidden"); }
function validateProfile(profile){ if(!profile.customerName||!profile.customerPhone||!profile.carModel||!profile.carColor||!profile.plateNumber||!profile.customerAddress)return "من فضلك أكمل بيانات العميل والسيارة والعنوان."; if(!/^01\d{9}$/.test(profile.customerPhone.replace(/\s/g,"")))return "من فضلك أدخل رقم موبايل مصري صحيح مكوّن من 11 رقمًا."; return null; }

function showSubscription(sub){
  currentSubscription=sub;
  const section=$("subscriptionStatus"); section.classList.add("show");
  const total=Number(sub.totalWashes||0), remaining=Number(sub.remainingWashes||0), used=Math.max(0,total-remaining);
  $("remainingWashes").innerText=remaining; $("usedWashes").innerText=used;
  const expires=sub.expiresAt?.toDate ? sub.expiresAt.toDate() : null;
  const expired=expires ? expires < new Date() : false;
  const renewable=sub.status!=="active" || remaining<=0 || expired;
  $("subscriptionTitle").innerText=renewable ? "اشتراكك يحتاج تجديد" : "اشتراكك نشط ✅";
  $("subscriptionMessage").innerText=renewable ? "يمكنك إرسال طلب التجديد بنفس بياناتك المحفوظة." : `تم تنفيذ ${used} من ${total} غسلات هذا الشهر.`;
  $("subscriptionExpiry").innerText=expires ? `ينتهي الاشتراك: ${expires.toLocaleDateString("ar-EG")}` : "";
  $("renewSubscriptionBtn").classList.toggle("hidden",!renewable);
  $("subscriptionForm").classList.toggle("hidden",!renewable);
  $("floatingOrderBtn").classList.toggle("hidden",!renewable);
}

async function loadSavedSubscription(){
  savedProfile=readProfile(); if(!savedProfile?.customerPhone||!savedProfile?.plateNumber)return false;
  fillProfile(savedProfile);
  try{
    const key=await subscriptionKey(currentProjectId,savedProfile.customerPhone,savedProfile.plateNumber);
    const snap=await getDoc(doc(db,"carwashSubscriptions",key));
    if(!snap.exists())return false;
    const data=snap.data(); if(data.projectId!==currentProjectId)return false;
    showSubscription({key,...data}); return true;
  }catch{return false;}
}

async function sendSubscriptionRequest(isRenewal=false){
  const profile=collectProfile(); const error=validateProfile(profile); const statusBox=isRenewal?$("renewStatus"):$("status");
  if(error){statusBox.innerText=error;return;}
  const btn=isRenewal?$("renewSubscriptionBtn"):$("submitOrder"); btn.disabled=true; statusBox.innerText=isRenewal?"جاري إرسال طلب التجديد...":"جاري إرسال طلب الاشتراك...";
  try{
    const key=await subscriptionKey(currentProjectId,profile.customerPhone,profile.plateNumber);
    const order={ projectId:currentProjectId, providerId:currentProjectId, templateType:"carwash", serviceType:"external_car_wash", planType:"monthly_new", renewal:isRenewal, subscriptionKey:key, packageWashes:pricing.monthlyWashes, ...profile, price:pricing.monthly, status:"new" };
    const res=await createOrder(order);
    if(res.success){ saveProfile(profile); statusBox.innerText=isRenewal?"تم إرسال طلب تجديد الاشتراك بنجاح 🎉":"تم إرسال طلب الاشتراك الشهري بنجاح 🎉"; btn.innerText="تم إرسال الطلب ✅"; }
    else statusBox.innerText=res.error;
  }catch(e){statusBox.innerText=e.message||"تعذر إرسال الطلب.";}
  btn.disabled=false;
}

$("getLocationBtn").onclick=()=>{ if(!navigator.geolocation){$("locationBtnText").innerText="الموقع غير مدعوم على هذا الجهاز";return;} const b=$("getLocationBtn");b.disabled=true;$("locationBtnText").innerText="جاري تحديد الموقع...";navigator.geolocation.getCurrentPosition(pos=>{$("location").value=`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;$("locationBtnText").innerText="تم تحديد الموقع ✅";b.disabled=false;},()=>{$("locationBtnText").innerText="تعذر تحديد الموقع — حاول مرة أخرى";b.disabled=false;},{enableHighAccuracy:true,timeout:10000}); };
$("floatingOrderBtn").onclick=()=>scrollToSection("bookingSection");
document.querySelectorAll(".navItem[data-target]").forEach(item=>item.onclick=()=>{document.querySelectorAll(".navItem").forEach(n=>n.classList.remove("active"));item.classList.add("active");scrollToSection(item.dataset.target);});
$("submitOrder").onclick=()=>sendSubscriptionRequest(false);
$("renewSubscriptionBtn").onclick=()=>sendSubscriptionRequest(true);
$("refreshSubscriptionBtn").onclick=async()=>{ $("subscriptionMessage").innerText="جاري تحديث الحالة..."; const ok=await loadSavedSubscription(); if(!ok)$("subscriptionMessage").innerText="لم يتم تفعيل اشتراكك بعد. إذا أرسلت الطلب حديثًا انتظر تأكيد مقدم الخدمة."; };

async function init(){
  currentProjectId=new URLSearchParams(location.search).get("project")||""; if(!currentProjectId){unavailable();return;}
  let snap; try{snap=await getDoc(doc(db,"projects",currentProjectId));}catch{unavailable();return;} if(!snap.exists()){unavailable();return;}
  const data=snap.data(); if(!data.isActive||data.status!=="active"||data.template!=="carwash"){unavailable();return;}
  $("businessTitle").innerText=data.businessName||"غسيل السيارات";
  pricing={monthly:Number(data.priceConfig?.monthly??data.priceConfig?.base??0),monthlyWashes:Math.max(1,Number(data.priceConfig?.monthlyWashes??4))};
  $("monthlyPlanPrice").innerText=pricing.monthly; $("monthlyWashesLabel").innerText=`${pricing.monthlyWashes} غسلات`; $("priceBox").innerText=`${pricing.monthly} جنيه`;
  if(data.whatsappNumber)$("whatsappBtn").href=`https://wa.me/${normalizeEgyptWhatsapp(data.whatsappNumber)}`;else $("whatsappBtn").style.display="none";
  if(data.instapayLink)$("paymentBtn").href=data.instapayLink;else $("paymentBtn").style.display="none";
  const found=await loadSavedSubscription();
  if(!found && savedProfile) fillProfile(savedProfile);
}
init();
