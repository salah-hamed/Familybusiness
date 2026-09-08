import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const projectId = new URLSearchParams(location.search).get("project") || "";
let rendering = false;

if (projectId.endsWith("_carwash")) {
  const observer = new MutationObserver(() => {
    const list = document.getElementById("subscriptionsList");
    if (list && !rendering && !list.querySelector("[data-subscription-id]")) renderSubscriptions();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(renderSubscriptions, 800);
}

function esc(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

async function renderSubscriptions() {
  const list = document.getElementById("subscriptionsList");
  if (!list || rendering || !auth.currentUser) return;
  rendering = true;
  try {
    const snap = await getDocs(query(collection(db,"carwashSubscriptions"),where("projectId","==",projectId)));
    const activeDocs = snap.docs.filter(ds => ds.data().status === "active");
    list.innerHTML = "";
    activeDocs.forEach(ds => {
      const sub=ds.data();
      const expires=sub.expiresAt?.toDate ? sub.expiresAt.toDate().toLocaleDateString("ar-EG") : "-";
      const card=document.createElement("article");
      card.className="orderCard";
      card.dataset.subscriptionId=ds.id;
      card.innerHTML=`<div class="orderTop"><div><h3>اشتراك نشط</h3><span class="muted">ينتهي: ${esc(expires)}</span></div><span class="orderStatus status-accepted">${Number(sub.remainingWashes||0)} / ${Number(sub.totalWashes||0)} غسلات</span></div><button type="button" class="primaryBtn washDoneBtn" style="margin-top:10px">💦 تسجيل غسلة منفذة</button>`;
      card.querySelector(".washDoneBtn").onclick=e=>consumeWash(ds.id,e.currentTarget);
      list.appendChild(card);
    });
    if(!activeDocs.length)list.innerHTML='<div class="emptyState">لا توجد اشتراكات نشطة بعد.</div>';
  } catch(e) {
    list.innerHTML=`<div class="emptyState">${esc(e.message)}</div>`;
  } finally { rendering=false; }
}

async function consumeWash(subscriptionId,button){
  if(!auth.currentUser||!projectId)return;
  button.disabled=true;button.textContent="جاري التحديث...";
  try{
    const ref=doc(db,"carwashSubscriptions",subscriptionId);const snap=await getDoc(ref);
    if(!snap.exists()||snap.data().projectId!==projectId)throw new Error("الاشتراك غير موجود.");
    const data=snap.data(),remaining=Number(data.remainingWashes||0);
    if(data.status!=="active"||remaining<=0)throw new Error("لا توجد غسلات متبقية.");
    const next=remaining-1;
    await updateDoc(ref,{remainingWashes:next,status:next>0?"active":"completed",updatedAt:serverTimestamp()});
    await renderSubscriptions();
  }catch(e){button.disabled=false;button.textContent=e.message||"تعذر تحديث الغسلة";}
}
