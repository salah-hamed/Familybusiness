import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
function cleanPhone(value){const d=String(value||"").replace(/\D/g,"");if(!d)return"";if(d.startsWith("20"))return d;if(d.startsWith("0"))return`20${d.slice(1)}`;return`20${d}`;}
function toDate(value){return value?.toDate?value.toDate():value?new Date(value):null;}
function sameDay(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}

function ensureOperationalStats(){
  const grid=document.querySelector("#carwashSubscriptionsPanel .statGrid");
  if(!grid)return;
  if(!document.getElementById("carwashTodayCount")){
    const today=document.createElement("article");today.className="statCard accentNew";today.innerHTML='<span class="statIcon">🚗</span><div><span class="statLabel">غسلات اليوم</span><strong id="carwashTodayCount">0</strong></div>';grid.appendChild(today);
  }
  if(!document.getElementById("carwashRenewSoonCount")){
    const renew=document.createElement("article");renew.className="statCard";renew.innerHTML='<span class="statIcon">🔔</span><div><span class="statLabel">تجديد قريب</span><strong id="carwashRenewSoonCount">0</strong></div>';grid.appendChild(renew);
  }
}

async function renderSubscriptions() {
  const list = document.getElementById("subscriptionsList");
  if (!list || rendering || !auth.currentUser) return;
  rendering = true;
  ensureOperationalStats();
  try {
    const snap = await getDocs(query(collection(db,"carwashSubscriptions"),where("projectId","==",projectId)));
    const now=new Date();
    const rows=[];
    let activeCount=0,remainingTotal=0,todayCount=0,renewSoon=0;

    for(const ds of snap.docs){
      const sub=ds.data();
      const expires=toDate(sub.expiresAt);
      const nextWash=toDate(sub.nextWashDate);
      const remaining=Number(sub.remainingWashes||0);
      const operational=sub.status==="active"&&remaining>0&&(!expires||expires>=now);
      const daysLeft=expires?Math.ceil((expires-now)/86400000):null;
      if(operational){activeCount++;remainingTotal+=remaining;if(sameDay(nextWash,now))todayCount++;if(daysLeft!==null&&daysLeft>=0&&daysLeft<=3)renewSoon++;}

      const customerSnap=await getDoc(doc(db,"carwashCustomers",ds.id));
      const customer=customerSnap.exists()?customerSnap.data():{};
      rows.push({id:ds.id,sub,customer,operational,expires,nextWash,daysLeft});
    }

    rows.sort((a,b)=>{
      if(a.operational!==b.operational)return a.operational?-1:1;
      const at=a.nextWash?.getTime()||Number.MAX_SAFE_INTEGER,bt=b.nextWash?.getTime()||Number.MAX_SAFE_INTEGER;
      return at-bt;
    });

    list.innerHTML="";
    rows.forEach(({id,sub,customer,operational,expires,nextWash,daysLeft})=>{
      const remaining=Number(sub.remainingWashes||0),total=Number(sub.totalWashes||0);
      const name=esc(customer.customerName||"عميل اشتراك"),phone=esc(customer.customerPhone||"-"),car=esc(customer.carModel||"-"),plate=esc(customer.plateNumber||"-"),address=esc(customer.customerAddress||"-");
      const wa=cleanPhone(customer.customerPhone),maps=typeof customer.location==="string"&&customer.location.startsWith("http")?customer.location:"";
      const statusText=operational?"نشط":remaining<=0?"اكتمل الرصيد":expires&&expires<new Date()?"انتهى الشهر":sub.status||"غير نشط";
      const card=document.createElement("article");card.className="orderCard";card.dataset.subscriptionId=id;
      card.innerHTML=`
        <div class="orderTop"><div><h3>${name}</h3><span class="muted">${phone}</span></div><span class="orderStatus ${operational?"status-accepted":"status-canceled"}">${statusText}</span></div>
        <div class="orderGrid">
          <div class="orderInfo"><b>🚗 السيارة</b>${car} — ${plate}</div>
          <div class="orderInfo"><b>📍 العنوان</b>${address}</div>
          <div class="orderInfo"><b>🗓️ الغسلة القادمة</b>${nextWash?nextWash.toLocaleDateString("ar-EG"):"-"} — ${esc(sub.preferredTime||customer.preferredTime||"-")}</div>
          <div class="orderInfo"><b>🔁 الرصيد</b>${remaining} من ${total} غسلات</div>
          <div class="orderInfo"><b>⏳ نهاية الاشتراك</b>${expires?expires.toLocaleDateString("ar-EG"):"-"}${daysLeft!==null&&daysLeft>=0&&daysLeft<=3?" — تجديد قريب":""}</div>
        </div>
        <div class="orderActions">
          ${wa?`<a class="orderAction whatsapp" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 واتساب</a>`:""}
          ${maps?`<a class="orderAction maps" href="${esc(maps)}" target="_blank" rel="noopener">🗺️ فتح الموقع</a>`:""}
          ${operational?'<button type="button" class="orderAction done washDoneBtn">💦 تسجيل غسلة منفذة</button>':""}
        </div>`;
      card.querySelector(".washDoneBtn")?.addEventListener("click",e=>consumeWash(id,e.currentTarget));
      list.appendChild(card);
    });

    const active=document.getElementById("activeCarwashSubscriptions"),remaining=document.getElementById("remainingSubscriptionWashes"),today=document.getElementById("carwashTodayCount"),renew=document.getElementById("carwashRenewSoonCount");
    if(active)active.innerText=activeCount;if(remaining)remaining.innerText=remainingTotal;if(today)today.innerText=todayCount;if(renew)renew.innerText=renewSoon;
    if(!rows.length)list.innerHTML='<div class="emptyState">لا توجد اشتراكات بعد.</div>';
  } catch(e) {
    list.innerHTML=`<div class="emptyState">${esc(e.message)}</div>`;
  } finally { rendering=false; }
}

async function consumeWash(subscriptionId,button){
  if(!auth.currentUser||!projectId)return;
  button.disabled=true;button.textContent="جاري التحديث...";
  try{
    const subRef=doc(db,"carwashSubscriptions",subscriptionId);
    const washRef=doc(collection(db,"carwashSubscriptions",subscriptionId,"washes"));
    let completed=false;
    await runTransaction(db,async tx=>{
      const snap=await tx.get(subRef);
      if(!snap.exists()||snap.data().projectId!==projectId)throw new Error("الاشتراك غير موجود.");
      const data=snap.data(),remaining=Number(data.remainingWashes||0),total=Number(data.totalWashes||0);
      if(data.status!=="active"||remaining<=0)throw new Error("لا توجد غسلات متبقية.");
      const next=remaining-1,sequence=Math.max(1,total-remaining+1),intervalDays=Math.max(1,Number(data.intervalDays||7));
      const scheduled=toDate(data.nextWashDate);
      let nextWash=null;
      if(next>0){nextWash=scheduled&&scheduled>new Date()?new Date(scheduled):new Date();nextWash.setDate(nextWash.getDate()+intervalDays);}
      tx.update(subRef,{remainingWashes:next,status:next>0?"active":"completed",nextWashDate:nextWash,lastWashAt:serverTimestamp(),updatedAt:serverTimestamp()});
      tx.set(washRef,{projectId,sequence,scheduledFor:data.nextWashDate||null,completedAt:serverTimestamp()});
      completed=next===0;
    });
    if(completed){
      await setDoc(doc(db,"carwashSubscriptionRequests",subscriptionId),{projectId,status:"renewable",updatedAt:serverTimestamp()},{merge:true});
    }
    await renderSubscriptions();
  }catch(e){button.disabled=false;button.textContent=e.message||"تعذر تحديث الغسلة";}
}
