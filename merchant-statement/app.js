import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";
import { resolveSubscriberMerchantAccess } from "../core/merchants/merchant-subscriber-access.js";
import { getProjectCommissionSummary } from "../core/commissions/earnings-service.js";
import { decideMerchantCyclePayment } from "../core/commissions/merchant-cycle-settlement-service.js";
import { MERCHANT_REPEAT_ASSIGNMENT_ENABLED } from "../core/merchants/merchant-cycle-rollout.js";
import { listProjectPaymentRequests } from "../core/commissions/settlement-service.js";
import { doc,getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const el=id=>document.getElementById(id);
const money=n=>`${Number(n||0).toLocaleString("ar-EG")} جنيه`;
const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
const projectId=new URLSearchParams(location.search).get("project")||"";

protectPage(async user=>{
  try{
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(projectId))throw new Error("INVALID_PROJECT");
    const projectSnap=await getDoc(doc(db,"projects",projectId));
    if(!projectSnap.exists())throw new Error("NOT_FOUND");
    const project=projectSnap.data();
    // A revoked assigned subscriber can read only their own historic grant.
    // Missing grants are expected for original and current subscribers.
    const grantRef=doc(db,"merchantHistoricalAccess",projectId+"_"+user.uid);
    const grantSnap=await getDoc(grantRef).catch(()=>null);
    const access=resolveSubscriberMerchantAccess(
      project,projectId,user.uid,grantSnap?.exists?.()?grantSnap.data():null
    );
    if(!access.canViewStatement)throw new Error("ACCESS_DENIED");
    const role=access.role;
    el("merchantTitle").textContent=project.businessName||"المحل";
    el("merchantStatus").textContent=role==="former"
      ? "حسابك التاريخي محفوظ بعد استرداد المحل — بدون أي صلاحيات تشغيلية."
      : role==="assigned" ? "المحل مخصص لك حاليًا — تشغيل الطلبات مستمر مع صاحبه."
      : "حساب مشروعك الحالي";
    const [summary,payments]=await Promise.all([
      getProjectCommissionSummary(user.uid,projectId),
      listProjectPaymentRequests(projectId,{ownerId:user.uid,pageSize:20})
    ]);
    el("earned").textContent=money(summary.earnedAmount);
    el("paid").textContent=money(summary.paidAmount);
    el("outstanding").textContent=money(summary.outstandingAmount);
    el("count").textContent=Number(summary.completedOrderCount||0).toLocaleString("ar-EG");
    el("scopeMessage").textContent=role==="former"
      ? "تقدر تتابع أرباحك ومستحقاتك القديمة، لكن إدارة المحل والعمولات المستقبلية لم تعد تخص حسابك."
      : role==="assigned" ? "المحل شغال بروابطه المعتادة. العمولات الجديدة من وقت التخصيص بتظهر هنا. تغيير الإعدادات والتسويات محفوظ للإجراءات المعتمدة من المنصة."
      : "الأرقام دي خاصة بعمولات المشروع المرتبطة بحسابك فقط.";
    el("settlementHistory").innerHTML=payments.length?payments.map(p=>`
      <article>
       <div><b>${money(p.amount)}</b><small>${esc(p.status||"غير محدد")}</small>
        <small>دورة الإدارة: ${Number(p.assignmentCycle||1).toLocaleString("ar-EG")}</small></div>
       <div>
        <small>${p.createdAt?.toDate?.()?.toLocaleDateString("ar-EG")||"—"}</small>
        ${MERCHANT_REPEAT_ASSIGNMENT_ENABLED && p.assignmentCycle>=1
         && p.status==="pending_owner_confirmation" && p.ownerId===user.uid
         ? `<div class="statement-actions">
           <button type="button" data-settlement-id="${esc(p.settlementId)}" data-decision="accept">تأكيد الاستلام</button>
           <button type="button" data-settlement-id="${esc(p.settlementId)}" data-decision="reject">لم أستلم</button>
          </div>`:""}
       </div>
      </article>
    `).join(""):"لا توجد عمليات تسوية مسجلة في حسابك.";
    el("financeSection").hidden=false;
    el("settlementHistory").querySelectorAll("[data-settlement-id]").forEach(button=>{
      button.addEventListener("click",async()=>{
        if(!confirm(button.dataset.decision==="accept"
          ? "هل وصل لك المبلغ فعلًا؟ لا تؤكد إلا بعد استلامه."
          : "هل تؤكد أن هذه الدفعة لم تصلك؟"))return;
        button.disabled=true;
        try {
         await decideMerchantCyclePayment({
          settlementId:button.dataset.settlementId,subscriberUid:user.uid,
          accept:button.dataset.decision==="accept"
         });
         location.reload();
        }catch(error){
         console.error("Cycle payment decision rejected",error);
         el("errorPanel").hidden=false;
         el("errorPanel").textContent="تعذر تسجيل قرار السداد؛ راجع حالة الدفعة ثم أعد المحاولة.";
         button.disabled=false;
        }
      });
    });
  }catch(error){
    console.error("Merchant statement access/load denied",error);
    el("merchantTitle").textContent="تعذر فتح كشف الحساب";
    el("merchantStatus").textContent="";
    el("errorPanel").hidden=false;
    el("errorPanel").textContent="تعذر عرض كشف الحساب أو التحقق من الصلاحيات. تأكد من الرابط وسجّل دخولك بالحساب الصحيح.";
  }
});
