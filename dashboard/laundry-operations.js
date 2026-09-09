import db from "../core/firebase/firebase-db.js";
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const params = new URLSearchParams(location.search);
const projectDocId = params.get("project") || "";
const isLaundry = projectDocId.endsWith("_laundry");
const escapeHTML = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");

const stageMeta = {
  accepted: ["تم قبول الطلب", "📥"],
  picked_up: ["تم الاستلام من العميل", "🧺"],
  processing: ["جاري الغسيل / المكواة", "🫧"],
  ready_delivery: ["جاهز للتوصيل", "📦"],
  delivered: ["تم التسليم", "✅"]
};

function serviceLabel(service){
  return {wash:"غسيل",iron:"مكواة",wash_iron:"غسيل + مكواة"}[service] || service || "-";
}

function itemsHTML(order){
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return "";
  return `<div class="orderInfo laundryItems"><b>👕 تفاصيل القطع</b>${items.map(item=>`<div>${escapeHTML(item.label)} × ${Number(item.quantity||0)} — ${escapeHTML(serviceLabel(item.service))} — ${Number(item.subtotal||0)} جنيه</div>`).join("")}</div>`;
}

async function setStage(orderId, nextStage){
  const ref = doc(db,"orders",orderId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return;
  const data = snap.data();
  if(data.templateType !== "laundry" || data.projectId !== projectDocId) return;
  const payload = {laundryStage: nextStage};
  if(nextStage === "delivered") payload.status = "done";
  await updateDoc(ref,payload);
  await decorateLaundryOrders();
}

function nextAction(stage){
  if(stage === "accepted") return ["picked_up","🧺 تأكيد الاستلام"];
  if(stage === "picked_up") return ["processing","🫧 بدء التجهيز"];
  if(stage === "processing") return ["ready_delivery","📦 جاهز للتوصيل"];
  if(stage === "ready_delivery") return ["delivered","✅ تأكيد التسليم"];
  return null;
}

async function decorateLaundryOrders(){
  if(!isLaundry) return;
  const container = document.getElementById("ordersContainer");
  if(!container) return;
  try {
    const snap = await getDocs(query(collection(db,"orders"),where("projectId","==",projectDocId)));
    const orders = new Map(); snap.forEach(ds=>orders.set(ds.id,{id:ds.id,...ds.data()}));
    const cards = [...container.querySelectorAll(".orderCard")];
    cards.forEach((card,index)=>{
      const matching = [...orders.values()].find(o=>{
        const text=(card.dataset.search||"");
        return text.includes(String(o.customerPhone||"").toLowerCase()) && text.includes(String(o.customerName||"").toLowerCase());
      }) || [...orders.values()][index];
      if(!matching) return;
      card.querySelectorAll(".laundryExtra,.laundryStageBox,.laundryStageBtn").forEach(el=>el.remove());
      const grid=card.querySelector(".orderGrid");
      if(grid){
        const extra=document.createElement("div"); extra.className="laundryExtra";
        extra.innerHTML=`${itemsHTML(matching)}<div class="orderInfo"><b>📝 ملاحظات</b>${escapeHTML(matching.notes||"-")}</div>`;
        grid.appendChild(extra);
      }
      if(matching.status === "accepted"){
        const stage=matching.laundryStage||"accepted";
        const meta=stageMeta[stage]||stageMeta.accepted;
        const box=document.createElement("div"); box.className="laundryStageBox";
        box.innerHTML=`<strong>${meta[1]} ${meta[0]}</strong>`;
        card.querySelector(".orderPrice")?.after(box);
        const action=nextAction(stage);
        if(action){
          const btn=document.createElement("button"); btn.type="button"; btn.className="orderAction accept laundryStageBtn"; btn.textContent=action[1];
          btn.onclick=async()=>{btn.disabled=true;try{await setStage(matching.id,action[0]);location.reload();}catch(e){btn.disabled=false;alert(e.message);}};
          card.querySelector(".orderActions")?.prepend(btn);
        }
        const oldDone=card.querySelector(".doneBtn"); if(oldDone) oldDone.style.display="none";
      }
      if(matching.status === "done" && matching.laundryStage === "delivered"){
        const box=document.createElement("div"); box.className="laundryStageBox"; box.innerHTML="<strong>✅ تم التسليم للعميل</strong>"; card.querySelector(".orderPrice")?.after(box);
      }
    });
  } catch(e){ console.log("Laundry operations:",e); }
}

if(isLaundry){
  const style=document.createElement("style");
  style.textContent=".laundryStageBox{margin:10px 0;padding:12px 14px;border-radius:14px;background:#e0f2fe;color:#075985;font-weight:800}.laundryItems{grid-column:1/-1}.laundryItems div{margin-top:5px;font-size:13px}.laundryExtra{display:contents}";
  document.head.appendChild(style);
  const observer=new MutationObserver(()=>{clearTimeout(window.__laundryDecorateTimer);window.__laundryDecorateTimer=setTimeout(decorateLaundryOrders,100);});
  const start=()=>{const c=document.getElementById("ordersContainer");if(c){observer.observe(c,{childList:true});decorateLaundryOrders();}else setTimeout(start,200);};
  start();
}
