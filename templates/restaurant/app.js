import db from "../../core/firebase/firebase-db.js";
import {
  createRestaurantOrder,
  getRestaurantOrderTracking,
  subscribeRestaurantOrderTracking
} from "../../core/restaurant/order-service.js";
import { listRestaurantMenuPage } from "../../core/restaurant/menu-service.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
const PAGE_SIZE=40;

let restaurant=null;
let menu=[];
const menuCache=new Map();
let category="الكل";
let lastMenuDoc=null;
let hasMoreMenu=true;
let loadingMenu=false;
let cart=new Map();
let locationUrl="";
const customerKey=`fb_restaurant_customer_${projectId}`;
const historyKey=`fb_restaurant_orders_${projectId}`;
const orderSubscriptions=new Map();
let trackedOrders=new Map();

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function qtyFor(id){return cart.get(id)||0;}

function categoryEmoji(value){
  const text=String(value||"");
  if(/مشويات|لحوم|فراخ|دجاج/.test(text))return "🍗";
  if(/بيتزا/.test(text))return "🍕";
  if(/برجر/.test(text))return "🍔";
  if(/حلويات/.test(text))return "🍰";
  if(/مشروبات|عصائر/.test(text))return "🥤";
  if(/سمك|أسماك/.test(text))return "🐟";
  if(/فطار|إفطار/.test(text))return "🍳";
  return "🍽️";
}

function availableCategories(){
  const configured=Array.isArray(restaurant?.menuCategories)
    ? restaurant.menuCategories.filter(Boolean)
    : [];
  const loaded=[...new Set([...menuCache.values()].map(item=>item.category||"أخرى"))];
  return [...new Set([...configured,...loaded])].sort((a,b)=>String(a).localeCompare(String(b),"ar"));
}

async function init(){
  if(!projectId||!projectId.endsWith("_restaurant")){showClosed("رابط المشروع غير مكتمل.");return;}

  try{
    const restaurantSnap=await getDoc(doc(db,"restaurants",projectId));

    if(!restaurantSnap.exists()){
      showClosed("المطعم لسه ماكملش الإعداد.");
      return;
    }

    restaurant={restaurantId:restaurantSnap.id,...restaurantSnap.data()};

    if(restaurant.isAcceptingOrders!==true){
      showClosed("المطعم موقف استقبال الطلبات مؤقتًا.");
      return;
    }

    applyIdentity();
    loadSavedCustomer();
    renderCategories();
    await loadMenuPage({reset:true});
    refreshCart();
    refreshOrdersButton();
  }catch(e){
    showClosed(e.code==="permission-denied"
      ?"المشروع غير جاهز لاستقبال الطلبات بعد."
      :`تعذر تحميل المطعم: ${e.message}`);
  }
}

function applyIdentity(){
  const primary=/^#[0-9a-fA-F]{6}$/.test(restaurant.primaryColor||"")
    ?restaurant.primaryColor
    :"#EA580C";

  document.documentElement.style.setProperty("--brand",primary);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",primary);

  const installName=restaurant.name||"المطعم";
  $("restaurantName").innerText=installName;
  window.FamilyBusinessPwa?.setBrand(installName);
  $("restaurantSlogan").innerText=restaurant.slogan||"";
  $("cuisineText").innerText=restaurant.cuisine||"";
  $("restaurantAddress").innerText=restaurant.address||"";
  $("deliveryBadge").innerText=`التوصيل ${money(restaurant.deliveryFee||0)}`;

  if(restaurant.logo){
    const image=document.createElement("img");
    image.src=restaurant.logo;
    image.alt="";
    image.referrerPolicy="no-referrer";
    image.onerror=()=>{$("restaurantLogo").innerHTML="🍽️";};
    $("restaurantLogo").innerHTML="";
    $("restaurantLogo").appendChild(image);
  }

  if(restaurant.coverImage){
    const tester=new Image();
    tester.onload=()=>{
      $("restaurantHero").style.backgroundImage=
        `linear-gradient(rgba(0,0,0,.48),rgba(0,0,0,.55)),url("${restaurant.coverImage.replace(/"/g,"%22")}")`;
    };
    tester.onerror=()=>{};
    tester.src=restaurant.coverImage;
  }
}

function showClosed(message){
  $("closedBanner").innerText=message;
  $("closedBanner").classList.remove("hidden");
}

function renderCategories(){
  const cats=["الكل",...availableCategories()];
  $("categories").innerHTML=cats.map(c=>`<button class="${c===category?"active":""}" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  $("categories").querySelectorAll("button").forEach(btn=>btn.onclick=async()=>{
    const next=btn.dataset.category;
    if(next===category)return;
    category=next;
    renderCategories();
    await loadMenuPage({reset:true});
  });
}

async function loadMenuPage({reset=false}={}){
  if(loadingMenu)return;

  if(reset){
    menu=[];
    lastMenuDoc=null;
    hasMoreMenu=true;
    $("menuGrid").innerHTML='<p class="empty">جاري تحميل المنيو...</p>';
  }

  if(!hasMoreMenu)return;

  loadingMenu=true;
  $("loadMoreMenuBtn").disabled=true;

  try{
    const result=await listRestaurantMenuPage(projectId,{
      pageSize:PAGE_SIZE,
      cursor:lastMenuDoc,
      category
    });

    lastMenuDoc=result.cursor;
    hasMoreMenu=result.hasMore;

    result.items.forEach(item=>{
      menuCache.set(item.itemId,item);
      if(!menu.some(existing=>existing.itemId===item.itemId)){
        menu.push(item);
      }
    });

    renderCategories();
    renderMenu();
  }catch(e){
    $("menuGrid").innerHTML=`<p class="closed">تعذر تحميل المنيو: ${escapeHTML(e.message)}</p>`;
  }finally{
    loadingMenu=false;
    $("loadMoreMenuBtn").disabled=false;
    $("loadMoreMenuBtn").classList.toggle("hidden",!hasMoreMenu);
  }
}

function renderMenu(){
  const q=$("searchInput").value.trim().toLowerCase();

  const visible=menu.filter(item=>
    !q||[item.name,item.description,item.category].some(v=>String(v||"").toLowerCase().includes(q))
  );

  $("emptyMenu").classList.toggle("hidden",visible.length>0);

  $("menuGrid").innerHTML=visible.map(item=>{
    const qty=qtyFor(item.itemId);
    const image=item.image
      ?`<img src="${escapeHTML(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.textContent='${categoryEmoji(item.category)}'">`
      :categoryEmoji(item.category);

    return `<article class="menuCard">
      <div class="menuImage">${image}</div>
      <div class="menuBody">
        <span class="categoryPill">${escapeHTML(item.category||"أخرى")}</span>
        <h3>${escapeHTML(item.name)}</h3>
        <p>${escapeHTML(item.description||"")}</p>
        <div class="priceRow">
          <span class="price">${money(item.price)}</span>
          <div class="qty">
            <button data-minus="${item.itemId}">−</button>
            <b>${qty}</b>
            <button data-plus="${item.itemId}">+</button>
          </div>
        </div>
      </div>
    </article>`;
  }).join("");

  document.querySelectorAll("[data-plus]").forEach(btn=>btn.onclick=()=>changeQty(btn.dataset.plus,1));
  document.querySelectorAll("[data-minus]").forEach(btn=>btn.onclick=()=>changeQty(btn.dataset.minus,-1));
}

function changeQty(id,delta){
  if(!menuCache.has(id))return;
  const next=Math.max(0,Math.min(99,qtyFor(id)+delta));
  if(next)cart.set(id,next);else cart.delete(id);
  renderMenu();
  refreshCart();

  if(cart.size)$("submitOrder").disabled=false;
}

function cartSummary(){
  const lines=[...cart.entries()].map(([id,quantity])=>{
    const item=menuCache.get(id);
    return item?{...item,quantity,subtotal:Number(item.price||0)*quantity}:null;
  }).filter(Boolean);

  const subtotal=lines.reduce((sum,item)=>sum+item.subtotal,0);
  const delivery=Number(restaurant?.deliveryFee||0);

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
    ?lines.map(line=>`<div class="cartLine">
      <div>
        <b>${escapeHTML(line.name)}</b>
        <div class="meta">${money(line.price)} للقطعة</div>
      </div>
      <div class="cartQtyControls">
        <button data-cart-minus="${line.itemId}">−</button>
        <b>${line.quantity}</b>
        <button data-cart-plus="${line.itemId}">+</button>
      </div>
      <b>${money(line.subtotal)}</b>
      <button class="removeCartItem" data-cart-remove="${line.itemId}">حذف</button>
    </div>`).join("")
    :'<p class="empty">السلة فاضية.</p>';

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
    renderMenu();
    refreshCart();
    renderCart();
    if(!cart.size)$("cartSheet").classList.add("hidden");
  });
}

$("searchInput").addEventListener("input",renderMenu);
$("loadMoreMenuBtn").onclick=()=>loadMenuPage();
$("cartBar").onclick=()=>{renderCart();$("cartSheet").classList.remove("hidden");};
$("closeCart").onclick=()=>$("cartSheet").classList.add("hidden");
$("cartSheet").addEventListener("click",e=>{if(e.target===$("cartSheet"))$("cartSheet").classList.add("hidden");});

$("locationBtn").onclick=()=>{
  if(!navigator.geolocation){$("locationStatus").innerText="الجهاز لا يدعم تحديد الموقع.";return;}
  $("locationStatus").innerText="جاري تحديد الموقع...";
  navigator.geolocation.getCurrentPosition(pos=>{
    locationUrl=`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
    $("locationStatus").innerText="تم حفظ اللوكيشن ✅";
  },()=>{$("locationStatus").innerText="تعذر الحصول على اللوكيشن. تقدر تكمل بالعنوان.";},{enableHighAccuracy:true,timeout:12000});
};

function loadSavedCustomer(){
  try{
    const saved=JSON.parse(localStorage.getItem(customerKey)||"{}");
    $("customerName").value=saved.name||"";
    $("customerPhone").value=saved.phone||"";
    $("customerAddress").value=saved.address||"";
  }catch{}
}

function saveCustomer(){
  localStorage.setItem(customerKey,JSON.stringify({
    name:$("customerName").value.trim(),
    phone:$("customerPhone").value.trim(),
    address:$("customerAddress").value.trim()
  }));
}

function loadHistoryTokens(){
  try{
    const data=JSON.parse(localStorage.getItem(historyKey)||"[]");
    return Array.isArray(data)?data.filter(Boolean):[];
  }catch{return [];}
}

function rememberOrder(token){
  if(!token)return;
  const tokens=loadHistoryTokens().filter(item=>item!==token);
  tokens.unshift(token);
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
  ["preparing","جاري التحضير"],
  ["ready","الطلب جاهز"],
  ["assigned","تم تعيين المندوب"],
  ["out_for_delivery","خرج للتوصيل"],
  ["delivered","تم التوصيل"]
];

function statusLabel(status){
  return Object.fromEntries(statusSteps)[status]||(status==="canceled"?"تم إلغاء الطلب":status||"—");
}

function renderTimeline(order){
  if(order.status==="canceled")return '<div class="orderCanceled">تم إلغاء الطلب</div>';
  const current=statusSteps.findIndex(([status])=>status===order.status);

  return `<div class="trackingTimeline">${statusSteps.map(([status,label],index)=>`
    <div class="trackingStep ${index<=current?"done":""} ${index===current?"current":""}">
      <span></span><small>${label}</small>
    </div>`).join("")}</div>`;
}

function renderMyOrders(){
  const orders=[...trackedOrders.values()]
    .filter(Boolean)
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

  $("ordersList").innerHTML=orders.length
    ?orders.map(order=>`
      <article class="customerOrderCard" data-tracking-token="${order.trackingToken}">
        <div class="orderCardHead">
          <b>طلب #${escapeHTML(String(order.orderId||"").slice(0,7))}</b>
          <span class="orderStatusBadge">${escapeHTML(statusLabel(order.status))}</span>
        </div>
        <div class="orderItemsSummary">${(order.items||[]).map(item=>`${Number(item.quantity||0)} × ${escapeHTML(item.name)}`).join("، ")}</div>
        <div class="orderTotal">الإجمالي: <b>${money(order.total)}</b></div>
        ${renderTimeline(order)}
        <button class="secondary reorderBtn" type="button">إعادة نفس الطلب</button>
      </article>`).join("")
    :'<p class="empty">لا توجد طلبات محفوظة على هذا الجهاز حتى الآن.</p>';

  document.querySelectorAll(".customerOrderCard").forEach(card=>{
    const order=trackedOrders.get(card.dataset.trackingToken);
    card.querySelector(".reorderBtn").onclick=()=>reorderTrackingOrder(order);
  });
}

async function loadMyOrders(){
  const tokens=loadHistoryTokens();

  const results=await Promise.all(tokens.map(async token=>{
    try{return await getRestaurantOrderTracking(token);}catch{return null;}
  }));

  trackedOrders=new Map(
    results.filter(order=>order&&order.projectId===projectId).map(order=>[order.trackingToken,order])
  );

  for(const [token,order] of trackedOrders){
    if(["delivered","canceled"].includes(order.status)||orderSubscriptions.has(token))continue;

    const unsubscribe=subscribeRestaurantOrderTracking(token,updated=>{
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

async function reorderTrackingOrder(order){
  if(!order?.items?.length)return;

  let added=0;
  let unavailable=0;

  for(const item of order.items){
    try{
      const snap=await getDoc(doc(db,"restaurants",projectId,"menu",item.itemId));
      if(!snap.exists()){unavailable++;continue;}

      const fresh={itemId:snap.id,...snap.data()};
      if(fresh.isActive!==true||fresh.isAvailable!==true){unavailable++;continue;}

      menuCache.set(fresh.itemId,fresh);
      cart.set(fresh.itemId,Math.min(99,qtyFor(fresh.itemId)+Math.max(1,Number(item.quantity||1))));
      added++;
    }catch{unavailable++;}
  }

  refreshCart();
  renderMenu();

  if(added){
    $("ordersSheet").classList.add("hidden");
    renderCart();
    $("cartSheet").classList.remove("hidden");
  }

  if(unavailable){
    $("orderStatus").innerText=`تمت إعادة الأصناف المتاحة. ${unavailable} صنف غير متاح حاليًا.`;
  }
}

$("myOrdersBtn").onclick=async()=>{
  $("ordersSheet").classList.remove("hidden");
  $("ordersList").innerHTML='<p class="empty">جاري تحميل طلباتك...</p>';
  await loadMyOrders();
};
$("closeOrders").onclick=()=>$("ordersSheet").classList.add("hidden");
$("ordersSheet").addEventListener("click",e=>{if(e.target===$("ordersSheet"))$("ordersSheet").classList.add("hidden");});

$("submitOrder").onclick=async()=>{
  $("orderStatus").innerText="جاري إرسال الطلب...";
  $("submitOrder").disabled=true;

  try{
    const result=await createRestaurantOrder({
      projectId,
      customerName:$("customerName").value,
      customerPhone:$("customerPhone").value,
      customerAddress:$("customerAddress").value,
      location:locationUrl,
      notes:$("notes").value,
      cart:[...cart.entries()].map(([itemId,quantity])=>({itemId,quantity}))
    });

    saveCustomer();
    rememberOrder(result.trackingToken);

    cart.clear();
    refreshCart();
    renderMenu();
    renderCart();

    $("orderStatus").innerText=result.trackingEnabled
      ?`تم إرسال طلبك بنجاح ✅ رقم الطلب ${result.orderId.slice(0,7)} — الإجمالي ${money(result.total)}. تقدر تتابع حالته من «طلباتي».`
      :`تم إرسال طلبك بنجاح ✅ رقم الطلب ${result.orderId.slice(0,7)} — الإجمالي ${money(result.total)}.`;

    setTimeout(()=>$("cartSheet").classList.add("hidden"),1200);
  }catch(e){
    const message=String(e?.message||"");
    const friendly=
      message==="EMPTY_CART"
        ?"السلة فارغة."
        :message==="ORDER_ITEM_UNAVAILABLE"
          ?"أحد الأصناف لم يعد متاحًا. راجع السلة وحدّث الطلب."
          :message==="CUSTOMER_NAME_REQUIRED"
            ?"اكتب اسمك."
            :message==="CUSTOMER_PHONE_REQUIRED"
              ?"اكتب رقم الموبايل."
              :message==="CUSTOMER_ADDRESS_REQUIRED"
                ?"اكتب عنوان التوصيل."
                :message;

    $("orderStatus").innerText=`تعذر إرسال الطلب: ${friendly}`;
    $("submitOrder").disabled=false;
  }
};

init();
