import auth from "../core/firebase/firebase-auth.js";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getSupermarket } from "../core/supermarket/supermarket-service.js";
import { SUPERMARKET_MASTER_CATALOG, MASTER_PRICE_META } from "../core/supermarket/master-catalog.js";
import {
  addStoreProduct,
  bulkAddMasterProducts,
  listStoreProducts,
  updateStoreProduct,
  findStoreProductByBarcode,
  bulkImportStoreProducts
} from "../core/supermarket/catalog-service.js";

import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const projectId=params.get("project")||"";
const inviteToken=params.get("invite")||"";
const inviteAuthEmail=buildOperatorAuthEmail(inviteToken);

let currentUser=null;
let operator=null;
let agreement=null;
let store=null;
let products=[];
let barcodeStream=null;
let searchText="";

function money(value){
  return `${Number(value||0).toLocaleString("ar-EG")} جنيه`;
}

function escapeHTML(value){
  return String(value??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function setVisible(id,visible){
  $(id).classList.toggle("hidden",!visible);
}

function dashboardUrl(){
  const url=new URL("./",location.href);
  url.searchParams.set("project",projectId);
  if(inviteToken)url.searchParams.set("invite",inviteToken);
  return url.toString();
}

async function authorize(){
  if(!currentUser||!projectId||!inviteAuthEmail)return false;

  try{
    await claimOperatorAccess(projectId,currentUser);
  }catch(e){
    if(e.message!=="OPERATOR_ALREADY_CLAIMED"){
      $("pageStatus").innerText=`تعذر فتح المكتبة: ${e.message}`;
      return false;
    }
  }

  [operator,agreement,store]=await Promise.all([
    getOperator(projectId),
    getCommissionAgreement(projectId),
    getSupermarket(projectId)
  ]);

  const canOperate=
    operatorCanOperate(operator)
    && agreement?.status==="accepted"
    && agreement?.currentAmount!=null;

  if(!canOperate){
    $("pageStatus").innerText="مكتبة المنتجات تتفعل بعد تفعيل حساب السوبرماركت وقبول العمولة.";
    return false;
  }

  $("pageStatus").innerText=`${store?.name||operator?.name||"السوبرماركت"} — اختار المنتجات والأسعار المناسبة لمحلك.`;
  return true;
}

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  $("backToDashboard").href=dashboardUrl();

  if(!projectId||!inviteAuthEmail){
    $("pageStatus").innerText="رابط مكتبة المنتجات غير مكتمل.";
    return;
  }

  if(user&&String(user.email||"").toLowerCase()!==inviteAuthEmail.toLowerCase()){
    await signOut(auth);
    return;
  }

  if(!user){
    $("pageStatus").innerText="سجل دخولك من لوحة تشغيل السوبرماركت أولًا ثم افتح مكتبة المنتجات.";
    return;
  }

  if(!await authorize())return;

  setVisible("productsPanel",true);

  // Render the starter library immediately so it never depends on orders/riders.
  renderMasterCatalog();

  try{
    await loadProducts();
    renderMasterCatalog();
  }catch(e){
    $("masterCatalogMessage").innerText=`المكتبة جاهزة، لكن تعذر تحميل منتجات المتجر الحالية: ${e.message}`;
  }
});

async function loadProducts(){
  products=await listStoreProducts(projectId);

  $("productsList").innerHTML=products.length
    ? products.map(product=>`
      <article class="rowCard" data-product-id="${product.productId}">
        <div class="rowTop">
          <div>
            <b>${escapeHTML(product.name)}</b>
            <div class="muted">${escapeHTML(product.category||"أخرى")} · ${escapeHTML(product.size||"")}</div>
          </div>
          <span class="pill">${product.inStock&&product.isActive?"متاح":"متوقف"}</span>
        </div>
        <div class="productControls">
          <input class="editPrice" type="number" min="0" step="0.25" value="${Number(product.price||0)}">
          <button class="secondary saveProduct">حفظ السعر</button>
          <button class="secondary toggleProduct">${product.inStock&&product.isActive?"إيقاف":"تفعيل"}</button>
        </div>
      </article>
    `).join("")
    : '<p class="muted">لسه مفيش منتجات في متجرك. اختار من المكتبة الجاهزة فوق.</p>';

  document.querySelectorAll("[data-product-id]").forEach(card=>{
    const id=card.dataset.productId;
    const product=products.find(item=>item.productId===id);

    card.querySelector(".saveProduct").onclick=async()=>{
      const btn=card.querySelector(".saveProduct");
      btn.disabled=true;
      try{
        await updateStoreProduct(projectId,id,currentUser.uid,{
          price:card.querySelector(".editPrice").value
        });
        await loadProducts();
        renderMasterCatalog();
      }catch(e){
        alert(e.message);
      }finally{
        btn.disabled=false;
      }
    };

    card.querySelector(".toggleProduct").onclick=async()=>{
      const active=!(product.inStock&&product.isActive);
      try{
        await updateStoreProduct(projectId,id,currentUser.uid,{
          inStock:active,
          isActive:active
        });
        await loadProducts();
        renderMasterCatalog();
      }catch(e){
        alert(e.message);
      }
    };
  });
}

function filteredMasterCatalog(){
  const q=searchText.trim().toLowerCase();
  if(!q)return SUPERMARKET_MASTER_CATALOG;

  return SUPERMARKET_MASTER_CATALOG.filter(item=>
    [item.name,item.category,item.size]
      .some(value=>String(value||"").toLowerCase().includes(q))
  );
}

function refreshMasterSelectionCount(){
  const available=[...document.querySelectorAll(".masterSelect:not(:disabled)")];
  const selected=available.filter(input=>input.checked);
  $("masterSelectionCount").innerText=`${selected.length} منتج محدد من ${available.length}`;
  $("addSelectedMasterBtn").disabled=selected.length===0;
}

function renderMasterCatalog(){
  $("masterPriceMeta").innerText=
    `${MASTER_PRICE_META.source} — تحديث ${MASTER_PRICE_META.priceAsOf}. ${MASTER_PRICE_META.note}.`;

  const existingByMaster=new Map(
    products.filter(item=>item.masterId).map(item=>[item.masterId,item])
  );

  const library=filteredMasterCatalog();

  $("masterCatalog").innerHTML=library.length
    ? library.map(item=>{
      const existing=existingByMaster.get(item.masterId);
      const added=Boolean(existing);
      const displayedPrice=added?Number(existing.price||0):Number(item.referencePrice||0);

      return `
        <article class="catalogItem ${added?"catalogItemAdded":""}">
          <label class="catalogSelect">
            <input class="masterSelect" type="checkbox" data-master-id="${item.masterId}" ${added?"disabled":"checked"}>
            <span>${added?"مضاف بالفعل":"اختيار"}</span>
          </label>
          <span class="pill">${escapeHTML(item.category)}</span>
          <h4>${escapeHTML(item.name)}</h4>
          <small class="muted">${escapeHTML(item.size||"")}</small>
          <div class="muted">سعر استرشادي: <b>${money(item.referencePrice)}</b></div>
          ${added?`<div class="currentStorePrice">سعر متجرك الحالي: <b>${money(existing.price)}</b></div>`:""}
          <input type="number" min="0" step="0.25" value="${displayedPrice}" data-master-price="${item.masterId}" ${added?"disabled":""}>
          <button class="secondary masterAdd" data-master-id="${item.masterId}" ${added?"disabled":""}>
            ${added?"مضاف بالفعل":"إضافة المنتج"}
          </button>
        </article>
      `;
    }).join("")
    : '<p class="muted">لا توجد منتجات مطابقة للبحث.</p>';

  document.querySelectorAll(".masterSelect").forEach(input=>{
    input.addEventListener("change",refreshMasterSelectionCount);
  });

  document.querySelectorAll(".masterAdd").forEach(btn=>{
    btn.onclick=async()=>{
      const id=btn.dataset.masterId;
      const item=SUPERMARKET_MASTER_CATALOG.find(entry=>entry.masterId===id);
      const price=document.querySelector(`[data-master-price="${id}"]`).value;
      btn.disabled=true;
      $("masterCatalogMessage").innerText="جاري إضافة المنتج...";

      try{
        await addStoreProduct(projectId,currentUser.uid,{
          masterId:id,
          price,
          name:item.name,
          category:item.category,
          size:item.size
        });
        await loadProducts();
        renderMasterCatalog();
        $("masterCatalogMessage").innerText=`تمت إضافة ${item.name} ✅`;
      }catch(e){
        btn.disabled=false;
        $("masterCatalogMessage").innerText=e.message;
      }
    };
  });

  refreshMasterSelectionCount();
}

$("masterSearch").addEventListener("input",event=>{
  searchText=event.target.value;
  renderMasterCatalog();
});

$("selectAllMasterBtn").onclick=()=>{
  document.querySelectorAll(".masterSelect:not(:disabled)").forEach(input=>input.checked=true);
  refreshMasterSelectionCount();
};

$("clearMasterSelectionBtn").onclick=()=>{
  document.querySelectorAll(".masterSelect:not(:disabled)").forEach(input=>input.checked=false);
  refreshMasterSelectionCount();
};

$("addSelectedMasterBtn").onclick=async()=>{
  const selections=[...document.querySelectorAll(".masterSelect:checked:not(:disabled)")].map(input=>{
    const masterId=input.dataset.masterId;
    return {
      masterId,
      price:document.querySelector(`[data-master-price="${masterId}"]`).value
    };
  });

  if(!selections.length){
    $("masterCatalogMessage").innerText="اختار منتج واحد على الأقل.";
    return;
  }

  $("addSelectedMasterBtn").disabled=true;
  $("masterCatalogMessage").innerText=`جاري إضافة ${selections.length} منتج...`;

  try{
    const result=await bulkAddMasterProducts(projectId,currentUser.uid,selections);
    await loadProducts();
    renderMasterCatalog();
    $("masterCatalogMessage").innerText=
      `تمت إضافة ${result.added} منتج للمحل ✅${result.skipped?` — تم تخطي ${result.skipped} مضافين بالفعل`:""}`;
  }catch(e){
    $("masterCatalogMessage").innerText=`تعذر إضافة المنتجات: ${e.message}`;
    refreshMasterSelectionCount();
  }
};

$("addProductBtn").onclick=async()=>{
  $("productMessage").innerText="جاري الإضافة...";

  try{
    await addStoreProduct(projectId,currentUser.uid,{
      name:$("productName").value,
      category:$("productCategory").value,
      price:$("productPrice").value,
      barcode:$("productBarcode").value,
      size:$("productSize").value,
      image:$("productImage").value
    });

    $("productMessage").innerText="تمت إضافة المنتج ✅";
    ["productName","productCategory","productPrice","productBarcode","productSize","productImage"]
      .forEach(id=>$(id).value="");

    await loadProducts();
    renderMasterCatalog();
  }catch(e){
    $("productMessage").innerText=e.message;
  }
};

async function scanBarcode(){
  const Detector=window.BarcodeDetector;

  if(!Detector||!navigator.mediaDevices?.getUserMedia){
    const manual=prompt("ميزة الكاميرا غير متاحة على الجهاز. اكتب الباركود:");
    if(manual)$("productBarcode").value=manual;
    return;
  }

  try{
    const detector=new Detector({
      formats:["ean_13","ean_8","upc_a","upc_e","code_128"]
    });

    barcodeStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:"environment"}
    });

    const video=$("barcodeVideo");
    video.srcObject=barcodeStream;
    video.classList.remove("hidden");
    await video.play();

    const started=Date.now();

    const detect=async()=>{
      if(!barcodeStream)return;

      const codes=await detector.detect(video);

      if(codes.length){
        const value=codes[0].rawValue;
        $("productBarcode").value=value;
        stopBarcode();

        const existing=await findStoreProductByBarcode(projectId,value);
        $("productMessage").innerText=existing
          ? `الباركود موجود بالفعل: ${existing.name}`
          : "تم قراءة الباركود. اكتب اسم المنتج والسعر ثم أضفه.";
        return;
      }

      if(Date.now()-started>15000){
        stopBarcode();
        $("productMessage").innerText="لم يتم التقاط باركود. جرّب الإضاءة أو أدخله يدويًا.";
        return;
      }

      setTimeout(detect,350);
    };

    detect();
  }catch(e){
    stopBarcode();
    $("productMessage").innerText=`تعذر تشغيل الكاميرا: ${e.message}`;
  }
}

function stopBarcode(){
  if(barcodeStream){
    barcodeStream.getTracks().forEach(track=>track.stop());
    barcodeStream=null;
  }
  $("barcodeVideo").classList.add("hidden");
}

$("scanBarcodeBtn").onclick=scanBarcode;

async function parseImportFile(file){
  const ext=file.name.split(".").pop().toLowerCase();

  if(ext==="csv"){
    const text=await file.text();
    const lines=text.split(/\r?\n/).filter(Boolean);
    if(!lines.length)return[];

    const headers=lines.shift().split(",").map(value=>value.trim());

    return lines.map(line=>{
      const values=line.split(",").map(value=>value.trim());
      return Object.fromEntries(headers.map((header,index)=>[header,values[index]??""]));
    });
  }

  if(!window.XLSX)throw new Error("XLSX_LIBRARY_NOT_READY");

  const data=await file.arrayBuffer();
  const workbook=window.XLSX.read(data,{type:"array"});
  const worksheet=workbook.Sheets[workbook.SheetNames[0]];

  return window.XLSX.utils.sheet_to_json(worksheet,{defval:""});
}

$("importBtn").onclick=async()=>{
  const file=$("importFile").files[0];

  if(!file){
    $("importMessage").innerText="اختار ملف الأول.";
    return;
  }

  $("importMessage").innerText="جاري الاستيراد...";

  try{
    const rows=await parseImportFile(file);
    const count=await bulkImportStoreProducts(projectId,currentUser.uid,rows);
    $("importMessage").innerText=`تم استيراد ${count} منتج ✅`;
    await loadProducts();
    renderMasterCatalog();
  }catch(e){
    $("importMessage").innerText=`فشل الاستيراد: ${e.message}`;
  }
};
