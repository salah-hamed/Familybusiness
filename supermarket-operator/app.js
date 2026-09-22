import auth from "../core/firebase/firebase-auth.js";
import { claimOperatorAccess, getOperator, operatorCanOperate } from "../core/partners/partner-service.js";
import { acceptPendingCommission, rejectPendingCommission, getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getSupermarket, updateSupermarketSettings } from "../core/supermarket/supermarket-service.js";
import { SUPERMARKET_MASTER_CATALOG } from "../core/supermarket/master-catalog.js";
import { addStoreProduct, listStoreProducts, updateStoreProduct, findStoreProductByBarcode, bulkImportStoreProducts } from "../core/supermarket/catalog-service.js";
import { WORKER_ROLES, createWorker, listProjectWorkers, setWorkerActive } from "../core/workers/worker-service.js";
import { assignWorkerAndPrepareWhatsApp } from "../core/workers/worker-dispatch-service.js";
import { allowedNextSupermarketStatuses, listSupermarketOrders, changeSupermarketOrderStatus } from "../core/supermarket/order-service.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  onAuthStateChanged,
  reload
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
let currentUser=null;
let currentOperator=null;
let currentAgreement=null;
let currentStore=null;
let riders=[];
let products=[];
let orders=[];
let barcodeStream=null;

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function statusLabel(s){return ({new:"جديد",accepted:"مقبول",preparing:"جاري التحضير",ready:"جاهز",assigned:"تم تعيين مندوب",out_for_delivery:"خرج للتوصيل",delivered:"تم التوصيل",canceled:"ملغي"})[s]||s;}
function setVisible(id,visible){$(id).classList.toggle("hidden",!visible);}

async function refreshAccount(){
  if(!currentUser)return;
  await reload(currentUser);
  currentUser=auth.currentUser;

  if(!currentUser.emailVerified){
    setVisible("authPanel",false);setVisible("verifyPanel",true);setVisible("agreementPanel",false);setVisible("operationsPanel",false);
    $("pageStatus").innerText="فعّل الإيميل علشان نربطه بالسوبرماركت.";
    return;
  }

  try{
    await claimOperatorAccess(projectId,currentUser);
  }catch(e){
    if(!["OPERATOR_ALREADY_CLAIMED"].includes(e.message)){
      $("pageStatus").innerText=`تعذر ربط الحساب: ${e.message}`;
      return;
    }
  }

  currentOperator=await getOperator(projectId);
  currentAgreement=await getCommissionAgreement(projectId);
  currentStore=await getSupermarket(projectId);

  setVisible("authPanel",false);
  setVisible("verifyPanel",false);
  $("logoutBtn").classList.remove("hidden");

  const hasPending=currentAgreement?.pendingStatus==="pending" && currentAgreement?.pendingAmount!=null;
  setVisible("agreementPanel",hasPending);

  if(hasPending){
    const prefix=currentAgreement.currentAmount!=null
      ? `العمولة الحالية ${money(currentAgreement.currentAmount)} — التعديل المقترح`
      :"العمولة المقترحة";
    $("agreementText").innerText=`${prefix}: ${money(currentAgreement.pendingAmount)} لكل طلب مكتمل`;
  }

  const canOperate=operatorCanOperate(currentOperator)&&currentAgreement?.status==="accepted"&&currentAgreement?.currentAmount!=null;
  setVisible("operationsPanel",canOperate);
  $("pageStatus").innerText=canOperate
    ?`مرحبًا ${currentOperator?.name||"بالسوبرماركت"} — لوحة التشغيل جاهزة.`
    :"لا يمكن تشغيل الطلبات قبل قبول أول اتفاق عمولة.";

  if(canOperate) await loadOperations();
}

onAuthStateChanged(auth,user=>{
  currentUser=user;
  if(!user){
    setVisible("authPanel",true);setVisible("verifyPanel",false);setVisible("agreementPanel",false);setVisible("operationsPanel",false);
    $("logoutBtn").classList.add("hidden");
    return;
  }
  refreshAccount();
});

$("registerBtn").onclick=async()=>{
  $("authMessage").innerText="جاري إنشاء الحساب...";
  try{
    const cred=await createUserWithEmailAndPassword(auth,$("authEmail").value.trim(),$("authPassword").value);
    await sendEmailVerification(cred.user);
    $("authMessage").innerText="تم إنشاء الحساب. افتح رسالة التفعيل في الإيميل ثم ارجع هنا ✅";
  }catch(e){$("authMessage").innerText=e.message;}
};
$("loginBtn").onclick=async()=>{
  $("authMessage").innerText="جاري تسجيل الدخول...";
  try{
    await signInWithEmailAndPassword(auth,$("authEmail").value.trim(),$("authPassword").value);
    $("authMessage").innerText="";
  }catch(e){$("authMessage").innerText=e.message;}
};
$("logoutBtn").onclick=()=>signOut(auth);
$("resendVerifyBtn").onclick=async()=>{if(auth.currentUser){await sendEmailVerification(auth.currentUser);$("verifyMessage").innerText="تم إرسال رسالة تفعيل جديدة.";}};
$("checkVerifyBtn").onclick=()=>refreshAccount();

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
  }

  await Promise.all([loadProducts(),loadRiders(),loadOrders()]);
  renderMasterCatalog();
}

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

async function loadProducts(){
  products=await listStoreProducts(projectId);
  $("productsList").innerHTML=products.length?products.map(p=>`
    <article class="rowCard" data-product-id="${p.productId}">
      <div class="rowTop"><div><b>${escapeHTML(p.name)}</b><div class="muted">${escapeHTML(p.category||"أخرى")} ${escapeHTML(p.size||"")}</div></div><span class="pill">${p.inStock&&p.isActive?"متاح":"متوقف"}</span></div>
      <div class="productControls">
        <input class="editPrice" type="number" min="0" step="0.25" value="${Number(p.price||0)}">
        <button class="secondary saveProduct">حفظ السعر</button>
        <button class="secondary toggleProduct">${p.inStock&&p.isActive?"إيقاف":"تفعيل"}</button>
      </div>
    </article>`).join(""):'<p class="muted">لسه مفيش منتجات. ابدأ من المكتبة الجاهزة أو أضف منتج.</p>';

  document.querySelectorAll("[data-product-id]").forEach(card=>{
    const id=card.dataset.productId;
    const product=products.find(p=>p.productId===id);
    card.querySelector(".saveProduct").onclick=async()=>{
      await updateStoreProduct(projectId,id,currentUser.uid,{price:card.querySelector(".editPrice").value});
      await loadProducts();
    };
    card.querySelector(".toggleProduct").onclick=async()=>{
      const active=!(product.inStock&&product.isActive);
      await updateStoreProduct(projectId,id,currentUser.uid,{inStock:active,isActive:active});
      await loadProducts();
    };
  });
}

$("addProductBtn").onclick=async()=>{
  $("productMessage").innerText="جاري الإضافة...";
  try{
    await addStoreProduct(projectId,currentUser.uid,{
      name:$("productName").value,category:$("productCategory").value,price:$("productPrice").value,
      barcode:$("productBarcode").value,size:$("productSize").value,image:$("productImage").value
    });
    $("productMessage").innerText="تمت إضافة المنتج ✅";
    ["productName","productCategory","productPrice","productBarcode","productSize","productImage"].forEach(id=>$(id).value="");
    await loadProducts();
  }catch(e){$("productMessage").innerText=e.message;}
};

function renderMasterCatalog(){
  $("masterCatalog").innerHTML=SUPERMARKET_MASTER_CATALOG.map(item=>`
    <article class="catalogItem">
      <span class="pill">${escapeHTML(item.category)}</span>
      <h4>${escapeHTML(item.name)}</h4>
      <small class="muted">${escapeHTML(item.size||"")}</small>
      <input type="number" min="0" step="0.25" placeholder="السعر" data-master-price="${item.masterId}">
      <button class="secondary masterAdd" data-master-id="${item.masterId}">إضافة</button>
    </article>`).join("");

  document.querySelectorAll(".masterAdd").forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.masterId;
    const item=SUPERMARKET_MASTER_CATALOG.find(x=>x.masterId===id);
    const price=document.querySelector(`[data-master-price="${id}"]`).value;
    try{await addStoreProduct(projectId,currentUser.uid,{masterId:id,price,name:item.name,category:item.category,size:item.size});await loadProducts();}
    catch(e){$("productMessage").innerText=e.message;}
  });
}

async function scanBarcode(){
  const Detector=window.BarcodeDetector;
  if(!Detector||!navigator.mediaDevices?.getUserMedia){
    const manual=prompt("ميزة الكاميرا غير متاحة على الجهاز. اكتب الباركود:");
    if(manual) $("productBarcode").value=manual;
    return;
  }

  try{
    const detector=new Detector({formats:["ean_13","ean_8","upc_a","upc_e","code_128"]});
    barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    const video=$("barcodeVideo");video.srcObject=barcodeStream;video.classList.remove("hidden");await video.play();
    const started=Date.now();

    const detect=async()=>{
      if(!barcodeStream)return;
      const codes=await detector.detect(video);
      if(codes.length){
        const value=codes[0].rawValue;
        $("productBarcode").value=value;
        stopBarcode();
        const existing=await findStoreProductByBarcode(projectId,value);
        $("productMessage").innerText=existing?`الباركود موجود بالفعل: ${existing.name}`:"تم قراءة الباركود. اكتب اسم المنتج والسعر ثم أضفه.";
        return;
      }
      if(Date.now()-started>15000){stopBarcode();$("productMessage").innerText="لم يتم التقاط باركود. جرّب الإضاءة أو أدخله يدويًا.";return;}
      setTimeout(detect,350);
    };
    detect();
  }catch(e){stopBarcode();$("productMessage").innerText=`تعذر تشغيل الكاميرا: ${e.message}`;}
}
function stopBarcode(){if(barcodeStream){barcodeStream.getTracks().forEach(t=>t.stop());barcodeStream=null;}$("barcodeVideo").classList.add("hidden");}
$("scanBarcodeBtn").onclick=scanBarcode;

async function parseImportFile(file){
  const ext=file.name.split(".").pop().toLowerCase();
  if(ext==="csv"){
    const text=await file.text();
    const lines=text.split(/\r?\n/).filter(Boolean);
    if(!lines.length)return[];
    const headers=lines.shift().split(",").map(x=>x.trim());
    return lines.map(line=>{
      const values=line.split(",").map(x=>x.trim());
      return Object.fromEntries(headers.map((h,i)=>[h,values[i]??""]));
    });
  }

  if(!window.XLSX)throw new Error("XLSX_LIBRARY_NOT_READY");
  const data=await file.arrayBuffer();
  const wb=window.XLSX.read(data,{type:"array"});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws,{defval:""});
}
$("importBtn").onclick=async()=>{
  const file=$("importFile").files[0];if(!file){$("importMessage").innerText="اختار ملف الأول.";return;}
  $("importMessage").innerText="جاري الاستيراد...";
  try{const rows=await parseImportFile(file);const count=await bulkImportStoreProducts(projectId,currentUser.uid,rows);$("importMessage").innerText=`تم استيراد ${count} منتج ✅`;await loadProducts();}
  catch(e){$("importMessage").innerText=`فشل الاستيراد: ${e.message}`;}
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

async function loadOrders(){
  orders=await listSupermarketOrders(projectId);
  const active=orders.filter(o=>!["new","delivered","canceled"].includes(o.status)).length;
  $("statNew").innerText=orders.filter(o=>o.status==="new").length;
  $("statActive").innerText=active;
  $("statDelivered").innerText=orders.filter(o=>o.status==="delivered").length;

  $("ordersList").innerHTML=orders.length?orders.map(o=>{
    const items=(o.items||[]).map(i=>`${i.quantity} × ${escapeHTML(i.name)}`).join("<br>");
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
      try{await changeSupermarketOrderStatus({projectId,orderId:order.orderId,actorUid:currentUser.uid,nextStatus:btn.dataset.next});await loadOrders();}
      catch(e){alert(e.message);}finally{btn.disabled=false;}
    });

    card.querySelector(".assignRider")?.addEventListener("click",async()=>{
      const workerId=card.querySelector(".riderSelect").value;
      if(!workerId){alert("اختار المندوب الأول");return;}
      try{
        const result=await assignWorkerAndPrepareWhatsApp({projectId,orderId:order.orderId,workerId,actorUid:currentUser.uid});
        await changeSupermarketOrderStatus({projectId,orderId:order.orderId,actorUid:currentUser.uid,nextStatus:"assigned"});
        window.open(result.whatsappUrl,"_blank","noopener");
        await loadOrders();
      }catch(e){alert(e.message);}
    });

    card.querySelector(".resendWhatsapp")?.addEventListener("click",()=>{
      const rider=riders.find(r=>r.workerId===order.assignedWorkerId);
      if(!rider)return;
      import("../core/whatsapp/dispatch-service.js").then(({buildWorkerWhatsAppUrl})=>{
        window.open(buildWorkerWhatsAppUrl({templateId:"supermarket",orderId:order.orderId,order,worker:rider}),"_blank","noopener");
      });
    });
  });
}
$("refreshOrdersBtn").onclick=loadOrders;

document.querySelectorAll(".tabs button").forEach(btn=>btn.onclick=()=>document.getElementById(btn.dataset.target)?.scrollIntoView({behavior:"smooth",block:"start"}));
