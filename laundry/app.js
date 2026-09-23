import db from "../core/firebase/firebase-db.js";
import { protectPage } from "../core/auth/auth-guard.js";
import { createOrResumeLaundrySetup, getLaundryBundle, migrateLegacyLaundryProject } from "../core/laundry/laundry-service.js";
import { proposeCommission } from "../core/commissions/commission-service.js";
import { ensureOperatorInviteAccess, getOperatorInviteToken } from "../core/partners/partner-service.js";
import { normalizeWhatsAppPhone } from "../core/whatsapp/dispatch-service.js";

import {doc,getDoc,collection,getDocs,query,where} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $=id=>document.getElementById(id);
const projectId=new URLSearchParams(location.search).get("project")||"";
let user=null,project=null,bundle=null;
const money=v=>`${Number(v||0).toLocaleString("ar-EG")} جنيه`;
const esc=v=>String(v??"")
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;")
  .replace(/'/g,"&#039;");
const statusText=s=>({accepted:"مقبول",pending:"بانتظار الموافقة",rejected:"مرفوض",not_proposed:"لم يبدأ"})[s]||s||"—";

document.querySelectorAll("[data-copy]").forEach(btn=>btn.onclick=async()=>{
  const el=$(btn.dataset.copy);if(!el?.value)return;
  try{await navigator.clipboard.writeText(el.value);}catch{el.select();document.execCommand("copy");}
});

async function loadEarnings(){
  const snap=await getDocs(query(collection(db,"commissionLedger"),where("userId","==",user.uid)));
  const rows=snap.docs.map(d=>d.data()).filter(x=>x.sourceType==="project_order"&&x.projectId===projectId);
  const earned=rows.reduce((s,x)=>s+Number(x.amount||0),0);
  const paid=rows.filter(x=>x.status==="paid"||x.paidAt).reduce((s,x)=>s+Number(x.amount||0),0);
  $("completedOrders").innerText=rows.length;$("earnedCommission").innerText=money(earned);$("paidCommission").innerText=money(paid);$("outstandingCommission").innerText=money(Math.max(0,earned-paid));
}

function render(){
  const {laundry,operator,agreement}=bundle;
  const configured=!!(laundry&&operator);
  $("setupSection").classList.toggle("hidden",configured);
  $("projectSection").classList.toggle("hidden",!configured);
  if(!configured){$("statusBanner").innerText="ابدأ بربط مغسلة واحدة بالمشروع وتحديد العمولة المقترحة.";return;}

  const accepted=agreement?.status==="accepted"&&agreement?.currentAmount!=null;
  const pending=agreement?.pendingStatus==="pending";
  $("statusBanner").innerText=accepted?"المغسلة مرتبطة بالمشروع. التشغيل عند المغسلة وأنت تتابع العمولة.":"المشروع في انتظار اعتماد اتفاق العمولة.";
  $("linkedLaundryName").innerText=laundry.name||operator.name||"المغسلة";
  $("operatorState").innerText=operator.isActive?"نشطة":"بانتظار التفعيل";
  $("currentCommission").innerText=accepted?money(agreement.currentAmount)+" لكل طلب مكتمل":"لم تعتمد بعد";
  $("agreementStatus").innerText=pending?`${statusText(agreement?.status)} · تعديل منتظر`:statusText(agreement?.status||operator.agreementStatus);
  $("laundryMeta").innerHTML=[
    ["المسؤول",laundry.contactName||operator.contactName||"—"],["الهاتف",laundry.phone||operator.phone||"—"],
    ["واتساب المسؤول",operator.whatsapp||laundry.whatsapp||"—"],["العنوان",laundry.address||"—"]
  ].map(([k,v])=>`<div><b>${esc(k)}</b><div>${esc(v)}</div></div>`).join("");

  $("commissionMessage").innerText=pending&&agreement?.pendingAmount!=null?`في انتظار موافقة المغسلة على ${money(agreement.pendingAmount)}.`:"";
  const operatorUrl=new URL("../laundry-operator/",location.href);operatorUrl.searchParams.set("project",projectId);const inviteToken=getOperatorInviteToken(operator);if(inviteToken)operatorUrl.searchParams.set("invite",inviteToken);$("operatorLink").value=operatorUrl.toString();$("sendOperatorWhatsappBtn").disabled=!(inviteToken&&(operator.whatsapp||operator.phone));
  const customerUrl=new URL("../templates/laundry/",location.href);customerUrl.searchParams.set("project",projectId);
  $("customerLink").value=accepted&&operator.isActive?customerUrl:"";
  $("linksHint").innerText=accepted&&operator.isActive?"المغسلة جاهزة للتشغيل.":"رابط العملاء يتفعل بعد قبول أول اتفاق عمولة وتفعيل حساب المغسلة.";
}

async function refresh(){bundle=await getLaundryBundle(projectId);if(bundle?.operator&&!bundle.operator.authLoginEmail&&!bundle.operator.authUid){bundle.operator=await ensureOperatorInviteAccess(projectId,user.uid);}render();if(bundle.laundry)await loadEarnings();}

protectPage(async current=>{
  user=current;
  if(!projectId){$("statusBanner").innerText="رابط المشروع غير مكتمل.";return;}
  const snap=await getDoc(doc(db,"projects",projectId));
  if(!snap.exists()){ $("statusBanner").innerText="المشروع غير موجود.";return;}
  project={projectDocId:snap.id,...snap.data()};
  if(project.ownerId!==user.uid||project.template!=="laundry"){ $("statusBanner").innerText="غير مسموح لك بإدارة هذا المشروع.";return;}

  if(project.operatingModel!=="partner_operated"){
    $("statusBanner").innerText="جاري ترقية مشروع الغسيل إلى نموذج Laundry 2.0...";
    try{
      await migrateLegacyLaundryProject(projectId,user.uid);
      const migrated=await getDoc(doc(db,"projects",projectId));
      project={projectDocId:migrated.id,...migrated.data()};
    }catch(e){
      $("statusBanner").innerText=`تعذر ترقية المشروع: ${e.message}`;
      return;
    }
  }

  await refresh();
});

$("createSetupBtn").onclick=async()=>{
  if(!user||!project)return;$("createSetupBtn").disabled=true;$("setupMessage").innerText="جاري ربط المغسلة...";
  try{
    await createOrResumeLaundrySetup({projectId,ownerId:user.uid,name:$("laundryName").value,contactName:$("contactName").value,phone:$("laundryPhone").value,whatsapp:$("laundryWhatsapp").value,address:$("laundryAddress").value,location:$("laundryLocation").value,commissionAmount:$("commissionAmount").value});
    $("setupMessage").innerText="تم ربط المغسلة. ابعت دعوة التشغيل من زر واتساب ✅";await refresh();
  }catch(e){$("setupMessage").innerText=`تعذر الحفظ: ${e.message}`;}finally{$("createSetupBtn").disabled=false;}
};

$("proposeCommissionBtn").onclick=async()=>{
  if(!user||!bundle?.operator)return;$("commissionMessage").innerText="جاري إرسال التعديل...";
  try{await proposeCommission({projectDocId:projectId,ownerId:user.uid,operatorId:projectId,templateId:"laundry",amount:$("newCommissionAmount").value});$("newCommissionAmount").value="";await refresh();}
  catch(e){$("commissionMessage").innerText=e.message;}
};

$("sendOperatorWhatsappBtn").onclick=()=>{
  const operator=bundle?.operator;
  const phone=normalizeWhatsAppPhone(operator?.whatsapp||operator?.phone);
  const link=$("operatorLink").value;
  if(!phone||!link){return;}
  const message=`دعوة من Family Business لإدارة ${bundle?.laundry?.name||"المغسلة"}.\nافتح الرابط الشخصي التالي، أنشئ كلمة مرور أول مرة ثم وافق على العمولة لبدء التشغيل:\n${link}\n\nمهم: الرابط شخصي، لا تعمله Forward لأي شخص.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,"_blank","noopener");
};
