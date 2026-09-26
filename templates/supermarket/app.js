import db from "../../core/firebase/firebase-db.js";
import { createSupermarketOrder } from "../../core/supermarket/order-service.js";

import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
let store=null;
let products=[];
let category="الكل";
let cart=new Map();
let locationUrl="";
const customerKey=`fb_supermarket_customer_${projectId}`;

function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function escapeHTML(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function qtyFor(id){return cart.get(id)||0;}

async function init(){
  if(!projectId){showClosed("رابط المشروع غير مكتمل.");return;}

  try{
    const [projectSnap,storeSnap,productsSnap]=await Promise.all([
      getDoc(doc(db,"projects",projectId)),
      getDoc(doc(db,"supermarkets",projectId)),
      getDocs(collection(db,"supermarkets",projectId,"products"))
    ]);

    if(!projectSnap.exists()||projectSnap.data().template!=="supermarket"){showClosed("المشروع غير متاح.");return;}
    if(!storeSnap.exists()){showClosed("السوبرماركت لسه ماكملش الإعداد.");return;}

    store={supermarketId:storeSnap.id,...storeSnap.data()};
    if(store.isAcceptingOrders!==true){showClosed("السوبرماركت موقف استقبال الطلبات مؤقتًا.");return;}

    products=productsSnap.docs.map(d=>({productId:d.id,...d.data()})).filter(p=>p.isActive===true&&p.inStock===true);
    $("storeName").innerText=store.name||"السوبرماركت";
    $("storeAddress").innerText=store.address||"";
    $("deliveryBadge").innerText=`التوصيل ${money(store.deliveryFee||0)}`;

    loadSavedCustomer();
    renderCategories();
    renderProducts();
    refreshCart();
  }catch(e){
    showClosed(e.code==="permission-denied"?"المشروع غير جاهز لاستقبال الطلبات بعد.":`تعذر تحميل المتجر: ${e.message}`);
  }
}

function showClosed(message){$("closedBanner").innerText=message;$("closedBanner").classList.remove("hidden");}

function renderCategories(){
  const cats=["الكل",...new Set(products.map(p=>p.category||"أخرى"))];
  $("categories").innerHTML=cats.map(c=>`<button class="${c===category?"active":""}" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  $("categories").querySelectorAll("button").forEach(btn=>btn.onclick=()=>{category=btn.dataset.category;renderCategories();renderProducts();});
}

function renderProducts(){
  const q=$("searchInput").value.trim().toLowerCase();
  const visible=products.filter(p=>(category==="الكل"||(p.category||"أخرى")===category)&&(!q||String(p.name||"").toLowerCase().includes(q)));
  $("emptyProducts").classList.toggle("hidden",visible.length>0);
  $("productsGrid").innerHTML=visible.map(p=>{
    const qty=qtyFor(p.productId);
    const image=p.image?`<img src="${escapeHTML(p.image)}" alt="">`:"🛍️";
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
    const product=products.find(p=>p.productId===id);
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
    cart.clear();
    refreshCart();
    renderProducts();
    renderCart();

    const successMessage=`تم إرسال طلبك بنجاح ✅ رقم الطلب ${result.orderId.slice(0,7)} — الإجمالي ${money(result.total)}`;
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
