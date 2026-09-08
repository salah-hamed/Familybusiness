import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const projectId = new URLSearchParams(location.search).get("project") || "";
if (projectId.endsWith("_carwash")) {
  const observer = new MutationObserver(() => enhanceSubscriptionCards());
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(enhanceSubscriptionCards, 700);
}

function enhanceSubscriptionCards() {
  const list = document.getElementById("subscriptionsList");
  if (!list) return;
  [...list.querySelectorAll(".orderCard")].forEach((card, index) => {
    if (card.dataset.washTrackingReady) return;
    card.dataset.washTrackingReady = "1";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primaryBtn";
    button.style.marginTop = "10px";
    button.textContent = "💦 تسجيل غسلة منفذة";
    button.onclick = () => consumeWashByCard(card, button, index);
    card.appendChild(button);
  });
}

async function consumeWashByCard(card, button, index) {
  const user = auth.currentUser;
  if (!user || !projectId) return;
  button.disabled = true;
  button.textContent = "جاري التحديث...";
  try {
    const { collection, query, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDocs(query(collection(db, "carwashSubscriptions"), where("projectId", "==", projectId)));
    const activeDocs = snap.docs.filter(ds => ds.data().status === "active");
    const target = activeDocs[index];
    if (!target) throw new Error("تعذر العثور على الاشتراك.");
    const ref = doc(db, "carwashSubscriptions", target.id);
    const latest = await getDoc(ref);
    if (!latest.exists()) throw new Error("الاشتراك غير موجود.");
    const data = latest.data();
    const remaining = Number(data.remainingWashes || 0);
    if (remaining <= 0) throw new Error("لا توجد غسلات متبقية.");
    const next = remaining - 1;
    await updateDoc(ref, {
      remainingWashes: next,
      status: next > 0 ? "active" : "completed",
      updatedAt: serverTimestamp()
    });
    button.textContent = next > 0 ? `تم التسجيل ✅ — متبقي ${next}` : "اكتمل رصيد الشهر ✅";
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message || "تعذر تحديث الغسلة";
  }
}
