import db from "../firebase/firebase-db.js";
import { getEffectiveCommissionSnapshot, getProjectCommissionLedgerId } from "../commissions/commission-service.js";

import {
  collection,query,where,orderBy,startAfter,limit,getDocs,getCountFromServer,doc,getDoc,updateDoc,runTransaction,serverTimestamp
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


function isMissingCompositeIndexError(error){
  const code=String(error?.code||"").toLowerCase();
  const message=String(error?.message||"").toLowerCase();
  return code.includes("failed-precondition")&&message.includes("index");
}

function orderCreatedAtMillis(docSnap){
  const value=docSnap.data()?.createdAt;
  if(typeof value?.toMillis==="function")return value.toMillis();
  return Number(value?.seconds||0)*1000;
}

async function loadLaundryOrderDocsWithoutCompositeIndex(projectId){
  const snap=await getDocs(query(
    collection(db,"orders"),
    where("projectId","==",projectId),
    where("templateType","==","laundry")
  ));
  return snap.docs
    .filter(item=>item.data().templateType==="laundry")
    .sort((a,b)=>orderCreatedAtMillis(b)-orderCreatedAtMillis(a));
}

function fallbackLaundryPage(docs,{size,cursor=null,statuses=null}={}){
  const filtered=statuses?docs.filter(item=>statuses.includes(item.data().status)):docs;
  const cursorIndex=cursor?filtered.findIndex(item=>item.id===cursor.id):-1;
  const start=cursor?(cursorIndex>=0?cursorIndex+1:filtered.length):0;
  const pageDocs=filtered.slice(start,start+size);
  return {
    orders:pageDocs.map(item=>({orderId:item.id,...item.data()})),
    nextCursor:pageDocs.length?pageDocs[pageDocs.length-1]:null,
    hasMore:start+pageDocs.length<filtered.length
  };
}

export function currentLaundryStage(order={}){
  if(order.status==="new")return "new";
  if(order.status==="canceled")return "canceled";
  if(order.status==="done"||order.laundryStage==="delivered")return "delivered";
  return order.laundryStage||"accepted";
}

export function allowedLaundryNextStages(order={}){
  return FLOW[currentLaundryStage(order)]||[];
}

export async function listLaundryOrdersPage(projectId,{pageSize=50,cursor=null}={}){
  const size=Math.max(1,Math.min(100,Number(pageSize)||50));
  const constraints=[
    where("projectId","==",projectId),
    where("templateType","==","laundry"),
    orderBy("createdAt","desc")
  ];
  if(cursor)constraints.push(startAfter(cursor));
  constraints.push(limit(size));

  try{
    const snap=await getDocs(query(collection(db,"orders"),...constraints));
    return {
      orders:snap.docs.map(d=>({orderId:d.id,...d.data()})),
      nextCursor:snap.docs.length?snap.docs[snap.docs.length-1]:null,
      hasMore:snap.docs.length===size
    };
  }catch(error){
    if(!isMissingCompositeIndexError(error))throw error;
    const docs=await loadLaundryOrderDocsWithoutCompositeIndex(projectId);
    return fallbackLaundryPage(docs,{size,cursor});
  }
}

export async function listLaundryOperationalOrders(projectId){
  const activeStatuses=["new","accepted"];
  try{
    const snap=await getDocs(query(
      collection(db,"orders"),
      where("projectId","==",projectId),
      where("templateType","==","laundry"),
      where("status","in",activeStatuses),
      orderBy("createdAt","desc")
    ));
    return snap.docs.map(d=>({orderId:d.id,...d.data()}));
  }catch(error){
    if(!isMissingCompositeIndexError(error))throw error;
    const docs=await loadLaundryOrderDocsWithoutCompositeIndex(projectId);
    return docs.filter(item=>activeStatuses.includes(item.data().status))
      .map(item=>({orderId:item.id,...item.data()}));
  }
}

export async function listLaundryHistoryPage(projectId,{pageSize=50,cursor=null}={}){
  const size=Math.max(1,Math.min(100,Number(pageSize)||50));
  const historyStatuses=["done","canceled"];
  const constraints=[
    where("projectId","==",projectId),
    where("templateType","==","laundry"),
    where("status","in",historyStatuses),
    orderBy("createdAt","desc")
  ];
  if(cursor)constraints.push(startAfter(cursor));
  constraints.push(limit(size));

  try{
    const snap=await getDocs(query(collection(db,"orders"),...constraints));
    return {
      orders:snap.docs.map(d=>({orderId:d.id,...d.data()})),
      nextCursor:snap.docs.length?snap.docs[snap.docs.length-1]:null,
      hasMore:snap.docs.length===size
    };
  }catch(error){
    if(!isMissingCompositeIndexError(error))throw error;
    const docs=await loadLaundryOrderDocsWithoutCompositeIndex(projectId);
    return fallbackLaundryPage(docs,{size,cursor,statuses:historyStatuses});
  }
}

export async function countLaundryDeliveredOrders(projectId){
  try{
    const snap=await getCountFromServer(query(
      collection(db,"orders"),
      where("projectId","==",projectId),
      where("templateType","==","laundry"),
      where("status","==","done")
    ));
    return snap.data().count;
  }catch(error){
    if(!isMissingCompositeIndexError(error))throw error;
    const docs=await loadLaundryOrderDocsWithoutCompositeIndex(projectId);
    return docs.filter(item=>item.data().status==="done").length;
  }
}

export async function listLaundryOrders(projectId){
  const snap=await getDocs(query(
    collection(db,"orders"),
    where("projectId","==",projectId),
    where("templateType","==","laundry")
  ));
  return snap.docs.map(d=>({orderId:d.id,...d.data()}))
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

  if(nextStage==="out_for_delivery"){
    const agreementRef=doc(db,"commissionAgreements",projectId);
    const ledgerRef=doc(db,"commissionLedger",getProjectCommissionLedgerId(orderId));

    try{
      await runTransaction(db,async transaction=>{
        const freshOrderSnap=await transaction.get(ref);
        const agreementSnap=await transaction.get(agreementRef);
        if(!freshOrderSnap.exists()||!agreementSnap.exists())throw new Error("ORDER_OR_AGREEMENT_NOT_FOUND");

        const fresh=freshOrderSnap.data();
        const commission=getEffectiveCommissionSnapshot(agreementSnap.data());

        if(fresh.projectId!==projectId||fresh.templateType!=="laundry")throw new Error("ORDER_PROJECT_MISMATCH");
        if(fresh.status!=="accepted"||fresh.laundryStage!=="ready_delivery"||!fresh.assignedWorkerId){
          throw new Error("ORDER_NOT_READY_FOR_DELIVERY_ASSIGNMENT");
        }
        if(fresh.assignedWorkerRole!=="delivery_agent")throw new Error("DELIVERY_AGENT_REQUIRED");
        if(!commission)throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

        const earnedAt=serverTimestamp();

        transaction.update(ref,{
          status:"accepted",
          laundryStage:"out_for_delivery",
          statusUpdatedAt:earnedAt,
          statusUpdatedBy:actorUid,
          commissionEligible:true,
          commissionLocked:true,
          commissionAmount:commission.amount,
          commissionAgreementVersion:commission.version,
          commissionTrigger:"delivery_assignment",
          commissionEarnedAt:earnedAt
        });

        transaction.set(ledgerRef,{
          userId:agreementSnap.data().ownerId,
          projectId,
          orderId,
          sourceType:"project_order",
          sourceId:orderId,
          agreementId:projectId,
          agreementVersion:commission.version,
          amount:commission.amount,
          currency:"EGP",
          status:"earned",
          trigger:"delivery_assignment",
          createdAt:earnedAt,
          earnedAt,
          paidAt:null
        });
      });

      return;
    }catch(error){
      if(String(error?.code||"").toLowerCase()!=="permission-denied")throw error;

      // Production compatibility until the new Firestore Rules are deployed.
      await updateDoc(ref,{
        status:"accepted",
        laundryStage:"out_for_delivery",
        statusUpdatedAt:serverTimestamp(),
        statusUpdatedBy:actorUid
      });
      return;
    }
  }

  if(nextStage!=="delivered"){
    await updateDoc(ref,{
      status:"accepted",laundryStage:nextStage,statusUpdatedAt:serverTimestamp(),statusUpdatedBy:actorUid
    });
    return;
  }

  if(order.commissionLocked===true){
    await updateDoc(ref,{
      status:"done",
      laundryStage:"delivered",
      deliveredAt:serverTimestamp(),
      statusUpdatedAt:serverTimestamp(),
      statusUpdatedBy:actorUid
    });
    return;
  }

  // Legacy compatibility for orders already in flight before FB-LAUNCH01.
  const agreementRef=doc(db,"commissionAgreements",projectId);
  const ledgerRef=doc(db,"commissionLedger",getProjectCommissionLedgerId(orderId));

  await runTransaction(db,async transaction=>{
    const freshOrderSnap=await transaction.get(ref);
    const agreementSnap=await transaction.get(agreementRef);
    if(!freshOrderSnap.exists()||!agreementSnap.exists())throw new Error("ORDER_OR_AGREEMENT_NOT_FOUND");

    const fresh=freshOrderSnap.data();
    const commission=getEffectiveCommissionSnapshot(agreementSnap.data());

    if(!allowedLaundryNextStages(fresh).includes("delivered"))throw new Error("INVALID_LAUNDRY_TRANSITION");
    if(!commission)throw new Error("COMMISSION_AGREEMENT_NOT_ACTIVE");

    const earnedAt=serverTimestamp();

    transaction.update(ref,{
      status:"done",
      laundryStage:"delivered",
      deliveredAt:earnedAt,
      statusUpdatedAt:earnedAt,
      statusUpdatedBy:actorUid,
      commissionEligible:true,
      commissionLocked:true,
      commissionAmount:commission.amount,
      commissionAgreementVersion:commission.version,
      commissionTrigger:"legacy_delivery",
      commissionEarnedAt:earnedAt
    });

    transaction.set(ledgerRef,{
      userId:agreementSnap.data().ownerId,
      projectId,
      orderId,
      sourceType:"project_order",
      sourceId:orderId,
      agreementId:projectId,
      agreementVersion:commission.version,
      amount:commission.amount,
      currency:"EGP",
      status:"earned",
      trigger:"legacy_delivery",
      createdAt:earnedAt,
      earnedAt,
      paidAt:null
    });
  });
}
