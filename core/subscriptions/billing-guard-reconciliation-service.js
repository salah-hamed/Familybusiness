import db from "../firebase/firebase-db.js";
import {doc,collection,getDocs,query,where,limit,runTransaction,serverTimestamp}
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
function check(uid,adminUid){
 if(!ID.test(String(uid||""))||!ID.test(String(adminUid||"")))
   throw new Error("BILLING_RECONCILIATION_IDENTIFIERS_REQUIRED");
}

/** Migrate one PRE-release pending payment into the new atomic review gate.
 * The Admin must review any other pre-release pending proofs before granting
 * recoverySafe=true. Never migrates straight into recoverySafe=true.
 */
export async function migrateLegacyPendingProof({paymentId,adminUid}={}){
 if(!ID.test(String(paymentId||"")))throw new Error("PAYMENT_ID_INVALID");
 const paymentRef=doc(db,"subscriptionPayments",paymentId);
 return runTransaction(db,async tx=>{
  const payment=await tx.get(paymentRef);
  if(!payment.exists()||payment.data().status!=="pending_review")
   throw new Error("LEGACY_PAYMENT_NOT_PENDING");
  const uid=payment.data().userId;
  check(uid,adminUid);
  const guardRef=doc(db,"subscriptionBillingGuards",uid);
  const guard=await tx.get(guardRef);
  if(guard.exists())throw new Error("BILLING_GUARD_ALREADY_EXISTS");
  const at=serverTimestamp();
  tx.set(guardRef,{
    userId:uid,pendingPaymentId:paymentId,lastReviewedPaymentId:"",
    revision:1,recoverySafe:false,updatedAt:at,
    migratedAt:at,migratedBy:adminUid
  });
  return uid;
 });
}

/**
 * Admin-only one-time reconciliation for OLD accounts; future proof
 * submissions and reviews are serializable through this guard document.
 * Abort on ANY pending historical proof. The admin is responsible for
 * verifying the snapshot of all previous payment references before invoking.
 */
export async function reconcileLegacyBillingAccount({uid,adminUid}={}){
 check(uid,adminUid);
 const pending=await getDocs(query(
  collection(db,"subscriptionPayments"),
  where("userId","==",uid),where("status","==","pending_review"),limit(1)
 ));
 if(!pending.empty)throw new Error("LEGACY_PENDING_PAYMENT_REVIEW_REQUIRED");
 const guardRef=doc(db,"subscriptionBillingGuards",uid);
 const userRef=doc(db,"users",uid);
 return runTransaction(db,async tx=>{
  const [guard,user]=await Promise.all([tx.get(guardRef),tx.get(userRef)]);
  if(!user.exists())throw new Error("BILLING_ACCOUNT_NOT_FOUND");
  const at=serverTimestamp();
  if(!guard.exists()){
   tx.set(guardRef,{
    userId:uid,pendingPaymentId:"",lastReviewedPaymentId:"",
    revision:1,recoverySafe:true,updatedAt:at,
    reconciledAt:at,reconciledBy:adminUid
   });
  }else{
   const g=guard.data();
   if(g.userId!==uid||g.pendingPaymentId!==""
     ||g.recoverySafe===true||!Number.isSafeInteger(g.revision))
    throw new Error("BILLING_RECONCILIATION_NOT_ALLOWED");
   tx.update(guardRef,{
    recoverySafe:true,revision:g.revision+1,updatedAt:at,
    reconciledAt:at,reconciledBy:adminUid
   });
  }
  return uid;
 });
}
