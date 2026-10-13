import db from "../firebase/firebase-db.js";
import { getProjectPaymentSummary } from "./settlement-service.js";
import { isVerifiedAssignedAfterCutover } from "../merchants/merchant-commission-beneficiary.js";
import { MERCHANT_REPEAT_ASSIGNMENT_ENABLED } from "../merchants/merchant-cycle-rollout.js";
import {
  collection,doc,getDoc,runTransaction,serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
function cleanId(v){const id=String(v||"").trim();if(!ID.test(id))throw new Error("CYCLE_PAYMENT_INVALID_ID");return id;}
function exactAmount(v){
 const n=Number(v);
 if(!Number.isFinite(n)||n<=0||Math.round(n*100)!==n*100)
  throw new Error("CYCLE_PAYMENT_INVALID_AMOUNT");
 return n;
}
export function cycleSettlementScope(project,projectId){
 if(!isVerifiedAssignedAfterCutover(project) || project.platformManaged!==true)
  throw new Error("CYCLE_PAYMENT_NOT_ASSIGNED");
 const cycle=project.assignmentCycle??1;
 if(!Number.isSafeInteger(cycle)||cycle<1||cycle>9999)
  throw new Error("CYCLE_PAYMENT_INVALID_CYCLE");
 return {
  projectId,cycle,cycleId:projectId+"_"+cycle,
  beneficiaryId:cleanId(project.assignedSubscriberId),
  operatorId:project.operatorId
 };
}
export async function declareMerchantCyclePayment({
 projectId,operatorUid,amount,paymentMethod,paymentReference=""
}={}){
 // First and repeat assignments both require final audited Rules rollout.
 if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)throw new Error("CYCLE_PAYMENTS_DISABLED");
 cleanId(projectId);cleanId(operatorUid);
 const paid=exactAmount(amount),method=String(paymentMethod||"").trim();
 if(!["instapay","bank_transfer","cash","other"].includes(method))
  throw new Error("CYCLE_PAYMENT_METHOD_INVALID");
 const reference=String(paymentReference||"").trim().slice(0,200);
 const due=await getProjectPaymentSummary(projectId);
 if(due.pendingCount>0)throw new Error("CYCLE_PAYMENT_ALREADY_PENDING");
 if(paid>due.outstandingAmount)throw new Error("CYCLE_PAYMENT_EXCEEDS_DUE");
 const settlementRef=doc(collection(db,"commissionSettlements"));
 return runTransaction(db,async tx=>{
  const projectRef=doc(db,"projects",projectId);
  const project=await tx.get(projectRef);
  if(!project.exists())throw new Error("CYCLE_PAYMENT_PROJECT_MISSING");
  const scope=cycleSettlementScope(project.data(),projectId);
  const stateRef=doc(db,"merchantCyclePaymentStates",scope.cycleId);
  const opRef=doc(db,"operators",scope.operatorId);
  const [state,operator]=await Promise.all([tx.get(stateRef),tx.get(opRef)]);
  if(!operator.exists()||operator.data().authUid!==operatorUid
    ||operator.data().status!=="active"||operator.data().isActive!==true)
   throw new Error("CYCLE_PAYMENT_OPERATOR_DENIED");
  if(state.exists()&&state.data().pendingSettlementId)
   throw new Error("CYCLE_PAYMENT_ALREADY_PENDING");
  const now=serverTimestamp();
  tx.set(settlementRef,{
   settlementId:settlementRef.id,projectId,ownerId:scope.beneficiaryId,
   operatorId:scope.operatorId,assignmentCycle:scope.cycle,
   templateId:project.data().template,businessName:project.data().businessName||"",
   currency:"EGP",amount:paid,status:"pending_owner_confirmation",
   paymentMethod:method,paymentReference:reference,note:"",
   declaredAt:now,declaredBy:operatorUid,createdAt:now,updatedAt:now,
   confirmedAt:null,confirmedBy:null,rejectedAt:null,rejectedBy:null
  });
  tx.set(stateRef,{
   projectId,assignmentCycle:scope.cycle,beneficiaryId:scope.beneficiaryId,
   operatorId:scope.operatorId,pendingSettlementId:settlementRef.id,
   updatedAt:now
  },{merge:true});
  return settlementRef.id;
 });
}
export async function decideMerchantCyclePayment({settlementId,subscriberUid,accept}={}){
 if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)throw new Error("CYCLE_PAYMENTS_DISABLED");
 cleanId(settlementId);cleanId(subscriberUid);
 if(typeof accept!=="boolean")throw new Error("CYCLE_PAYMENT_DECISION_INVALID");
 const settlementRef=doc(db,"commissionSettlements",settlementId);
 return runTransaction(db,async tx=>{
  const settlement=await tx.get(settlementRef);
  if(!settlement.exists())throw new Error("CYCLE_PAYMENT_NOT_FOUND");
  const data=settlement.data();
  if(data.ownerId!==subscriberUid||data.status!=="pending_owner_confirmation")
   throw new Error("CYCLE_PAYMENT_NOT_OWNER_OR_NOT_PENDING");
  const projectRef=doc(db,"projects",data.projectId);
  const stateRef=doc(db,"merchantCyclePaymentStates",data.projectId+"_"+data.assignmentCycle);
  const [project,state]=await Promise.all([tx.get(projectRef),tx.get(stateRef)]);
  if(!project.exists())throw new Error("CYCLE_PAYMENT_PROJECT_MISSING");
  const scope=cycleSettlementScope(project.data(),data.projectId);
  if(scope.beneficiaryId!==subscriberUid||scope.cycle!==data.assignmentCycle)
   throw new Error("CYCLE_PAYMENT_NO_LONGER_CURRENT");
  if(!state.exists()||state.data().pendingSettlementId!==settlementId)
   throw new Error("CYCLE_PAYMENT_STATE_MISMATCH");
  const at=serverTimestamp();
  tx.update(settlementRef,{
   status:accept?"confirmed":"rejected",
   confirmedAt:accept?at:null,confirmedBy:accept?subscriberUid:null,
   rejectedAt:accept?null:at,rejectedBy:accept?null:subscriberUid,
   updatedAt:at
  });
  tx.update(stateRef,{pendingSettlementId:"",updatedAt:at});
  return settlementId;
 });
}
