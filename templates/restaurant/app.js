import db from "../../core/firebase/firebase-db.js";
import { createRestaurantOrder } from "../../core/restaurant/order-service.js";

import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
let restaurant=null;
let menu=[];
let category="الكل";
let cart=new Map();
let locationUrl="";
const customerKey=`fb_restaurant_customer_${projectId}`;

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function qtyFor(id){return cart.get(id)||0;}

async function init(){
  if(!projectId){showClosed("رابط المشروع غير مكتمل.");return;}

  try{
    const [projectSnap,restaurantSnap,menuSnap]=await Promise.all([
      getDoc(doc(db,"projects",projectId)),
      getDoc(doc(db,"restaurants",projectId)),
      getDocs(collection(db,"restaurants",projectId,"menu"))
    ]);

    if(!projectSnap.exists()||projectSnap.data().template!=="restaurant"){
      showClosed("المشروع غير متاح.");
      return;
    }
    if(!restaurantSnap.exists()){
      showClosed("المطعم لسه ماكملش الإعداد.");
      return;
    }

    restaurant={restaurantId:restaurantSnap.id,...restaurantSnap.data()};

    if(restaurant.isAcceptingOrders!==true){
      showClosed("المطعم موقف استقبال الطلبات مؤقتًا.");
      return;
    }

    menu=menuSnap.docs
      .map(d=>({itemId:d.id,...d.data()}))
      .filter(item=>item.isActive===true&&item.isAvailable===true);

    applyIdentity();
    loadSavedCustomer();
    renderCategories();
    renderMenu();
    refreshCart();
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

  $("restaurantName").innerText=restaurant.name||"المطعم";
  $("restaurantSlogan").innerText=restaurant.slogan||"";
  $("cuisineText").innerText=restaurant.cuisine||"";
  $("restaurantAddress").innerText=restaurant.address||"";
  $("deliveryBadge").innerText=`التوصيل ${money(restaurant.deliveryFee||0)}`;

  if(restaurant.logo){
    $("restaurantLogo").innerHTML=`<img src="${escapeHTML(restaurant.logo)}" alt="">`;
  }

  if(restaurant.coverImage){
    $("restaurantHero").style.backgroundImage=
      `linear-gradient(rgba(0,0,0,.48),rgba(0,0,0,.55)),url("${restaurant.coverImage.replace(/"/g,"%22")}")`;
  }
}

function showClosed(message){
  $("closedBanner").innerText=message;
  $("closedBanner").classList.remove("hidden");
}

function renderCategories(){
  const cats=["الكل",...new Set(menu.map(item=>item.category||"أخرى"))];
  $("categories").innerHTML=cats.map(c=>`<button class="${c===category?"active":""}" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  $("categories").querySelectorAll("button").forEach(btn=>btn.onclick=()=>{
    category=btn.dataset.category;
    renderCategories();
    renderMenu();
  });
}

function renderMenu(){
  const q=$("searchInput").value.trim().toLowerCase();

  const visible=menu.filter(item=>
    (category==="الكل"||(item.category||"أخرى")===category)
    && (!q||[item.name,item.description,item.category].some(v=>String(v||"").toLowerCase().includes(q)))
  );

  $("emptyMenu").classList.toggle("hidden",visible.length>0);

  $("menuGrid").innerHTML=visible.map(item=>{
    const qty=qtyFor(item.itemId);
    const image=item.image
      ?`<img src="${escapeHTML(item.image)}" alt="">`
      :"🍽️";

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
  const next=Math.max(0,Math.min(99,qtyFor(id)+delta));
  if(next)cart.set(id,next);else cart.delete(id);
  renderMenu();
  refreshCart();
}

function cartSummary(){
  const lines=[...cart.entries()].map(([id,quantity])=>{
    const item=menu.find(x=>x.itemId===id);
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
    cart.clear();
    refreshCart();
    renderMenu();

    $("orderStatus").innerText=
      `تم إرسال طلبك بنجاح ✅ رقم الطلب ${result.orderId.slice(0,7)} — الإجمالي ${money(result.total)}`;
  }catch(e){
    $("orderStatus").innerText=`تعذر إرسال الطلب: ${e.message}`;
  }finally{
    $("submitOrder").disabled=false;
  }
};

init();
