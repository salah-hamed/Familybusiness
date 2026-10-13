import { isQualifyingMerchantLink } from "./merchant-identity.js";
import { transferTermsMatchAgreement } from "./transfer-financial-terms.js";
import { MERCHANT_RECOVERY_REASON } from "./merchant-recovery-policy.js";
import {
  isVerifiedAssignedAfterCutover,
  isVerifiedPlatformManagedMerchant
} from "./merchant-commission-beneficiary.js";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const MERCHANT=/^m_[0-9a-f]{32}$/;
const TEMPLATES=new Set(["supermarket","restaurant","bakery","laundry"]);
const reasonCodes=new Set(Object.values(MERCHANT_RECOVERY_REASON));
const money=value=>typeof value==="number" && Number.isFinite(value) && value>=0;
function millis(v){
  if(typeof v?.toMillis==="function") return v.toMillis();
  if(typeof v?.toDate==="function") return v.toDate().getTime();
  if(v instanceof Date)return v.getTime();
  if(typeof v==="string"||typeof v==="number")return new Date(v).getTime();
  return NaN;
}
function identity(project,projectId){
  return Boolean(project && ID.test(String(projectId||""))
   && project.ownerId===project.originalSubscriberId
   && ID.test(String(project.ownerId||""))
   && MERCHANT.test(String(project.merchantId||""))
   && TEMPLATES.has(project.template)
   && project.operatingModel==="partner_operated"
   && project.operatorId===projectId
   && project.isActive===true && project.status==="active");
}
export function merchantCycleId(projectId,cycle){
  if(!ID.test(String(projectId||""))||!Number.isSafeInteger(cycle)||cycle<2||cycle>9999)
    throw new Error("MERCHANT_CYCLE_INVALID");
  const id=`${projectId}_${cycle}`;
  if(id.length>180)throw new Error("MERCHANT_CYCLE_ID_TOO_LONG");
  return id;
}
export function nextMerchantCycle(project){
  const current=project?.assignmentCycle==null?1:project.assignmentCycle;
  if(!Number.isSafeInteger(current)||current<1||current>=9999)
    throw new Error("MERCHANT_CYCLE_OVERFLOW");
  return current+1;
}
function checkReason({reason,subscriber,violation,now,pendingPayment}){
  if(!reasonCodes.has(reason))throw new Error("MERCHANT_RECOVERY_REASON_INVALID");
  if(pendingPayment!==false)throw new Error("MERCHANT_RECOVERY_PAYMENT_CHECK_NOT_CLEAR");
  if(reason===MERCHANT_RECOVERY_REASON.CONFIRMED_VIOLATION){
    if(violation?.status!=="confirmed"
      ||typeof violation.reasonCode!=="string"
      ||!/^[a-z][a-z0-9_]{2,63}$/.test(violation.reasonCode)
      ||typeof violation.evidenceReference!=="string"
      ||violation.evidenceReference.trim().length<8
      ||!ID.test(String(violation.confirmedByAdminUid||""))
      ||!Number.isFinite(millis(violation.confirmedAt))
      ||millis(violation.confirmedAt)>millis(now))
      throw new Error("MERCHANT_RECOVERY_UNVERIFIED_VIOLATION");
    return violation.evidenceReference.trim();
  }
  const exp=millis(subscriber?.subscriptionExpiresAt);
  if(!Number.isFinite(exp))throw new Error("MERCHANT_RECOVERY_EXPIRY_NOT_PROVEN");
  if(reason===MERCHANT_RECOVERY_REASON.OVERDUE_RENEWAL){
    if(!((subscriber?.initialActivationPaid===true||Boolean(subscriber?.lastSubscriptionPaymentId))
      && exp<=millis(now)))
      throw new Error("MERCHANT_RECOVERY_SUBSCRIPTION_NOT_OVERDUE");
    return `overdue_renewal_${subscriber.uid}_${exp}`;
  }
  const linked=millis(subscriber?.firstMerchantLinkedAt);
  if(!(subscriber?.accessModel==="merchant_trial_v1" && subscriber?.initialActivationPaid===false
    && !subscriber?.lastSubscriptionPaymentId
    && Number.isFinite(linked) && linked<=millis(now)
    && millis(now)>=linked+3*86400000))
    throw new Error("MERCHANT_RECOVERY_FIRST_MONTH_NOT_OVERDUE");
  return `unpaid_first_month_${subscriber.uid}_${linked}`;
}
/**
 * Second and subsequent recoveries. Cycles 0/1 remain the immutable C4
 * historical events. Never mutate ledger, orders, original owner, operator
 * or previous recovery/cutover audit. This pure contract is NOT authorization.
 */
export function buildRepeatMerchantRecovery({
  projectId,adminUid,project,priorAssignmentAudit,subscriber,operator,
  agreement,reason,violation=null,pendingPayment=null,now=new Date()
}={}){
  if(!ID.test(String(adminUid||"")) || !identity(project,projectId)
    ||!Number.isFinite(millis(now)))throw new Error("MERCHANT_REPEAT_RECOVERY_INVALID_IDENTITY");
  const cycle=nextMerchantCycle(project);
  const previous=project.assignedSubscriberId;
  const previousCycle=cycle-1;
  if(!ID.test(String(previous||"")) || previous===project.ownerId ||
     !isVerifiedAssignedAfterCutover(project) ||
     !isQualifyingMerchantLink(operator||{},agreement||{}) ||
     subscriber?.uid!==previous)
    throw new Error("MERCHANT_REPEAT_RECOVERY_NOT_CURRENT");
  const priorId=previousCycle===1?projectId:merchantCycleId(projectId,previousCycle);
  if(project.cutoverAuditId!==priorId ||
    priorAssignmentAudit?.status!=="completed" ||
    priorAssignmentAudit?.projectDocId!==projectId ||
    priorAssignmentAudit?.merchantId!==project.merchantId ||
    priorAssignmentAudit?.assignedSubscriberId!==previous)
    throw new Error("MERCHANT_REPEAT_RECOVERY_PREVIOUS_AUDIT_INVALID");
  const evidenceReference=checkReason({reason,subscriber,violation,now,pendingPayment});
  const id=merchantCycleId(projectId,cycle);
  const at=now;
  return {
    cycle,cycleId:id,previousSubscriberId:previous,
    projectPatch:{
      assignmentCycle:cycle,platformManaged:true,
      assignmentStatus:"platform_managed",assignedSubscriberId:"",
      assignmentUpdatedAt:at,recoveryAuditId:id,recoveryAt:at,
      recoveryAdminUid:adminUid,recoveryReason:reason
    },
    recoveryAudit:{
      cycle,cycleId:id,projectDocId:projectId,merchantId:project.merchantId,
      originalSubscriberId:project.ownerId,previousSubscriberId:previous,
      previousAssignmentAuditId:priorId,reason,evidenceReference,
      status:"completed",adminUid,recoveredAt:at
    },
    historicAccess:{
      projectDocId:projectId,merchantId:project.merchantId,
      subscriberUid:previous,originalSubscriberId:project.ownerId,
      firstRecoveredCycle:cycle,sourceRecoveryAuditId:id,
      status:"historic_only",grantedAt:at
    }
  };
}
export function buildRepeatMerchantAssignment({
  projectId,adminUid,project,recoveryAudit,transferCase,financeReview,
  operator,agreement,recipient,priorRecipientHistoricGrant=null,now=new Date()
}={}){
  if(!ID.test(String(adminUid||""))||!identity(project,projectId)
    ||!Number.isFinite(millis(now)))throw new Error("MERCHANT_REPEAT_ASSIGNMENT_INVALID_IDENTITY");
  const cycle=project.assignmentCycle;
  if(!Number.isSafeInteger(cycle)||cycle<2)throw new Error("MERCHANT_REPEAT_ASSIGNMENT_INVALID_CYCLE");
  const id=merchantCycleId(projectId,cycle),uid=transferCase?.proposedSubscriberId;
  if(!ID.test(String(uid||""))||uid===project.ownerId ||
    uid===recoveryAudit?.previousSubscriberId || priorRecipientHistoricGrant != null)
    throw new Error("MERCHANT_REPEAT_ASSIGNMENT_PREVIOUS_RECIPIENT_FORBIDDEN");
  if(!isVerifiedPlatformManagedMerchant(project)
    ||project.recoveryAuditId!==id||project.assignedSubscriberId!==""
    ||recoveryAudit?.cycleId!==id||recoveryAudit?.status!=="completed"
    ||recoveryAudit?.merchantId!==project.merchantId
    ||recoveryAudit?.previousSubscriberId===uid
    ||transferCase?.cycleId!==id
    ||transferCase?.projectDocId!==projectId
    ||transferCase?.merchantId!==project.merchantId
    ||transferCase?.previousSubscriberId!=="" ||
       transferCase?.status!=="awaiting_consents"
    ||transferCase?.operatorConsent!=="accepted"
    ||transferCase?.recipientConsent!=="accepted"
    ||transferCase?.operatorConsentedAt==null||transferCase?.recipientConsentedAt==null
    ||transferCase?.financeClearance!=="reviewed"
    ||transferCase?.financeReviewedBy!==financeReview?.adminUid
    ||millis(transferCase?.financeReviewedAt)!==millis(financeReview?.reviewedAt)
    ||financeReview?.cycleId!==id||financeReview?.projectDocId!==projectId
    ||financeReview?.currency!=="EGP"
    ||financeReview?.formerSubscriberId!==recoveryAudit.previousSubscriberId
    ||!money(financeReview?.formerSubscriberEarnedAmount)
    ||!money(financeReview?.formerSubscriberOutstandingAmount)
    ||!money(financeReview?.platformEarnedAmount)
    ||!money(financeReview?.platformOutstandingAmount)
    ||financeReview.formerSubscriberOutstandingAmount>financeReview.formerSubscriberEarnedAmount
    ||financeReview.platformOutstandingAmount>financeReview.platformEarnedAmount
    ||!isQualifyingMerchantLink(operator||{},agreement||{})
    ||!transferTermsMatchAgreement(transferCase,agreement)
    ||recipient?.uid!==uid||recipient.isActive!==true
    ||recipient.subscriptionStatus!=="active"
    ||(recipient.subscriptionExpiresAt!=null &&
      !(millis(recipient.subscriptionExpiresAt)>millis(now))))
    throw new Error("MERCHANT_REPEAT_ASSIGNMENT_PREREQUISITES_FAILED");
  return {
    cycle,cycleId:id,recipientUid:uid,
    projectPatch:{
      assignmentStatus:"assigned_to_new_subscriber",assignedSubscriberId:uid,
      assignmentUpdatedAt:now,cutoverAuditId:id,cutoverAt:now,
      cutoverAdminUid:adminUid
    },
    casePatch:{status:"cutover_completed",cutoverAt:now,cutoverBy:adminUid,cutoverAuditId:id},
    assignmentAudit:{
      cycle,cycleId:id,projectDocId:projectId,merchantId:project.merchantId,
      originalSubscriberId:project.ownerId,
      previousSubscriberId:recoveryAudit.previousSubscriberId,
      assignedSubscriberId:uid,recoveryAuditId:id,financeReviewId:id,
      commissionAmount:transferCase.commissionAmount,
      commissionVersion:transferCase.commissionVersion,
      commissionCurrency:"EGP",status:"completed",
      completedBy:adminUid,completedAt:now
    }
  };
}
