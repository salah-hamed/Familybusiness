/**
 * A single per-user billing gate for all subscription payment submissions,
 * admin payment reviews and merchant-recovery transactions.
 *
 * IMPORTANT: legacy users start recoverySafe=false. The Admin must first
 * reconcile any PRE-release pending proofs; lack of a pending payment is NOT
 * evidence of a completed reconciliation.
 */
export function buildNewBillingGuard(uid,paymentId,at){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid||""))||
    !/^[A-Za-z0-9_-]{1,128}$/.test(String(paymentId||"")))
  throw new Error("BILLING_GUARD_INVALID_IDENTIFIERS");
 return {userId:uid,pendingPaymentId:paymentId,lastReviewedPaymentId:"",
  revision:1,recoverySafe:false,updatedAt:at};
}
export function buildSubmittedBillingGuard(guard,uid,paymentId,at){
 if(!guard||guard.userId!==uid||guard.pendingPaymentId!==""
    ||!Number.isSafeInteger(guard.revision)||guard.revision<1)
  throw new Error("BILLING_GUARD_PENDING_OR_MISSING");
 return {...guard,pendingPaymentId:paymentId,revision:guard.revision+1,
  updatedAt:at};
}
export function buildReviewedBillingGuard(guard,uid,paymentId,at){
 if(!guard||guard.userId!==uid||guard.pendingPaymentId!==paymentId
    ||!Number.isSafeInteger(guard.revision)||guard.revision<1)
  throw new Error("BILLING_GUARD_PAYMENT_CHANGED");
 return {...guard,pendingPaymentId:"",lastReviewedPaymentId:paymentId,
  revision:guard.revision+1,updatedAt:at};
}
export function assertTrustedRecoveryBillingGuard(guard,uid){
 if(!guard||guard.userId!==uid||guard.recoverySafe!==true
    ||guard.pendingPaymentId!==""||!Number.isSafeInteger(guard.revision)
    ||guard.revision<1)throw new Error("RECOVERY_BILLING_NOT_VERIFIED");
 return true;
}
