import db from "../firebase/firebase-db.js";
import { assessPlatformMerchantRecovery, MERCHANT_RECOVERY_REASON } from "./merchant-recovery-policy.js";
import { PLATFORM_MERCHANT_RECOVERY_ENABLED } from "./platform-recovery-rollout.js";

import {
  collection, doc, getDoc, getDocs, query, where, limit,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const REASONS=new Set(Object.values(MERCHANT_RECOVERY_REASON));

function guardParameters({projectDocId,adminUid,reason}) {
  if (!ID.test(String(projectDocId||"")) || !ID.test(String(adminUid||""))) {
    throw new Error("RECOVERY_INVALID_IDENTIFIERS");
  }
  if (!REASONS.has(reason)) throw new Error("RECOVERY_INVALID_REASON");
}

function dateMilliseconds(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return typeof value === "string" || typeof value === "number"
    ? new Date(value).getTime() : NaN;
}

export function recoveryEvidenceReference({reason,subscriber,violation}) {
  if (reason === MERCHANT_RECOVERY_REASON.CONFIRMED_VIOLATION) {
    return String(violation?.evidenceReference||"").trim();
  }
  const uid=String(subscriber?.uid||"");
  const date=reason === MERCHANT_RECOVERY_REASON.UNPAID_FIRST_MONTH
    ? subscriber?.firstMerchantLinkedAt : subscriber?.subscriptionExpiresAt;
  const instant=dateMilliseconds(date);
  if (!ID.test(uid) || !Number.isFinite(instant)) {
    throw new Error("RECOVERY_EVIDENCE_MISSING");
  }
  return `${reason}_${uid}_${instant}`;
}

/**
 * Admin decision (NOT a subscriber request). No former-subscriber veto.
 * The transaction switches only the operating allocation and creates a
 * permanent audit, without touching orders, workers, operator, ledger,
 * settlements, customer URLs or historic ownerId.
 *
 * Disabled until the completed Firebase Rules and indexes are published,
 * operator continuity tested, and first-expiry payment reconciliation secured.
 */
export async function executePlatformMerchantRecovery({projectDocId,adminUid,reason}) {
  if (!PLATFORM_MERCHANT_RECOVERY_ENABLED) {
    throw new Error("PLATFORM_MERCHANT_RECOVERY_DISABLED");
  }
  guardParameters({projectDocId,adminUid,reason});

  const projectRef=doc(db,"projects",projectDocId);
  const merchantSnap=await getDoc(projectRef);
  if (!merchantSnap.exists()) throw new Error("RECOVERY_PROJECT_NOT_FOUND");
  const allocatedUid=String(merchantSnap.data().assignedSubscriberId||"");
  if (!ID.test(allocatedUid)) throw new Error("RECOVERY_SUBSCRIBER_NOT_FOUND");

  // A pending payment proof is reviewed by the platform; its existence is
  // NOT a subscriber veto. Reject false claims before recovery. The live
  // cutover flag stays OFF until this check is migrated to a trusted, atomic
  // billing-state record for race-free automated recovery.
  const pending=await getDocs(query(
    collection(db,"subscriptionPayments"),
    where("userId","==",allocatedUid),
    where("status","==","pending_review"),
    limit(1)
  ));
  if (!pending.empty) throw new Error("RECOVERY_PAYMENT_REVIEW_REQUIRED");

  const ownerRef=doc(db,"users",allocatedUid);
  const operatorRef=doc(db,"operators",projectDocId);
  const agreementRef=doc(db,"commissionAgreements",projectDocId);
  const auditRef=doc(db,"merchantRecoveries",projectDocId);
  const violationRef=doc(db,"merchantViolations",projectDocId);

  await runTransaction(db,async transaction=>{
    const [existing,projectSnap,ownerSnap,operatorSnap,agreementSnap,violationSnap]=await Promise.all([
      transaction.get(auditRef),
      transaction.get(projectRef),
      transaction.get(ownerRef),
      transaction.get(operatorRef),
      transaction.get(agreementRef),
      ...(reason === MERCHANT_RECOVERY_REASON.CONFIRMED_VIOLATION
        ? [transaction.get(violationRef)] : [Promise.resolve(null)])
    ]);
    if (existing.exists()) throw new Error("RECOVERY_ALREADY_COMPLETED");
    if (!projectSnap.exists()||!ownerSnap.exists()||!operatorSnap.exists()||!agreementSnap.exists()) {
      throw new Error("RECOVERY_REQUIRED_DATA_MISSING");
    }
    const project=projectSnap.data();
    // Firebase users/{uid} need not store an explicit uid property.
    const subscriber={...ownerSnap.data(),uid:allocatedUid};
    const violation=violationSnap?.exists?.() ? violationSnap.data() : null;
    if (project.assignedSubscriberId !== allocatedUid
        || project.operatorId !== projectDocId
        || project.merchantId == null
        || !/^m_[0-9a-f]{32}$/.test(project.merchantId)
        || project.platformManaged !== false) {
      throw new Error("RECOVERY_STALE_PROJECT_OR_LEGACY");
    }

    const reviewed=assessPlatformMerchantRecovery({
      projectDocId,project,subscriber,
      operator:operatorSnap.data(),agreement:agreementSnap.data(),
      reason,violation,now:new Date(),
      hasUnreviewedRenewalPayment:false,
      hasUnreviewedFirstPayment:false
    });
    if (!reviewed.eligibleForRecovery) {
      throw new Error("RECOVERY_NOT_ELIGIBLE");
    }

    const evidenceReference=recoveryEvidenceReference({reason,subscriber,violation});
    if (evidenceReference.length < 8 || evidenceReference.length > 200) {
      throw new Error("RECOVERY_EVIDENCE_INVALID");
    }

    const at=serverTimestamp();
    transaction.update(projectRef,{
      platformManaged:true,
      assignmentStatus:"platform_managed",
      assignedSubscriberId:"",
      assignmentUpdatedAt:at,
      recoveryAuditId:projectDocId,
      recoveryAt:at,
      recoveryAdminUid:adminUid,
      recoveryReason:reason
    });
    transaction.set(auditRef,{
      recoveryId:projectDocId,
      projectDocId,
      merchantId:project.merchantId,
      originalSubscriberId:project.originalSubscriberId,
      previousSubscriberId:allocatedUid,
      reason,evidenceReference,
      status:"completed",
      adminUid,
      recoveredAt:at
    });
  });
  return projectDocId;
}
