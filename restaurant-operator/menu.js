import auth from "../core/firebase/firebase-auth.js";
import { friendlyOperatorError } from "../core/operators/operator-errors.js";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getRestaurant } from "../core/restaurant/restaurant-service.js";
import { addRestaurantMenuItem, getRestaurantMenuItem, listRestaurantMenu, updateRestaurantMenuItem, deleteRestaurantMenuItem } from "../core/restaurant/menu-service.js";

import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const projectId=params.get("project")||"";
const inviteToken=params.get("invite")||"";
const inviteAuthEmail=buildOperatorAuthEmail(inviteToken);
function clearInviteFromAddressBar(){
  if(!inviteToken)return;
  const url=new URL(location.href);
  url.searchParams.delete("invite");
  history.replaceState(null,"",url.toString());
}

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

function safeImageUrl(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  try{
    const url=new URL(raw);
    return url.protocol==="https:"?url.toString():"";
  }catch{
    return "";
  }
}

function testImageUrl(value,timeout=8000){
  const url=safeImageUrl(value);
  if(!String(value||"").trim())return Promise.resolve(true);
  if(!url)return Promise.resolve(false);

  return new Promise(resolve=>{
    const image=new Image();
    const timer=setTimeout(()=>resolve(false),timeout);
    image.onload=()=>{clearTimeout(timer);resolve(true);};
    image.onerror=()=>{clearTimeout(timer);resolve(false);};
    image.src=url;
  });
}

function setImagePreview(node,url,fallback="🍽️"){
  node.innerHTML="";
  if(!url){node.textContent=fallback;return;}

  const image=document.createElement("img");
  image.src=url;
  image.alt="";
  image.referrerPolicy="no-referrer";
  image.onerror=()=>{node.innerHTML="";node.textContent=fallback;};
  node.appendChild(image);
}

function dashboardUrl(){
  const url=new URL("./",location.href);
  url.searchParams.set("project",projectId);
  return url.toString();
}

async function authorize(){
  try{
    await claimOperatorAccess(projectId,currentUser);
    clearInviteFromAddressBar();
  }catch(e){
    $("pageStatus").innerText=friendlyOperatorError(e,"تعذر فتح المنيو. حاول تحديث الصفحة أو اطلب رابط دعوة جديد.");
    return false;
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

  if(!projectId){
    $("pageStatus").innerText="رابط المنيو غير مكتمل.";
    return;
  }

  if(user&&inviteAuthEmail&&String(user.email||"").toLowerCase()!==inviteAuthEmail.toLowerCase()){
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

function sortLocalMenu(){
  menu=[...menu].sort((a,b)=>{
    const categoryOrder=String(a.category||"").localeCompare(String(b.category||""),"ar");
    return categoryOrder||String(a.name||"").localeCompare(String(b.name||""),"ar");
  });
}

function upsertLocalMenuItem(item){
  if(!item?.itemId)return;
  const index=menu.findIndex(entry=>entry.itemId===item.itemId);
  if(index>=0)menu[index]={...menu[index],...item};
  else menu.push(item);
  sortLocalMenu();
}

function removeLocalMenuItem(itemId){
  menu=menu.filter(item=>item.itemId!==itemId);
}

function renderMenu(){
  const q=searchText.trim().toLowerCase();
  const visible=menu.filter(item=>!q||[item.name,item.category,item.description].some(v=>String(v||"").toLowerCase().includes(q)));

  $("menuList").innerHTML=visible.length?visible.map(item=>`
    <article class="rowCard productManagerCard" data-item-id="${item.itemId}">
      <div class="menuItemWithImage">
        <div class="menuItemThumb">
          ${item.image?`<img src="${escapeHTML(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.textContent='🍽️'">`:"🍽️"}
        </div>
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
        const image=card.querySelector(".editImage").value.trim();
        if(!(await testImageUrl(image))){
          throw new Error("رابط الصورة غير صالح أو الموقع يمنع عرض الصورة خارجيًا.");
        }

        const updated=await updateRestaurantMenuItem(projectId,itemId,currentUser.uid,{
          name:card.querySelector(".editName").value,
          category:card.querySelector(".editCategory").value,
          price:card.querySelector(".editPrice").value,
          description:card.querySelector(".editDescription").value,
          image
        });
        upsertLocalMenuItem(updated);
        renderMenu();
      }catch(e){alert(friendlyOperatorError(e,"تعذر تحديث الصنف. راجع البيانات وحاول مرة أخرى."));}
    };

    card.querySelector(".toggleItem").onclick=async()=>{
      const active=!(item.isActive&&item.isAvailable);
      try{
        const updated=await updateRestaurantMenuItem(projectId,itemId,currentUser.uid,{
          isActive:active,
          isAvailable:active
        });
        upsertLocalMenuItem(updated);
        renderMenu();
      }catch(e){alert(friendlyOperatorError(e,"تعذر تحديث الصنف. راجع البيانات وحاول مرة أخرى."));}
    };

    card.querySelector(".deleteItem").onclick=async()=>{
      if(!confirm(`حذف "${item.name}" نهائيًا من المنيو؟`))return;
      try{
        await deleteRestaurantMenuItem(projectId,itemId);
        removeLocalMenuItem(itemId);
        renderMenu();
      }catch(e){alert(friendlyOperatorError(e,"تعذر تحديث الصنف. راجع البيانات وحاول مرة أخرى."));}
    };
  });
}

$("addItemBtn").onclick=async()=>{
  $("itemMessage").innerText="جاري فحص الصورة وإضافة الصنف...";
  try{
    const image=$("itemImage").value.trim();
    if(!(await testImageUrl(image))){
      throw new Error("رابط الصورة غير صالح أو الموقع يمنع عرض الصورة خارجيًا.");
    }

    const itemId=await addRestaurantMenuItem(projectId,currentUser.uid,{
      name:$("itemName").value,
      category:$("itemCategory").value,
      price:$("itemPrice").value,
      description:$("itemDescription").value,
      image
    });
    const added=await getRestaurantMenuItem(projectId,itemId);
    if(added)upsertLocalMenuItem(added);
    ["itemName","itemCategory","itemPrice","itemDescription","itemImage"].forEach(id=>$(id).value="");
    $("itemMessage").innerText="تمت إضافة الصنف ✅";
    renderMenu();
  }catch(e){$("itemMessage").innerText=friendlyOperatorError(e,"تعذر حفظ الصنف. راجع الاسم والسعر وحاول مرة أخرى.");}
};

$("menuSearch").addEventListener("input",event=>{
  searchText=event.target.value;
  renderMenu();
});


$("itemImage").addEventListener("input",()=>{
  setImagePreview($("newItemImagePreview"),safeImageUrl($("itemImage").value));
});
