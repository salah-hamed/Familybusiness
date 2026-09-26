import auth from "../core/firebase/firebase-auth.js";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getSupermarket } from "../core/supermarket/supermarket-service.js";
import { SUPERMARKET_MASTER_CATALOG, MASTER_PRICE_META, canonicalMasterId } from "../core/supermarket/master-catalog.js";
import {
  addStoreProduct,
  bulkAddMasterProducts,
  deleteStoreProduct,
  syncLegacyMasterProductDetails,
  listStoreProducts,
  updateStoreProduct,
  findStoreProductByBarcode,
  bulkImportStoreProducts,
  mergeDuplicateStoreProducts,
  bulkUpdateStoreProducts,
  bulkDeleteStoreProducts,
  refreshSupermarketCatalogMeta
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

let masterSearchText="";
let masterCategoryFilter="الكل";
let masterRenderLimit=24;

let storeSearchText="";
let storeCategoryFilter="الكل";
let storeStatusFilter="الكل";
let storeImageFilter="الكل";
let storeRenderLimit=50;
const selectedStoreProducts=new Set();

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

function normalizeLookup(value){
  return String(value||"")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[أإآ]/g,"ا")
    .replace(/ى/g,"ي")
    .replace(/ة/g,"ه")
    .replace(/[^a-z0-9\u0600-\u06ff.]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function sizeKey(...values){
  const text=normalizeLookup(values.filter(Boolean).join(" "))
    .replace(/litres?|liters?|litre|liter|ltr/g," l ")
    .replace(/millilitres?|milliliters?|millilitre|milliliter|ml/g," ml ")
    .replace(/kilograms?|kilogram|kgs?|كجم/g," kg ")
    .replace(/grams?|gram|gms?|جم/g," g ")
    .replace(/لتر/g," l ")
    .replace(/مل/g," ml ")
    .replace(/×|x/gi," x ");

  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g|قطعه|قطع|عبوه|عبوات|رول|كيس|اكياس|pcs?)/g)]
    .map(match=>`${match[1]}${match[2]}`)
    .slice(0,3)
    .join("x");
}

function categoryEmoji(category){
  const value=String(category||"");
  if(/مياه|مشروبات|عصائر/.test(value))return "🥤";
  if(/ألبان|بيض|جبن/.test(value))return "🥛";
  if(/أرز|مكرونة|بقول|دقيق|سكر/.test(value))return "🌾";
  if(/زيوت|سمن/.test(value))return "🫗";
  if(/سناكس|بسكويت|شوكولاتة|حلويات/.test(value))return "🍫";
  if(/منظفات|منزل|ورقيات/.test(value))return "🧽";
  if(/عناية/.test(value))return "🧴";
  if(/مجمدات/.test(value))return "❄️";
  return "🛒";
}

function baseProductName(value){
  return normalizeLookup(value)
    .replace(/\b\d+(?:\.\d+)?\s*(ml|l|kg|g|مل|لتر|كجم|جم|قطعه|قطع|عبوه|عبوات|رول|كيس|اكياس|pcs?)\b/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function nameSimilarity(a,b){
  const compact=value=>baseProductName(value).replace(/\s+/g,"");
  const left=compact(a);
  const right=compact(b);

  if(!left||!right)return 0;
  if(left===right)return 1;

  const pairs=value=>value.length<2?[value]:Array.from({length:value.length-1},(_,index)=>value.slice(index,index+2));
  const aPairs=pairs(left);
  const bPairs=pairs(right);
  const counts=new Map();

  bPairs.forEach(pair=>counts.set(pair,(counts.get(pair)||0)+1));

  let overlap=0;
  aPairs.forEach(pair=>{
    const count=counts.get(pair)||0;
    if(!count)return;
    overlap++;
    counts.set(pair,count-1);
  });

  return (2*overlap)/(aPairs.length+bPairs.length);
}

function masterImageFor(item){
  if(item.image)return item.image;

  const direct=products.find(product=>
    canonicalMasterId(product.masterId)===item.masterId
    && product.image
  );
  if(direct?.image)return direct.image;

  const wantedSize=sizeKey(item.size,item.name);
  const brand=normalizeLookup(item.brand);
  const masterTokens=item.masterId
    .split("-")
    .map(normalizeLookup)
    .filter(token=>token.length>2&&!/^\d/.test(token));

  const brandCandidates=products
    .filter(product=>product.image)
    .map(product=>{
      const searchable=normalizeLookup([product.name,product.size].join(" "));
      const productSize=sizeKey(product.size,product.name);

      if(brand&&brand!=="local"&&!searchable.includes(brand))return null;
      if(wantedSize&&productSize&&wantedSize!==productSize)return null;

      const tokenScore=masterTokens.reduce(
        (score,token)=>score+(searchable.includes(token)?1:0),
        0
      );

      return {product,score:tokenScore};
    })
    .filter(Boolean)
    .sort((a,b)=>b.score-a.score);

  if(brandCandidates.length){
    if(brandCandidates.length===1)return brandCandidates[0].product.image;
    if(brandCandidates[0].score>brandCandidates[1].score)return brandCandidates[0].product.image;
    if(brandCandidates[0].score>=1)return brandCandidates[0].product.image;
  }

  let fuzzyBest=null;
  let fuzzyScore=0;

  products
    .filter(product=>product.image)
    .forEach(product=>{
      const productSize=sizeKey(product.size,product.name);
      if(wantedSize&&productSize&&wantedSize!==productSize)return;

      const score=nameSimilarity(product.name,item.name);
      if(score>=0.82&&score>fuzzyScore){
        fuzzyBest=product;
        fuzzyScore=score;
      }
    });

  return fuzzyBest?.image||"";
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

  $("pageStatus").innerText=`${store?.name||operator?.name||"السوبرماركت"} — إدارة المنتجات والتصنيفات والصور.`;
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
  initMasterCatalogFilters();
  renderMasterCatalog();

  try{
    await syncLegacyMasterProductDetails(projectId,currentUser.uid);
    await loadProducts();
    await refreshSupermarketCatalogMeta(projectId);
  }catch(e){
    $("masterCatalogMessage").innerText=`المكتبة جاهزة، لكن تعذر استكمال مزامنة بعض بيانات المتجر: ${e.message}`;
  }
});

function initMasterCatalogFilters(){
  const categories=[...new Set(SUPERMARKET_MASTER_CATALOG.map(item=>item.category))]
    .sort((a,b)=>a.localeCompare(b,"ar"));

  $("masterCategoryFilter").innerHTML=
    '<option value="الكل">كل التصنيفات</option>'
    +categories.map(value=>`<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");
}

function refreshStoreCategoryFilter(){
  const categories=[...new Set(products.map(item=>item.category||"أخرى"))]
    .sort((a,b)=>String(a).localeCompare(String(b),"ar"));

  const previous=storeCategoryFilter;
  $("storeCategoryFilter").innerHTML=
    '<option value="الكل">كل التصنيفات</option>'
    +categories.map(value=>`<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");

  if(previous==="الكل"||categories.includes(previous)){
    $("storeCategoryFilter").value=previous;
  }else{
    storeCategoryFilter="الكل";
  }
}

async function loadProducts(){
  products=await listStoreProducts(projectId);

  for(const id of [...selectedStoreProducts]){
    if(!products.some(item=>item.productId===id))selectedStoreProducts.delete(id);
  }

  refreshStoreCategoryFilter();
  renderStoreProducts();
  renderMasterCatalog();
}

function filteredStoreProducts(){
  const q=normalizeLookup(storeSearchText);

  return products.filter(product=>{
    const searchable=normalizeLookup([product.name,product.size,product.category].join(" "));
    const matchesSearch=!q||searchable.includes(q);
    const matchesCategory=storeCategoryFilter==="الكل"||(product.category||"أخرى")===storeCategoryFilter;
    const active=product.isActive===true&&product.inStock===true;
    const matchesStatus=
      storeStatusFilter==="الكل"
      ||(storeStatusFilter==="active"&&active)
      ||(storeStatusFilter==="paused"&&!active);
    const hasImage=Boolean(String(product.image||"").trim());
    const matchesImage=
      storeImageFilter==="الكل"
      ||(storeImageFilter==="with"&&hasImage)
      ||(storeImageFilter==="without"&&!hasImage);

    return matchesSearch&&matchesCategory&&matchesStatus&&matchesImage;
  });
}

function refreshBulkSelection(){
  $("bulkSelectionCount").innerText=`${selectedStoreProducts.size} محدد`;
  const disabled=selectedStoreProducts.size===0;
  ["bulkActivateBtn","bulkPauseBtn","bulkCategoryBtn","bulkDeleteBtn"]
    .forEach(id=>$(id).disabled=disabled);
}

function renderStoreProducts(){
  const filtered=filteredStoreProducts();
  const visible=filtered.slice(0,storeRenderLimit);

  $("storeProductsCount").innerText=`${filtered.length} من ${products.length} منتج`;
  $("loadMoreStoreBtn").classList.toggle("hidden",visible.length>=filtered.length);

  $("productsList").innerHTML=visible.length
    ?visible.map(product=>{
      const image=String(product.image||"").trim();
      return `
      <article class="rowCard productManagerCard" data-product-id="${product.productId}">
        <div class="productManagerTop">
          <label class="productSelect">
            <input class="storeProductSelect" type="checkbox" ${selectedStoreProducts.has(product.productId)?"checked":""}>
          </label>
          <div class="storeProductThumb">
            ${image?`<img src="${escapeHTML(image)}" alt="" loading="lazy">`:`<span>${categoryEmoji(product.category)}</span>`}
          </div>
          <div class="productManagerInfo">
            <b>${escapeHTML(product.name)}</b>
            <div class="muted">${escapeHTML(product.category||"أخرى")} · ${escapeHTML(product.size||"")}</div>
            <small class="muted">${image?"✅ صورة متاحة":"⚠️ بدون صورة"} · ${escapeHTML(product.source||"manual")}</small>
          </div>
          <span class="pill">${product.inStock&&product.isActive?"متاح":"متوقف"}</span>
        </div>

        <div class="productEditGrid">
          <label>اسم المنتج<input class="editName" value="${escapeHTML(product.name)}"></label>
          <label>التصنيف<input class="editCategory" value="${escapeHTML(product.category||"أخرى")}"></label>
          <label>الحجم<input class="editSize" value="${escapeHTML(product.size||"")}"></label>
          <label>السعر<input class="editPrice" type="number" min="0" step="0.25" value="${Number(product.price||0)}"></label>
          <label>رابط الصورة<input class="editImage" value="${escapeHTML(product.image||"")}" placeholder="https://..."></label>
        </div>

        <div class="productControls">
          <button class="primary saveProduct">حفظ التعديلات</button>
          <button class="secondary toggleProduct">${product.inStock&&product.isActive?"إيقاف مؤقت":"إعادة التفعيل"}</button>
          <button class="danger deleteProduct">حذف نهائي</button>
        </div>
      </article>`;
    }).join("")
    :'<p class="muted">لا توجد منتجات مطابقة للفلاتر الحالية.</p>';

  document.querySelectorAll("[data-product-id]").forEach(card=>{
    const id=card.dataset.productId;
    const product=products.find(item=>item.productId===id);

    card.querySelector(".storeProductSelect").onchange=event=>{
      if(event.target.checked)selectedStoreProducts.add(id);
      else selectedStoreProducts.delete(id);
      refreshBulkSelection();
    };

    card.querySelector(".saveProduct").onclick=async()=>{
      const btn=card.querySelector(".saveProduct");
      btn.disabled=true;

      try{
        await updateStoreProduct(projectId,id,currentUser.uid,{
          name:card.querySelector(".editName").value,
          category:card.querySelector(".editCategory").value,
          size:card.querySelector(".editSize").value,
          price:card.querySelector(".editPrice").value,
          image:card.querySelector(".editImage").value
        });
        await loadProducts();
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
      }catch(e){
        alert(e.message);
      }
    };

    card.querySelector(".deleteProduct").onclick=async()=>{
      if(!confirm(`حذف "${product.name}" نهائيًا؟`))return;
      try{
        await deleteStoreProduct(projectId,id);
        selectedStoreProducts.delete(id);
        await loadProducts();
      }catch(e){
        alert(e.message);
      }
    };
  });

  refreshBulkSelection();
}

function filteredMasterCatalog(){
  const q=masterSearchText.trim().toLowerCase();

  return SUPERMARKET_MASTER_CATALOG.filter(item=>{
    const matchesCategory=masterCategoryFilter==="الكل"||item.category===masterCategoryFilter;
    const matchesSearch=!q||[item.name,item.brand,item.category,item.size]
      .some(value=>String(value||"").toLowerCase().includes(q));

    return matchesCategory&&matchesSearch;
  });
}

function refreshMasterSelectionCount(){
  const available=[...document.querySelectorAll(".masterSelect:not(:disabled)")];
  const selected=available.filter(input=>input.checked);
  $("masterSelectionCount").innerText=`${selected.length} منتج محدد من ${available.length} ظاهر`;
  $("addSelectedMasterBtn").disabled=selected.length===0;
}

function renderMasterCatalog(){
  $("masterPriceMeta").innerText=
    `${MASTER_PRICE_META.source} — تحديث ${MASTER_PRICE_META.priceAsOf}. ${MASTER_PRICE_META.note}.`;

  const existingByMaster=new Map(
    products
      .filter(item=>item.masterId)
      .map(item=>[canonicalMasterId(item.masterId),item])
  );

  const library=filteredMasterCatalog();
  const visible=library.slice(0,masterRenderLimit);
  $("loadMoreMasterBtn").classList.toggle("hidden",visible.length>=library.length);

  $("masterCatalog").innerHTML=visible.length
    ?visible.map(item=>{
      const existing=existingByMaster.get(item.masterId);
      const added=Boolean(existing);
      const displayedPrice=added?Number(existing.price||0):Number(item.referencePrice||0);
      const image=masterImageFor(item);

      return `
        <article class="catalogItem ${added?"catalogItemAdded":""}">
          <div class="masterProductImage">
            ${image?`<img src="${escapeHTML(image)}" alt="" loading="lazy">`:`<span>${categoryEmoji(item.category)}</span>`}
          </div>
          <label class="catalogSelect">
            <input class="masterSelect" type="checkbox" data-master-id="${item.masterId}" ${added?"disabled":"checked"}>
            <span>${added?"مضاف بالفعل":"اختيار"}</span>
          </label>
          <span class="pill">${escapeHTML(item.category)}</span>
          <h4>${escapeHTML(item.name)}</h4>
          <small class="muted">${escapeHTML(item.brand||"")} · ${escapeHTML(item.size||"")}</small>
          <div class="muted">سعر استرشادي: <b>${money(item.referencePrice)}</b></div>
          ${added?`<div class="currentStorePrice">سعر متجرك الحالي: <b>${money(existing.price)}</b></div>`:""}
          <input type="number" min="0" step="0.25" value="${displayedPrice}" data-master-price="${item.masterId}" ${added?"disabled":""}>
          <button class="secondary masterAdd" data-master-id="${item.masterId}" ${added?"disabled":""}>
            ${added?"مضاف بالفعل":"إضافة المنتج"}
          </button>
        </article>`;
    }).join("")
    :'<p class="muted">لا توجد منتجات مطابقة للبحث.</p>';

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
          size:item.size,
          image:masterImageFor(item)
        });
        await loadProducts();
        $("masterCatalogMessage").innerText=`تمت إضافة ${item.name} ✅`;
      }catch(e){
        btn.disabled=false;
        $("masterCatalogMessage").innerText=
          e.message==="PRODUCT_ALREADY_EXISTS"
            ?"المنتج موجود بالفعل في متجرك بنفس الاسم والحجم."
            :e.message;
      }
    };
  });

  refreshMasterSelectionCount();
}

$("masterSearch").addEventListener("input",event=>{
  masterSearchText=event.target.value;
  masterRenderLimit=24;
  renderMasterCatalog();
});

$("masterCategoryFilter").addEventListener("change",event=>{
  masterCategoryFilter=event.target.value;
  masterRenderLimit=24;
  renderMasterCatalog();
});

$("loadMoreMasterBtn").onclick=()=>{
  masterRenderLimit+=24;
  renderMasterCatalog();
};

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
    $("masterCatalogMessage").innerText=
      `تمت إضافة ${result.added} منتج للمحل ✅${result.skipped?` — تم تخطي ${result.skipped} مضافين بالفعل`:""}`;
  }catch(e){
    $("masterCatalogMessage").innerText=`تعذر إضافة المنتجات: ${e.message}`;
    refreshMasterSelectionCount();
  }
};

$("storeProductSearch").addEventListener("input",event=>{
  storeSearchText=event.target.value;
  storeRenderLimit=50;
  renderStoreProducts();
});

$("storeCategoryFilter").addEventListener("change",event=>{
  storeCategoryFilter=event.target.value;
  storeRenderLimit=50;
  renderStoreProducts();
});

$("storeStatusFilter").addEventListener("change",event=>{
  storeStatusFilter=event.target.value;
  storeRenderLimit=50;
  renderStoreProducts();
});

$("storeImageFilter").addEventListener("change",event=>{
  storeImageFilter=event.target.value;
  storeRenderLimit=50;
  renderStoreProducts();
});

$("loadMoreStoreBtn").onclick=()=>{
  storeRenderLimit+=50;
  renderStoreProducts();
};

$("bulkActivateBtn").onclick=async()=>{
  try{
    await bulkUpdateStoreProducts(projectId,[...selectedStoreProducts],currentUser.uid,{isActive:true,inStock:true});
    selectedStoreProducts.clear();
    await loadProducts();
  }catch(e){alert(e.message);}
};

$("bulkPauseBtn").onclick=async()=>{
  try{
    await bulkUpdateStoreProducts(projectId,[...selectedStoreProducts],currentUser.uid,{isActive:false,inStock:false});
    selectedStoreProducts.clear();
    await loadProducts();
  }catch(e){alert(e.message);}
};

$("bulkCategoryBtn").onclick=async()=>{
  const category=prompt("اكتب التصنيف الجديد للمنتجات المحددة:");
  if(!category?.trim())return;

  try{
    await bulkUpdateStoreProducts(projectId,[...selectedStoreProducts],currentUser.uid,{category});
    selectedStoreProducts.clear();
    await loadProducts();
  }catch(e){alert(e.message);}
};

$("bulkDeleteBtn").onclick=async()=>{
  if(!selectedStoreProducts.size)return;
  if(!confirm(`حذف ${selectedStoreProducts.size} منتج نهائيًا؟`))return;

  try{
    await bulkDeleteStoreProducts(projectId,[...selectedStoreProducts]);
    selectedStoreProducts.clear();
    await loadProducts();
  }catch(e){alert(e.message);}
};

$("mergeDuplicatesBtn").onclick=async()=>{
  $("mergeDuplicatesBtn").disabled=true;
  $("duplicateMessage").innerText="جاري فحص المنتجات بالاسم والحجم...";

  try{
    const result=await mergeDuplicateStoreProducts(projectId,currentUser.uid);
    await loadProducts();

    $("duplicateMessage").innerText=result.groups
      ?`تم فحص الكتالوج ✅ تم دمج ${result.groups} مجموعة مكررة وحذف ${result.removed} نسخة زائدة، وإثراء ${result.enriched} منتج ببيانات ناقصة.`
      :"تم الفحص ✅ لم نجد تكرارات مؤكدة بالاسم والحجم.";
  }catch(e){
    $("duplicateMessage").innerText=`تعذر فحص التكرارات: ${e.message}`;
  }finally{
    $("mergeDuplicatesBtn").disabled=false;
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
  }catch(e){
    $("productMessage").innerText=
      e.message==="PRODUCT_ALREADY_EXISTS"
        ?"المنتج موجود بالفعل بنفس الاسم والحجم."
        :e.message;
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
          ?`الباركود موجود بالفعل: ${existing.name}`
          :"تم قراءة الباركود. الباركود مساعد فقط وليس أساس منع التكرار.";
        return;
      }

      if(Date.now()-started>15000){
        stopBarcode();
        $("productMessage").innerText="لم يتم التقاط باركود. تقدر تكمل بدونه.";
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

function normalizeImportHeader(value){
  return String(value??"").trim().toLowerCase().replace(/\s+/g," ");
}

function findImportHeaderRow(rows){
  const nameAliases=new Set(["name","product","اسم المنتج","المنتج","اسم الصنف"]);
  const priceAliases=new Set(["price","السعر","السعر (ج.م)","سعر","السعر بالجنيه"]);

  return rows.findIndex(row=>{
    const headers=(Array.isArray(row)?row:[]).map(normalizeImportHeader);
    return headers.some(value=>nameAliases.has(value))
      && headers.some(value=>priceAliases.has(value));
  });
}

function matrixToImportRows(matrix){
  if(!matrix.length)return[];

  const headerIndex=findImportHeaderRow(matrix);
  if(headerIndex<0)throw new Error("IMPORT_HEADERS_NOT_FOUND");

  const headers=matrix[headerIndex].map(value=>String(value??"").trim());

  return matrix
    .slice(headerIndex+1)
    .filter(row=>Array.isArray(row)&&row.some(value=>String(value??"").trim()!==""))
    .map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]??""])));
}

async function parseImportFile(file){
  if(!window.XLSX)throw new Error("XLSX_LIBRARY_NOT_READY");

  const ext=file.name.split(".").pop().toLowerCase();
  let workbook;

  if(ext==="csv"){
    const text=await file.text();
    workbook=window.XLSX.read(text,{type:"string"});
  }else{
    const data=await file.arrayBuffer();
    workbook=window.XLSX.read(data,{type:"array"});
  }

  const worksheet=workbook.Sheets[workbook.SheetNames[0]];
  const matrix=window.XLSX.utils.sheet_to_json(worksheet,{
    header:1,
    defval:"",
    raw:true
  });

  return matrixToImportRows(matrix);
}

$("importBtn").onclick=async()=>{
  const file=$("importFile").files[0];

  if(!file){
    $("importMessage").innerText="اختار ملف الأول.";
    return;
  }

  $("importMessage").innerText="جاري الاستيراد وتنظيف التكرارات...";

  try{
    const rows=await parseImportFile(file);
    const result=await bulkImportStoreProducts(projectId,currentUser.uid,rows);
    $("importMessage").innerText=
      `تمت معالجة ${result.imported} منتج ✅ — جديد: ${result.added} — موجود وتم إثراؤه: ${result.updated}`;
    await loadProducts();
  }catch(e){
    $("importMessage").innerText=`فشل الاستيراد: ${e.message}`;
  }
};
