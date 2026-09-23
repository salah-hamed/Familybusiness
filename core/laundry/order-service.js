import db from "../firebase/firebase-db.js";
import { getEffectiveCommissionAmount } from "../commissions/commission-service.js";

import {
  collection,query,where,getDocs,doc,getDoc,updateDoc,runTransaction,serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const FLOW=Object.freeze({
  new:["accepted","canceled"],
  accepted:["pickup_assigned","canceled"],
  pickup_assigned:["picked_up","canceled"],
  picked_up:["processing","canceled"],
  processing:["ready_delivery","canceled"],
  ready_delivery:["out_for_delivery","canceled"],
  out_for_delivery:["delivered","canceled"],
  delivered:[],canceled:[]
});

export function currentLaundryStage(order={}){
  if(order.status==="new")return "new";
  if(order.status==="canceled")return "canceled";
  if(order.status==="done"||order.laundryStage==="delivered")return "delivered";
  return order.laundryStage||"accepted";
}

export function allowedLaundryNextStages(order={}){
  return FLOW[currentLaundryStage(order)]||[];
}

export async function listLaundryOrders(projectId){
  const snap=await getDocs(query(collection(db,"orders"),where("projectId","==",projectId)));
  return snap.docs.map(d=>({orderId:d.id,...d.data()}))
    .filter(x=>x.templateType==="laundry")
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
}

export async function changeLaundryStage({projectId,orderId,actorUid,nextStage}){
  const ref=doc(db,"orders",orderId);
  const snap=await getDoc(ref);
  if(!snap.exists())throw new Error("ORDER_NOT_FOUND");
  const order=snap.data();
  if(order.projectId!==projectId||order.templateType!=="laundry")throw new Error("ORDER_PROJECT_MISMATCH");
  if(!allowedLaundryNextStages(order).includes(nextStage))throw new Error("INVALID_LAUNDRY_TRANSITION");

  if(nextStage==="pickup_assigned"&&!order.assignedWorkerId)throw new Error("PICKUP_AGENT_REQUIRED");
  if(nextStage==="out_for_delivery"&&!order.assignedWorkerId)throw new Error("DELIVERY_AGENT_REQUIRED");

  if(nextStage==="canceled"){
    await updateDoc(ref,{status:"canceled",statusUpdatedAt:serverTimestamp(),statusUpdatedBy:actorUid});
    return;
  }

  if(nextStage!=="delivered"){
    await updateDoc(ref,{
      status:"accepted",laundryStage:nextStage,statusUpdatedAt:serverTimestamp(),statusUpdatedBy:actorUid
    });
    return;
  }

  const agreementRef=doc(db,"commissionAgreements",projectId);
  const ledgerRef=doc(db,"commissionLedger",`project_order_${orderId}`);

  await runTransaction(db,async transaction=>{
    const freshOrderSnap=await transaction.get(ref);
    const agreementSnap=await transaction.get(agreementRef);
    if(!freshOrderSnap.exists()||!agreementSnap.exists())throw new Error("ORDER_OR_AGREEMENT_NOT_FOUND");
    const fresh=freshOrderSnap.data(),agreement=agreementSnap.data();
    if(!allowedLaundryNextStages(fresh).includes("delivered"))throw new Error("INVALID_LAUNDRY_TRANSITION");
    const amount=getEffectiveCommissionAmount(agreement);
    if(amount==null)throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

    transaction.update(ref,{
      status:"done",laundryStage:"delivered",deliveredAt:serverTimestamp(),
      statusUpdatedAt:serverTimestamp(),statusUpdatedBy:actorUid,
      commissionEligible:true,commissionLocked:true,commissionAmount:amount,
      commissionAgreementVersion:Number(agreement.acceptedVersion||agreement.version||1)
    });

    transaction.set(ledgerRef,{
      userId:agreement.ownerId,projectId,orderId,sourceType:"project_order",sourceId:orderId,
      agreementId:projectId,agreementVersion:Number(agreement.acceptedVersion||agreement.version||1),
      amount,currency:"EGP",status:"earned",createdAt:serverTimestamp(),paidAt:null
    });
  });
}
