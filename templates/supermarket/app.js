import db from "../../core/firebase/firebase-db.js";
import {
  createSupermarketOrder,
  getSupermarketOrderTracking,
  subscribeSupermarketOrderTracking
} from "../../core/supermarket/order-service.js";

import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  startAfter
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
const PAGE_SIZE=40;
let store=null;
let products=[];
const productCache=new Map();
let category="الكل";
let lastProductDoc=null;
let hasMoreProducts=true;
let loadingProducts=false;
let cart=new Map();
let locationUrl="";
const customerKey=`fb_supermarket_customer_${projectId}`;
const historyKey=`fb_supermarket_orders_${projectId}`;
const orderSubscriptions=new Map();
let trackedOrders=new Map();

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function qtyFor(id){return cart.get(id)||0;}

function categoryEmoji(value){
  const text=String(value||"");
  if(/مياه|مشروبات|عصائر/.test(text))return "🥤";
  if(/ألبان|بيض|جبن/.test(text))return "🥛";
  if(/أرز|مكرونة|بقول|دقيق|سكر/.test(text))return "🌾";
  if(/زيوت|سمن/.test(text))return "🫗";
  if(/سناكس|بسكويت|شوكولاتة|حلويات/.test(text))return "🍫";
  if(/منظفات|منزل|ورقيات/.test(text))return "🧽";
  if(/عناية/.test(text))return "🧴";
  if(/مجمدات/.test(text))return "❄️";
  if(/لحوم|دواجن/.test(text))return "🍗";
  if(/أسماك/.test(text))return "🐟";
  if(/خضروات|فواكه/.test(text))return "🥬";
  return "🛍️";
}

async function init(){
  if(!projectId){showClosed("رابط المشروع غير مكتمل.");return;}

  try{
    const [projectSnap,storeSnap]=await Promise.all([
      getDoc(doc(db,"projects",projectId)),
      getDoc(doc(db,"supermarkets",projectId))
    ]);

    if(!projectSnap.exists()||projectSnap.data().template!=="supermarket"){showClosed("المشروع غير متاح.");return;}
    if(!storeSnap.exists()){showClosed("السوبرماركت لسه ماكملش الإعداد.");return;}

    store={supermarketId:storeSnap.id,...storeSnap.data()};
    if(store.isAcceptingOrders!==true){showClosed("السوبرماركت موقف استقبال الطلبات مؤقتًا.");return;}

    $("storeName").innerText=store.name||"السوبرماركت";
    $("storeAddress").innerText=store.address||"";
    $("deliveryBadge").innerText=`التوصيل ${money(store.deliveryFee||0)}`;

    loadSavedCustomer();
    renderCategories();
    await loadProductsPage({reset:true});
    refreshCart();
    refreshOrdersButton();
  }catch(e){
    showClosed(e.code==="permission-denied"?"المشروع غير جاهز لاستقبال الطلبات بعد.":`تعذر تحميل المتجر: ${e.message}`);
  }
}

function showClosed(message){$("closedBanner").innerText=message;$("closedBanner").classList.remove("hidden");}

function availableCategories(){
  const configured=Array.isArray(store?.catalogCategories)
    ? store.catalogCategories.filter(Boolean)
    : [];
  const loaded=[...new Set([...productCache.values()].map(product=>product.category||"أخرى"))];
  return [...new Set([...configured,...loaded])].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
}

function renderCategories(){
  const cats=["الكل",...availableCategories()];
  $("categories").innerHTML=cats.map(c=>`<button class="${c===category?"active":""}" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  $("categories").querySelectorAll("button").forEach(btn=>btn.onclick=async()=>{
    const next=btn.dataset.category;
    if(next===category)return;
    category=next;
    renderCategories();
    await loadProductsPage({reset:true});
  });
}

async function loadProductsPage({reset=false}={}){
  if(loadingProducts)return;

  if(reset){
    products=[];
    lastProductDoc=null;
    hasMoreProducts=true;
    $("productsGrid").innerHTML='<p class="empty">جاري تحميل المنتجات...</p>';
  }

  if(!hasMoreProducts)return;

  loadingProducts=true;
  $("loadMoreProductsBtn").disabled=true;

  try{
    const base=collection(db,"supermarkets",projectId,"products");
    const constraints=[
      where("isActive","==",true),
      where("inStock","==",true)
    ];

    if(category!=="الكل"){
      constraints.push(where("category","==",category));
    }

    if(lastProductDoc){
      constraints.push(startAfter(lastProductDoc));
    }

    constraints.push(limit(PAGE_SIZE));

    const snap=await getDocs(query(base,...constraints));
    lastProductDoc=snap.docs.at(-1)||lastProductDoc;
    hasMoreProducts=snap.size===PAGE_SIZE;

    snap.docs
      .map(d=>({productId:d.id,...d.data()}))
      .forEach(product=>{
        productCache.set(product.productId,product);
        if(!products.some(item=>item.productId===product.productId)){
          products.push(product);
        }
      });

    renderCategories();
    renderProducts();
  }catch(e){
    $("productsGrid").innerHTML=`<p class="closed">تعذر تحميل المنتجات: ${escapeHTML(e.message)}</p>`;
  }finally{
    loadingProducts=false;
    $("loadMoreProductsBtn").disabled=false;
    $("loadMoreProductsBtn").classList.toggle("hidden",!hasMoreProducts);
  }
}

function renderProducts(){
  const q=$("searchInput").value.trim().toLowerCase();
  const visible=products.filter(p=>
    (category==="الكل"||(p.category||"أخرى")===category)
    && (
      !q
      || [p.name,p.size,p.category]
        .some(value=>String(value||"").toLowerCase().includes(q))
    )
  );
  $("emptyProducts").classList.toggle("hidden",visible.length>0);
  $("productsGrid").innerHTML=visible.map(p=>{
    const qty=qtyFor(p.productId);
    const image=p.image
      ?`<img src="${escapeHTML(p.image)}" alt="" loading="lazy">`
      :`<span>${categoryEmoji(p.category)}</span>`;
    return `<article class="productCard">
      <div class="productImage">${image}</div>
      <h3>${escapeHTML(p.name)}</h3>
      <div class="meta">${escapeHTML(p.size||p.category||"")}</div>
      <div class="priceRow">
        <span class="price">${money(p.price)}</span>
        <div class="qty">
          <button data-minus="${p.productId}">−</button><b>${qty}</b><button data-plus="${p.productId}">+</button>
        </div>
      </div>
    </article>`;
  }).join("");

  document.querySelectorAll("[data-plus]").forEach(btn=>btn.onclick=()=>changeQty(btn.dataset.plus,1));
  document.querySelectorAll("[data-minus]").forEach(btn=>btn.onclick=()=>changeQty(btn.dataset.minus,-1));
}

function changeQty(id,delta){
  if(!productCache.has(id))return;
  const next=Math.max(0,Math.min(99,qtyFor(id)+delta));
  if(next)cart.set(id,next);else cart.delete(id);
  renderProducts();
  refreshCart();

  if(cart.size){
    $("submitOrder").disabled=false;
    if($("orderStatus").innerText.startsWith("تم إرسال طلبك بنجاح")){
      $("orderStatus").innerText="";
    }
  }
}

function cartSummary(){
  const lines=[...cart.entries()].map(([id,quantity])=>{
    const product=productCache.get(id);
    return product?{...product,quantity,subtotal:Number(product.price||0)*quantity}:null;
  }).filter(Boolean);
  const subtotal=lines.reduce((s,x)=>s+x.subtotal,0);
  const delivery=Number(store?.deliveryFee||0);
  return {lines,subtotal,delivery,total:subtotal+delivery};
}

function refreshCart(){
  const {lines,total}=cartSummary();
  $("cartBar").classList.toggle("hidden",!lines.length);
  $("cartCount").innerText=lines.reduce((s,x)=>s+x.quantity,0);
  $("cartTotal").innerText=money(total);
}

function renderCart(){
  const {lines,subtotal,delivery,total}=cartSummary();

  $("cartItems").innerHTML=lines.length
    ? lines.map(line=>`
      <div class="cartLine" data-cart-product="${line.productId}">
        <div class="cartProductInfo">
          <b>${escapeHTML(line.name)}</b>
          <div class="meta">${money(line.price)} للقطعة</div>
        </div>

        <div class="cartQtyControls">
          <button type="button" data-cart-minus="${line.productId}">−</button>
          <b>${line.quantity}</b>
          <button type="button" data-cart-plus="${line.productId}">+</button>
        </div>

        <b class="cartLineTotal">${money(line.subtotal)}</b>
        <button type="button" class="removeCartItem" data-cart-remove="${line.productId}">حذف</button>
      </div>
    `).join("")
    : '<p class="emptyCart">السلة فاضية.</p>';

  $("subtotalText").innerText=money(subtotal);
  $("deliveryText").innerText=money(delivery);
  $("grandTotalText").innerText=money(total);

  document.querySelectorAll("[data-cart-plus]").forEach(btn=>btn.onclick=()=>{
    changeQty(btn.dataset.cartPlus,1);
    renderCart();
  });

  document.querySelectorAll("[data-cart-minus]").forEach(btn=>btn.onclick=()=>{
    changeQty(btn.dataset.cartMinus,-1);
    renderCart();
    if(!cart.size)$("cartSheet").classList.add("hidden");
  });

  document.querySelectorAll("[data-cart-remove]").forEach(btn=>btn.onclick=()=>{
    cart.delete(btn.dataset.cartRemove);
    renderProducts();
    refreshCart();
    renderCart();
    if(!cart.size)$("cartSheet").classList.add("hidden");
  });
}

$("searchInput").addEventListener("input",renderProducts);
$("loadMoreProductsBtn").onclick=()=>loadProductsPage();
$("cartBar").onclick=()=>{renderCart();$("cartSheet").classList.remove("hidden");};
$("closeCart").onclick=()=>$("cartSheet").classList.add("hidden");
$("cartSheet").addEventListener("click",e=>{if(e.target===$("cartSheet"))$("cartSheet").classList.add("hidden");});

$("locationBtn").onclick=()=>{
  if(!navigator.geolocation){$("locationStatus").innerText="الجهاز لا يدعم تحديد الموقع.";return;}
  $("locationStatus").innerText="جاري تحديد الموقع...";
  navigator.geolocation.getCurrentPosition(pos=>{
    locationUrl=`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
    $("locationStatus").innerText="تم حفظ اللوكيشن ✅";
  },()=>{$("locationStatus").innerText="تعذر الحصول على اللوكيشن. تقدر تكمل بالعنوان."},{enableHighAccuracy:true,timeout:12000});
};

function loadSavedCustomer(){
  try{
    const saved=JSON.parse(localStorage.getItem(customerKey)||"{}");
    $("customerName").value=saved.name||"";$("customerPhone").value=saved.phone||"";$("customerAddress").value=saved.address||"";
  }catch{}
}
function saveCustomer(){
  localStorage.setItem(customerKey,JSON.stringify({name:$("customerName").value.trim(),phone:$("customerPhone").value.trim(),address:$("customerAddress").value.trim()}));
}

function loadHistoryTokens(){
  try{
    const data=JSON.parse(localStorage.getItem(historyKey)||"[]");
    return Array.isArray(data)?data.filter(Boolean):[];
  }catch{
    return [];
  }
}

function rememberOrder(trackingToken){
  if(!trackingToken)return;
  const tokens=loadHistoryTokens().filter(token=>token!==trackingToken);
  tokens.unshift(trackingToken);
  localStorage.setItem(historyKey,JSON.stringify(tokens.slice(0,20)));
  refreshOrdersButton();
}

function refreshOrdersButton(){
  const count=loadHistoryTokens().length;
  $("myOrdersBtn").innerText=count?`📦 طلباتي (${count})`:"📦 طلباتي";
}

const statusSteps=[
  ["new","تم استلام الطلب"],
  ["accepted","تم قبول الطلب"],
  ["preparing","جاري تجهيز الطلب"],
  ["ready","الطلب جاهز"],
  ["assigned","تم تعيين المندوب"],
  ["out_for_delivery","خرج للتوصيل"],
  ["delivered","تم التوصيل"]
];

function statusLabel(status){
  return Object.fromEntries(statusSteps)[status]
    ||(status==="canceled"?"تم إلغاء الطلب":status||"—");
}

function formatOrderDate(value){
  const date=value?.toDate?.();
  if(!date)return "";
  return new Intl.DateTimeFormat("ar-EG",{dateStyle:"medium",timeStyle:"short"}).format(date);
}

function renderOrderTimeline(order){
  if(order.status==="canceled"){
    return '<div class="orderCanceled">تم إلغاء الطلب</div>';
  }

  const currentIndex=statusSteps.findIndex(([status])=>status===order.status);

  return `<div class="trackingTimeline">${statusSteps.map(([status,label],index)=>`
    <div class="trackingStep ${index<=currentIndex?"done":""} ${index===currentIndex?"current":""}">
      <span></span>
      <small>${label}</small>
    </div>`).join("")}</div>`;
}

function renderMyOrders(){
  const orders=[...trackedOrders.values()]
    .filter(Boolean)
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

  $("ordersList").innerHTML=orders.length
    ?orders.map(order=>{
      const items=(order.items||[])
        .map(item=>`${Number(item.quantity||0)} × ${escapeHTML(item.name)}`)
        .join("، ");

      return `<article class="customerOrderCard" data-tracking-token="${order.trackingToken}">
        <div class="orderCardHead">
          <div>
            <b>طلب #${escapeHTML(String(order.orderId||"").slice(0,7))}</b>
            <small>${escapeHTML(formatOrderDate(order.createdAt))}</small>
          </div>
          <span class="orderStatusBadge ${order.status==="delivered"?"delivered":order.status==="canceled"?"canceled":""}">
            ${escapeHTML(statusLabel(order.status))}
          </span>
        </div>
        <div class="orderItemsSummary">${items||"تفاصيل الطلب غير متاحة"}</div>
        <div class="orderTotal">الإجمالي: <b>${money(order.total)}</b></div>
        ${renderOrderTimeline(order)}
        <button class="secondary reorderBtn" type="button">إعادة نفس المنتجات للسلة</button>
      </article>`;
    }).join("")
    :'<p class="empty">لا توجد طلبات محفوظة على هذا الجهاز حتى الآن.</p>';

  document.querySelectorAll(".customerOrderCard").forEach(card=>{
    const order=trackedOrders.get(card.dataset.trackingToken);
    card.querySelector(".reorderBtn").onclick=()=>reorderTrackingOrder(order);
  });
}

async function loadMyOrders(){
  const tokens=loadHistoryTokens();

  if(!tokens.length){
    trackedOrders=new Map();
    renderMyOrders();
    return;
  }

  const results=await Promise.all(
    tokens.map(async token=>{
      try{
        return await getSupermarketOrderTracking(token);
      }catch{
        return null;
      }
    })
  );

  trackedOrders=new Map(
    results
      .filter(order=>order&&order.projectId===projectId)
      .map(order=>[order.trackingToken,order])
  );

  for(const [token,order] of trackedOrders){
    if(["delivered","canceled"].includes(order.status))continue;
    if(orderSubscriptions.has(token))continue;

    const unsubscribe=subscribeSupermarketOrderTracking(
      token,
      updated=>{
        if(!updated)return;
        trackedOrders.set(token,updated);
        renderMyOrders();

        if(["delivered","canceled"].includes(updated.status)){
          orderSubscriptions.get(token)?.();
          orderSubscriptions.delete(token);
        }
      }
    );

    orderSubscriptions.set(token,unsubscribe);
  }

  renderMyOrders();
}

async function reorderTrackingOrder(order){
  if(!order?.items?.length)return;

  let added=0;
  let unavailable=0;

  for(const item of order.items){
    try{
      const snap=await getDoc(doc(db,"supermarkets",projectId,"products",item.productId));

      if(!snap.exists()){
        unavailable++;
        continue;
      }

      const product={productId:snap.id,...snap.data()};

      if(product.isActive!==true||product.inStock!==true){
        unavailable++;
        continue;
      }

      productCache.set(product.productId,product);
      cart.set(
        product.productId,
        Math.min(99,qtyFor(product.productId)+Math.max(1,Number(item.quantity||1)))
      );
      added++;
    }catch{
      unavailable++;
    }
  }

  refreshCart();
  renderProducts();

  if(added){
    $("ordersSheet").classList.add("hidden");
    renderCart();
    $("cartSheet").classList.remove("hidden");
  }

  if(unavailable){
    $("orderStatus").innerText=`تمت إعادة المنتجات المتاحة. ${unavailable} منتج غير متاح حاليًا.`;
  }
}

$("myOrdersBtn").onclick=async()=>{
  $("ordersSheet").classList.remove("hidden");
  $("ordersList").innerHTML='<p class="empty">جاري تحميل طلباتك...</p>';
  await loadMyOrders();
};

$("closeOrders").onclick=()=>$("ordersSheet").classList.add("hidden");
$("ordersSheet").addEventListener("click",event=>{
  if(event.target===$("ordersSheet"))$("ordersSheet").classList.add("hidden");
});

$("submitOrder").onclick=async()=>{
  const extra=$("extraRequest").value.trim();
  const notes=[$("notes").value.trim(),extra?`طلب إضافي: ${extra}`:""].filter(Boolean).join("\n");
  $("orderStatus").innerText="جاري إرسال الطلب...";
  $("submitOrder").disabled=true;
  try{
    const result=await createSupermarketOrder({
      projectId,
      customerName:$("customerName").value,
      customerPhone:$("customerPhone").value,
      customerAddress:$("customerAddress").value,
      location:locationUrl,
      notes,
      cart:[...cart.entries()].map(([productId,quantity])=>({productId,quantity}))
    });
    saveCustomer();
    rememberOrder(result.trackingToken);
    cart.clear();
    refreshCart();
    renderProducts();
    renderCart();

    const successMessage=result.trackingEnabled
      ? `تم إرسال طلبك بنجاح ✅ رقم الطلب ${result.orderId.slice(0,7)} — الإجمالي ${money(result.total)}. تقدر تتابع حالته من «طلباتي».`
      : `تم إرسال طلبك بنجاح ✅ رقم الطلب ${result.orderId.slice(0,7)} — الإجمالي ${money(result.total)}.`;
    $("orderStatus").innerText=successMessage;
    $("submitOrder").disabled=true;

    setTimeout(()=>{
      $("cartSheet").classList.add("hidden");
    },900);
  }catch(e){
    const code=String(e?.code||"");
    const message=String(e?.message||"");

    const friendly=
      message==="EMPTY_CART"
        ?"السلة فارغة. أضف منتج واحد على الأقل قبل تأكيد الطلب."
        :code.includes("resource-exhausted")
          ?"تم الوصول مؤقتًا لحد استخدام قاعدة البيانات. جرّب مرة أخرى لاحقًا."
          :code.includes("permission-denied")
            ?"تعذر إرسال الطلب بسبب صلاحيات المشروع. أعد فتح رابط المتجر وحاول مرة أخرى."
            :message||"UNKNOWN_ERROR";

    $("orderStatus").innerText=`تعذر إرسال الطلب: ${friendly}`;
    $("submitOrder").disabled=false;
  }
};

init();
