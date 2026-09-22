import db from "../firebase/firebase-db.js";

import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function getCommissionAgreementId(projectDocId) {
  return projectDocId;
}

export async function getCommissionAgreement(projectDocId) {
  const ref = doc(db, "commissionAgreements", getCommissionAgreementId(projectDocId));
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    agreementId: snap.id,
    ...snap.data()
  };
}

function normalizeCommissionAmount(amount) {
  const value = Number(amount);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("INVALID_COMMISSION_AMOUNT");
  }

  return Math.round(value * 100) / 100;
}

export async function proposeCommission({
  projectDocId,
  ownerId,
  operatorId,
  templateId,
  amount
}) {
  const proposedAmount = normalizeCommissionAmount(amount);
  const agreementRef = doc(
    db,
    "commissionAgreements",
    getCommissionAgreementId(projectDocId)
  );
  const operatorRef = doc(db, "operators", operatorId);

  await runTransaction(db, async (transaction) => {
    const agreementSnap = await transaction.get(agreementRef);
    const operatorSnap = await transaction.get(operatorRef);

    if (!operatorSnap.exists()) {
      throw new Error("OPERATOR_NOT_FOUND");
    }

    const operator = operatorSnap.data();

    if (
      operator.projectId !== projectDocId ||
      operator.ownerId !== ownerId ||
      operator.templateId !== templateId
    ) {
      throw new Error("OPERATOR_PROJECT_MISMATCH");
    }

    const existing = agreementSnap.exists() ? agreementSnap.data() : null;
    const currentAccepted =
      existing?.status === "accepted" && Number.isFinite(Number(existing.currentAmount))
        ? Number(existing.currentAmount)
        : null;

    const next = {
      agreementId: projectDocId,
      projectId: projectDocId,
      ownerId,
      operatorId,
      templateId,
      currency: "EGP",
      unit: "per_completed_order",
      currentAmount: currentAccepted,
      acceptedVersion: Number(existing?.acceptedVersion || 0),
      pendingAmount: proposedAmount,
      status: currentAccepted == null ? "pending" : "accepted",
      pendingStatus: "pending",
      proposedAt: serverTimestamp(),
      proposedBy: ownerId,
      acceptedAt: existing?.acceptedAt || null,
      acceptedBy: existing?.acceptedBy || "",
      rejectedAt: null,
      lastDecision: existing?.lastDecision || "",
      updatedAt: serverTimestamp(),
      version: Number(existing?.version || 0) + 1
    };

    if (!agreementSnap.exists()) {
      next.createdAt = serverTimestamp();
      transaction.set(agreementRef, next);
    } else {
      transaction.set(agreementRef, next, { merge: true });
    }

    transaction.update(operatorRef, {
      agreementStatus: currentAccepted == null ? "pending" : "accepted",
      updatedAt: serverTimestamp()
    });
  });

  return proposedAmount;
}

export async function acceptPendingCommission({
  projectDocId,
  operatorAuthUid
}) {
  const agreementRef = doc(
    db,
    "commissionAgreements",
    getCommissionAgreementId(projectDocId)
  );

  await runTransaction(db, async (transaction) => {
    const agreementSnap = await transaction.get(agreementRef);

    if (!agreementSnap.exists()) {
      throw new Error("AGREEMENT_NOT_FOUND");
    }

    const agreement = agreementSnap.data();
    const operatorRef = doc(db, "operators", agreement.operatorId);
    const operatorSnap = await transaction.get(operatorRef);

    if (!operatorSnap.exists()) {
      throw new Error("OPERATOR_NOT_FOUND");
    }

    const operator = operatorSnap.data();

    if (!operator.authUid || operator.authUid !== operatorAuthUid) {
      throw new Error("OPERATOR_NOT_AUTHORIZED");
    }

    if (agreement.pendingStatus !== "pending" || agreement.pendingAmount == null) {
      throw new Error("NO_PENDING_COMMISSION");
    }

    transaction.update(agreementRef, {
      currentAmount: agreement.pendingAmount,
      acceptedVersion: Number(agreement.version || 1),
      pendingAmount: null,
      status: "accepted",
      pendingStatus: "none",
      lastDecision: "accepted",
      acceptedAt: serverTimestamp(),
      acceptedBy: operatorAuthUid,
      rejectedAt: null,
      updatedAt: serverTimestamp()
    });

    transaction.update(operatorRef, {
      agreementStatus: "accepted",
      status: "active",
      isActive: true,
      updatedAt: serverTimestamp()
    });
  });
}

export async function rejectPendingCommission({
  projectDocId,
  operatorAuthUid
}) {
  const agreementRef = doc(
    db,
    "commissionAgreements",
    getCommissionAgreementId(projectDocId)
  );

  await runTransaction(db, async (transaction) => {
    const agreementSnap = await transaction.get(agreementRef);

    if (!agreementSnap.exists()) {
      throw new Error("AGREEMENT_NOT_FOUND");
    }

    const agreement = agreementSnap.data();
    const operatorRef = doc(db, "operators", agreement.operatorId);
    const operatorSnap = await transaction.get(operatorRef);

    if (!operatorSnap.exists()) {
      throw new Error("OPERATOR_NOT_FOUND");
    }

    const operator = operatorSnap.data();

    if (!operator.authUid || operator.authUid !== operatorAuthUid) {
      throw new Error("OPERATOR_NOT_AUTHORIZED");
    }

    if (agreement.pendingStatus !== "pending") {
      throw new Error("NO_PENDING_COMMISSION");
    }

    const hasAcceptedRate = agreement.currentAmount != null;

    transaction.update(agreementRef, {
      pendingAmount: null,
      status: hasAcceptedRate ? "accepted" : "rejected",
      pendingStatus: "none",
      lastDecision: "rejected",
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    transaction.update(operatorRef, {
      agreementStatus: hasAcceptedRate ? "accepted" : "rejected",
      status: hasAcceptedRate ? "active" : "pending_agreement",
      isActive: hasAcceptedRate,
      updatedAt: serverTimestamp()
    });
  });
}

export function getEffectiveCommissionAmount(agreement = {}) {
  if (
    agreement.status !== "accepted" ||
    agreement.currentAmount == null
  ) {
    return null;
  }

  return normalizeCommissionAmount(agreement.currentAmount);
}

export function buildProjectCommissionLedgerEntry({
  ownerId,
  projectId,
  orderId,
  agreementId,
  amount
}) {
  const lockedAmount = normalizeCommissionAmount(amount);

  return {
    userId: ownerId,
    projectId,
    orderId,
    sourceType: "project_order",
    sourceId: orderId,
    agreementId,
    amount: lockedAmount,
    currency: "EGP",
    status: "earned",
    paidAt: null
  };
}
