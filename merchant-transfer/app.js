import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";
import { MERCHANT_TRANSFER_CASES_ENABLED } from "../core/merchants/transfer-case-rollout.js";
import { MERCHANT_REPEAT_ASSIGNMENT_ENABLED } from "../core/merchants/merchant-cycle-rollout.js";
import { submitRepeatMerchantConsent } from "../core/merchants/merchant-cycle-consent-service.js";
import {
  loadMerchantTransferCase, submitMerchantTransferConsent
} from "../core/merchants/transfer-case-service.js";
import {
  identifyTransferConsentRole, summarizeTransferConsent
} from "../core/merchants/transfer-consent-view.js?v=20261013-terms1";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const projectDocId = new URLSearchParams(window.location.search).get("project") || "";
const cycleText = new URLSearchParams(window.location.search).get("cycle") || "";
const repeatCycle = /^[2-9][0-9]{0,3}$/.test(cycleText) ? Number(cycleText) : null;
const buttons = [$("acceptBtn"), $("declineBtn")];

function notice(message) {
  $("message").textContent = message;
}

async function loadConsent(user) {
  if (!user) {
    notice("يجب تسجيل الدخول بحساب صاحب المحل أو المشترك الجديد ثم إعادة فتح الرابط.");
    return;
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectDocId)) {
    notice("رابط اتفاق غير صالح.");
    return;
  }
  try {
    const transferCase = repeatCycle
      ? (await getDoc(doc(db,"merchantTransferCycles",projectDocId+"_"+repeatCycle))).data()||null
      : await loadMerchantTransferCase(projectDocId);
    if (!transferCase) {
      notice("لا يوجد اتفاق جديد متاح لهذا النشاط حاليًا.");
      return;
    }
    let role = identifyTransferConsentRole(transferCase, null, user.uid);
    if (!role) {
      const operatorSnap = await getDoc(doc(db, "operators", projectDocId));
      role = identifyTransferConsentRole(transferCase,
        operatorSnap.exists() ? operatorSnap.data() : null, user.uid);
    }
    if (!role) {
      notice("لا توجد موافقة معلقة لهذا الحساب. قد تكون أرسلت قرارك بالفعل.");
      return;
    }
    $("roleTitle").textContent = role === "operator"
      ? "تأكيد صاحب المحل على المشترك الجديد" : "تأكيد المشترك الجديد";
    $("details").textContent = summarizeTransferConsent(transferCase, role);
    $("decision").classList.remove("hidden");
    notice("راجع البنود ثم اختر الموافقة أو الرفض.");

    for (const button of buttons) {
      button.onclick = async () => {
        const decision = button === $("acceptBtn") ? "accepted" : "declined";
        buttons.forEach(x => x.disabled = true);
        try {
          if(repeatCycle){
            await submitRepeatMerchantConsent({
              projectId:projectDocId,cycle:repeatCycle,role,decision
            });
          }else{
            await submitMerchantTransferConsent(projectDocId, role, decision);
          }
          $("decision").classList.add("hidden");
          notice(decision === "accepted"
            ? "تم تسجيل موافقتك. النشاط لم يُنقل بعد؛ أي نقل يحتاج مراجعة الشروط والتسويات."
            : "تم تسجيل رفضك. لم يتغير تشغيل المحل أو سجلاته.");
        } catch (error) {
          console.error(error);
          notice("تعذر تسجيل القرار؛ تأكد من الصلاحية وحالة الاتفاق وأعد المحاولة.");
          buttons.forEach(x => x.disabled = false);
        }
      };
    }
  } catch (error) {
    console.error(error);
    notice("تعذر فتح الاتفاق بهذه الصلاحيات. الرابط متاح فقط للأطراف الجديدة المعنية.");
  }
}

if (repeatCycle ? !MERCHANT_REPEAT_ASSIGNMENT_ENABLED : !MERCHANT_TRANSFER_CASES_ENABLED) {
  notice("طلبات إعادة التخصيص لم تُفعَّل بعد. ستتاح بعد مراجعة قواعد الأمان ونشرها النهائي.");
} else {
  onAuthStateChanged(auth, user => {
    $("decision").classList.add("hidden");
    loadConsent(user);
  });
}
