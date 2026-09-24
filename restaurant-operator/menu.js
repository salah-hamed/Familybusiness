import auth from "../core/firebase/firebase-auth.js";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getRestaurant } from "../core/restaurant/restaurant-service.js";
import { addRestaurantMenuItem, listRestaurantMenu, updateRestaurantMenuItem, deleteRestaurantMenuItem } from "../core/restaurant/menu-service.js";

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
let menu=[];
let searchText="";

function escapeHTML(value){
  return String(value??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}
function money(v){return `${Number(v||0).toLocaleString("ar-EG")} جنيه`;}
function dashboardUrl(){
  const url=new URL("./",location.href);
  url.searchParams.set("project",projectId);
  if(inviteToken)url.searchParams.set("invite",inviteToken);
  return url.toString();
}

async function authorize(){
  try{
    await claimOperatorAccess(projectId,currentUser);
  }catch(e){
    if(e.message!=="OPERATOR_ALREADY_CLAIMED"){
      $("pageStatus").innerText=`تعذر فتح المنيو: ${e.message}`;
      return false;
    }
  }

  const [operator,agreement,restaurant]=await Promise.all([
    getOperator(projectId),
    getCommissionAgreement(projectId),
    getRestaurant(projectId)
  ]);

  const canOperate=operatorCanOperate(operator)&&agreement?.status==="accepted"&&agreement?.currentAmount!=null;

  if(!canOperate){
    $("pageStatus").innerText="المنيو يتفعل بعد قبول اتفاق العمولة.";
    return false;
  }

  $("pageStatus").innerText=`${restaurant?.name||"المطعم"} — عدّل المنيو والأسعار حسب احتياجك.`;
  return true;
}

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  $("backToDashboard").href=dashboardUrl();

  if(!projectId||!inviteAuthEmail){
    $("pageStatus").innerText="رابط المنيو غير مكتمل.";
    return;
  }

  if(user&&String(user.email||"").toLowerCase()!==inviteAuthEmail.toLowerCase()){
    await signOut(auth);
    return;
  }

  if(!user){
    $("pageStatus").innerText="سجل دخولك من لوحة المطعم أولًا.";
    return;
  }

  if(!await authorize())return;

  $("menuPanel").classList.remove("hidden");
  await loadMenu();
});

async function loadMenu(){
  menu=await listRestaurantMenu(projectId);
  renderMenu();
}

function renderMenu(){
  const q=searchText.trim().toLowerCase();
  const visible=menu.filter(item=>!q||[item.name,item.category,item.description].some(v=>String(v||"").toLowerCase().includes(q)));

  $("menuList").innerHTML=visible.length?visible.map(item=>`
    <article class="rowCard productManagerCard" data-item-id="${item.itemId}">
      <div class="rowTop">
        <div>
          <b>${escapeHTML(item.name)}</b>
          <div class="muted">${escapeHTML(item.category||"أخرى")} · ${money(item.price)}</div>
          <div class="muted">${escapeHTML(item.description||"")}</div>
        </div>
        <span class="pill">${item.isActive&&item.isAvailable?"متاح للعملاء":"متوقف مؤقتًا"}</span>
      </div>

      <div class="productEditGrid">
        <label>الاسم<input class="editName" value="${escapeHTML(item.name)}"></label>
        <label>التصنيف<input class="editCategory" value="${escapeHTML(item.category||"أخرى")}"></label>
        <label>السعر<input class="editPrice" type="number" min="0" step="0.5" value="${Number(item.price||0)}"></label>
        <label>الوصف<input class="editDescription" value="${escapeHTML(item.description||"")}"></label>
        <label>الصورة<input class="editImage" value="${escapeHTML(item.image||"")}"></label>
      </div>

      <div class="productControls">
        <button class="primary saveItem">حفظ التعديلات</button>
        <button class="secondary toggleItem">${item.isActive&&item.isAvailable?"إيقاف مؤقت":"إعادة التفعيل"}</button>
        <button class="danger deleteItem">حذف نهائي</button>
      </div>
    </article>
  `).join(""):'<p class="muted">لا توجد أصناف مطابقة.</p>';

  document.querySelectorAll("[data-item-id]").forEach(card=>{
    const itemId=card.dataset.itemId;
    const item=menu.find(x=>x.itemId===itemId);

    card.querySelector(".saveItem").onclick=async()=>{
      try{
        await updateRestaurantMenuItem(projectId,itemId,currentUser.uid,{
          name:card.querySelector(".editName").value,
          category:card.querySelector(".editCategory").value,
          price:card.querySelector(".editPrice").value,
          description:card.querySelector(".editDescription").value,
          image:card.querySelector(".editImage").value
        });
        await loadMenu();
      }catch(e){alert(e.message);}
    };

    card.querySelector(".toggleItem").onclick=async()=>{
      const active=!(item.isActive&&item.isAvailable);
      try{
        await updateRestaurantMenuItem(projectId,itemId,currentUser.uid,{
          isActive:active,
          isAvailable:active
        });
        await loadMenu();
      }catch(e){alert(e.message);}
    };

    card.querySelector(".deleteItem").onclick=async()=>{
      if(!confirm(`حذف "${item.name}" نهائيًا من المنيو؟`))return;
      try{
        await deleteRestaurantMenuItem(projectId,itemId);
        await loadMenu();
      }catch(e){alert(e.message);}
    };
  });
}

$("addItemBtn").onclick=async()=>{
  $("itemMessage").innerText="جاري الإضافة...";
  try{
    await addRestaurantMenuItem(projectId,currentUser.uid,{
      name:$("itemName").value,
      category:$("itemCategory").value,
      price:$("itemPrice").value,
      description:$("itemDescription").value,
      image:$("itemImage").value
    });
    ["itemName","itemCategory","itemPrice","itemDescription","itemImage"].forEach(id=>$(id).value="");
    $("itemMessage").innerText="تمت إضافة الصنف ✅";
    await loadMenu();
  }catch(e){$("itemMessage").innerText=e.message;}
};

$("menuSearch").addEventListener("input",event=>{
  searchText=event.target.value;
  renderMenu();
});
