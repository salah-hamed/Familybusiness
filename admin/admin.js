import db from "../core/firebase/firebase-db.js";
import { protectAdmin } from "../core/auth/admin-guard.js";
import {
  PLATFORM_BILLING,
  REFERRAL_CONFIG,
  formatEgp
} from "../core/config/platform-config.js";

import {
  collection,
  getDocs,
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const usersContainer =
  document.getElementById("usersContainer");

const usersCount =
  document.getElementById("usersCount");

protectAdmin(async (session) => {

  if (!session.authorized) {
    usersCount.innerText = "غير مصرح بالدخول";
    usersContainer.innerHTML = `
      <div style="padding:20px;text-align:center;">
        <h3>⛔ غير مسموح لك بالدخول إلى لوحة الإدارة</h3>
        <p>هذه الصفحة متاحة لحسابات الإدارة فقط.</p>
      </div>
    `;
    return;
  }

  await loadUsers();

});

function hasPaidInitialActivation(data = {}) {
  return data.initialActivationPaid === true || Boolean(data.activatedAt);
}

function formatDate(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-EG");
}

async function activateOrRenewUser(uid) {

  await runTransaction(db, async (transaction) => {

    const userRef = doc(db, "users", uid);
    const userSnap = await transaction.get(userRef);

    if (!userSnap.exists()) {
      throw new Error("USER_NOT_FOUND");
    }

    const data = userSnap.data();
    const initialAlreadyPaid = hasPaidInitialActivation(data);
    const now = new Date();

    let referrerRef = null;
    let referrerSnap = null;
    let referralRef = null;
    let referralSnap = null;

    if (!initialAlreadyPaid && data.referredByUserId && data.referredByUserId !== uid) {
      referrerRef = doc(db, "users", data.referredByUserId);
      referralRef = doc(db, "referrals", `${data.referredByUserId}_${uid}`);

      referrerSnap = await transaction.get(referrerRef);
      referralSnap = await transaction.get(referralRef);
    }

    let periodStart = now;

    if (initialAlreadyPaid && data.subscriptionExpiresAt) {
      const existingExpiry =
        typeof data.subscriptionExpiresAt.toDate === "function"
          ? data.subscriptionExpiresAt.toDate()
          : new Date(data.subscriptionExpiresAt);

      if (!Number.isNaN(existingExpiry.getTime()) && existingExpiry > now) {
        periodStart = existingExpiry;
      }
    }

    const expiresAt = new Date(periodStart);
    expiresAt.setDate(expiresAt.getDate() + PLATFORM_BILLING.subscriptionDays);

    transaction.update(userRef, {
      isActive: true,
      subscriptionStatus: "active",
      initialActivationPaid: true,
      billingCycle: "monthly",
      subscriptionStartedAt: initialAlreadyPaid
        ? (data.subscriptionStartedAt || Timestamp.fromDate(now))
        : Timestamp.fromDate(now),
      subscriptionExpiresAt: Timestamp.fromDate(expiresAt),
      lastPaymentAmount: initialAlreadyPaid
        ? PLATFORM_BILLING.monthlyRenewalFee
        : PLATFORM_BILLING.initialActivationFee,
      lastPaymentType: initialAlreadyPaid ? "renewal" : "initial",
      lastPaymentAt: serverTimestamp(),
      lastRenewalAt: initialAlreadyPaid ? serverTimestamp() : (data.lastRenewalAt || null),
      activatedAt: data.activatedAt || serverTimestamp()
    });

    if (
      !initialAlreadyPaid &&
      referrerRef &&
      referrerSnap?.exists() &&
      referralRef &&
      !referralSnap?.exists()
    ) {
      const referralId = `${data.referredByUserId}_${uid}`;
      const ledgerRef = doc(db, "commissionLedger", `referral_${referralId}`);

      transaction.set(referralRef, {
        referrerUserId: data.referredByUserId,
        referredUserId: uid,
        status: "qualified",
        commissionAmount: REFERRAL_CONFIG.qualifiedReferralReward,
        currency: REFERRAL_CONFIG.currency,
        qualifiedAt: serverTimestamp(),
        paidAt: null
      });

      transaction.set(ledgerRef, {
        userId: data.referredByUserId,
        sourceType: "referral",
        sourceId: referralId,
        referredUserId: uid,
        amount: REFERRAL_CONFIG.qualifiedReferralReward,
        currency: REFERRAL_CONFIG.currency,
        status: "earned",
        createdAt: serverTimestamp(),
        paidAt: null
      });

      transaction.update(userRef, {
        referralQualified: true
      });
    }

  });

}

async function loadUsers() {

  const snapshot =
    await getDocs(collection(db, "users"));

  usersCount.innerText =
    `إجمالي المستخدمين: ${snapshot.size}`;

  usersContainer.innerHTML = "";

  snapshot.forEach((userDoc) => {

    const data = userDoc.data();
    const uid = userDoc.id;
    const initialAlreadyPaid = hasPaidInitialActivation(data);
    const nextAmount = initialAlreadyPaid
      ? PLATFORM_BILLING.monthlyRenewalFee
      : PLATFORM_BILLING.initialActivationFee;

    const card = document.createElement("div");

    card.style.border = "1px solid #ddd";
    card.style.padding = "14px";
    card.style.margin = "12px 0";
    card.style.borderRadius = "12px";

    card.innerHTML = `
      <p><b>${data.name || "بدون اسم"}</b></p>
      <p>${data.email || ""}</p>
      <p>الحالة: <b>${data.subscriptionStatus || "pending"}</b></p>
      <p>أول اشتراك: ${initialAlreadyPaid ? "تم" : "لم يتم"}</p>
      <p>انتهاء الاشتراك: ${formatDate(data.subscriptionExpiresAt)}</p>
      <p>الإحالة: ${data.referredByUserId ? "موجودة" : "لا يوجد"}</p>
      <p>المبلغ المطلوب عند التأكيد الحالي: <b>${formatEgp(nextAmount)}</b></p>

      <button id="activate-${uid}">
        ${initialAlreadyPaid
          ? `تأكيد تجديد ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)}`
          : `تفعيل أول مرة ${formatEgp(PLATFORM_BILLING.initialActivationFee)}`}
      </button>

      <button id="deactivate-${uid}" style="margin-right:8px;">
        إيقاف الاشتراك
      </button>
    `;

    usersContainer.appendChild(card);

    document
      .getElementById(`activate-${uid}`)
      .addEventListener("click", async () => {

        try {
          await activateOrRenewUser(uid);
          alert("تم تحديث الاشتراك بنجاح");
          await loadUsers();
        } catch (error) {
          console.error(error);
          alert("تعذر تحديث الاشتراك");
        }

      });

    document
      .getElementById(`deactivate-${uid}`)
      .addEventListener("click", async () => {

        await updateDoc(
          doc(db, "users", uid),
          {
            isActive: false,
            subscriptionStatus: "inactive"
          }
        );

        alert("تم إيقاف الاشتراك");
        await loadUsers();

      });

  });

}
