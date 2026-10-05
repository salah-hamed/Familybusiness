import db from "../core/firebase/firebase-db.js";
import { protectAdmin } from "../core/auth/admin-guard.js";
import {
  PLATFORM_BILLING,
  REFERRAL_CONFIG,
  LAUNCH_PROMO,
  formatEgp
} from "../core/config/platform-config.js";
import { escapeHTML } from "../core/utils/helpers.js";
import { listRecentCommissionSettlements } from "../core/commissions/settlement-service.js";
import { getOrderOperationalAlert } from "../core/orders/operational-alerts.js";

import {
  collection,
  getDoc,
  getDocs,
  getCountFromServer,
  getAggregateFromServer,
  sum,
  count,
  query,
  where,
  orderBy,
  startAfter,
  limit,
  documentId,
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const PAGE_SIZE = 50;
const SEARCH_LIMIT = 50;
const ACTIVE_EXCEPTION_STATUSES = ["new","accepted","preparing","ready","assigned","out_for_delivery"];

let adminSession = null;
let searchTimer = null;

const state = {
  users: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" },
  subscriptionPayments: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "pending_review" },
  projects: { rows: [], cursor: null, hasMore: false, loading: false, search: "", template: "all" },
  operators: { rows: [], cursor: null, hasMore: false, loading: false, search: "" },
  orders: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" },
  exceptions: { rows: [], cursor: null, hasMore: false, loading: false, template: "all", level: "all" },
  commissions: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" },
  settlements: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" },
  reversals: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" }
};

const sectionLoaded = {
  usersSection: false,
  subscriptionPaymentsSection: false,
  projectsSection: false,
  operatorsSection: false,
  ordersSection: false,
  exceptionsSection: false,
  commissionsSection: false,
  settlementsSection: false,
  reversalsSection: false
};

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }
  ).format(date);
}

function money(value) {
  return formatEgp(Number(value || 0));
}

function hasPaidInitialActivation(data = {}) {
  return data.initialActivationPaid === true || Boolean(data.activatedAt);
}

function statusPill(status) {
  const value = clean(status) || "unknown";
  const label = ({
    active: "نشط",
    inactive: "موقوف",
    pending: "معلق",
    pending_review: "بانتظار المراجعة",
    approved: "معتمد",
    pending_invite: "دعوة معلقة",
    accepted: "مقبول",
    earned: "مستحق",
    paid: "مدفوع - نظام سابق",
    confirmed: "تم تأكيد الدفع",
    pending_owner_confirmation: "بانتظار تأكيد المشترك",
    rejected: "مرفوض",
    reversed: "تم عكس العمولة",
    new: "جديد",
    preparing: "جاري التحضير",
    ready: "جاهز",
    assigned: "تم تعيين مندوب",
    out_for_delivery: "خرج للتوصيل",
    pickup_assigned: "تم تعيين الاستلام",
    picked_up: "تم الاستلام",
    processing: "جاري التجهيز",
    ready_delivery: "جاهز للتوصيل",
    delivered: "تم التوصيل",
    done: "مكتمل",
    canceled: "ملغي"
  })[value] || value;

  return `<span class="pill ${escapeHTML(value)}">${escapeHTML(label)}</span>`;
}

function uniqueRows(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = row[key];
    if (id && !map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function mergeRows(target, rows, key) {
  return uniqueRows([...target, ...rows], key);
}

async function countDocs(collectionName, constraints = []) {
  const snap = await getCountFromServer(query(collection(db, collectionName), ...constraints));
  return Number(snap.data().count || 0);
}

async function aggregateAmount(collectionName, constraints = []) {
  const snap = await getAggregateFromServer(
    query(collection(db, collectionName), ...constraints),
    { totalAmount: sum("amount"), entryCount: count() }
  );

  return {
    totalAmount: Number(snap.data().totalAmount || 0),
    entryCount: Number(snap.data().entryCount || 0)
  };
}

async function loadOverview() {
  $("overviewStatus").innerText = "جاري تحديث المؤشرات...";

  try {
    const [
      totalUsers,
      activeUsers,
      pendingUsers,
      totalProjects,
      totalOperators,
      activeOperators,
      totalOrders,
      totalCommission,
      reversedCommission,
      confirmedPayments,
      legacyPayments,
      pendingPayments,
      pendingReversals,
      pendingSubscriptionPayments,
      launchPromoCounter
    ] = await Promise.all([
      countDocs("users"),
      countDocs("users", [where("subscriptionStatus", "==", "active")]),
      countDocs("users", [where("subscriptionStatus", "==", "pending")]),
      countDocs("projects"),
      countDocs("operators"),
      countDocs("operators", [where("isActive", "==", true)]),
      countDocs("orders"),
      aggregateAmount("commissionLedger"),
      aggregateAmount("commissionLedger", [where("status", "==", "reversed")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      aggregateAmount("commissionSettlements", [where("status", "==", "confirmed")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      aggregateAmount("commissionSettlements", [where("status", "==", "paid")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      countDocs("commissionSettlements", [where("status", "==", "pending_owner_confirmation")]).catch(() => null),
      countDocs("commissionReversals", [where("status", "==", "pending_owner_confirmation")]).catch(() => null),
      countDocs("subscriptionPayments", [where("status", "==", "pending_review")]).catch(() => null),
      getDoc(doc(db, "platformCounters", LAUNCH_PROMO.campaignId)).catch(() => null)
    ]);

    const netCommission = Math.max(0, totalCommission.totalAmount - reversedCommission.totalAmount);
    const confirmedPaid = confirmedPayments.totalAmount + legacyPayments.totalAmount;
    const outstanding = Math.max(0, netCommission - confirmedPaid);

    $("metricUsers").innerText = totalUsers.toLocaleString("ar-EG");
    $("metricUsersMeta").innerText = `${activeUsers} نشط · ${pendingUsers} بانتظار التفعيل`;
    $("metricPendingSubscriptionPayments").innerText = pendingSubscriptionPayments == null
      ? "—"
      : pendingSubscriptionPayments.toLocaleString("ar-EG");
    const launchPromoUsed = launchPromoCounter?.exists?.()
      ? Number(launchPromoCounter.data()?.count || 0)
      : 0;
    $("metricLaunchPromo").innerText = `${launchPromoUsed.toLocaleString("ar-EG")} / ${LAUNCH_PROMO.limit.toLocaleString("ar-EG")}`;
    $("metricProjects").innerText = totalProjects.toLocaleString("ar-EG");
    $("metricOperators").innerText = totalOperators.toLocaleString("ar-EG");
    $("metricOperatorsMeta").innerText = `${activeOperators} مشغّل نشط`;
    $("metricOrders").innerText = totalOrders.toLocaleString("ar-EG");
    $("metricOrdersMeta").innerText = "إجمالي الطلبات المسجلة";
    $("metricEarned").innerText = money(netCommission);
    $("metricPaid").innerText = money(confirmedPaid);
    $("metricOutstanding").innerText = money(outstanding);

    if (pendingPayments == null) {
      $("metricPendingSettlements").innerText = "—";
      $("metricPendingSettlementsMeta").innerText = "تحتاج نشر Firestore Rules الجديدة";
    } else {
      $("metricPendingSettlements").innerText = pendingPayments.toLocaleString("ar-EG");
      $("metricPendingSettlementsMeta").innerText = pendingPayments
        ? "دفعات تحتاج تأكيد المشترك"
        : "لا توجد دفعات معلقة";
    }

    if (pendingReversals == null) {
      $("metricPendingReversals").innerText = "—";
      $("metricPendingReversalsMeta").innerText = "تحتاج نشر Firestore Rules الجديدة";
    } else {
      $("metricPendingReversals").innerText = pendingReversals.toLocaleString("ar-EG");
      $("metricPendingReversalsMeta").innerText = pendingReversals
        ? "طلبات تنتظر قرار المشترك"
        : "لا توجد طلبات عكس معلقة";
    }

    $("billingSummary").innerText =
      `${formatEgp(PLATFORM_BILLING.initialActivationFee)} أول مرة · ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} شهري · إحالة ${formatEgp(REFERRAL_CONFIG.qualifiedReferralReward)}`;

    $("overviewStatus").innerText =
      `آخر تحديث: ${new Intl.DateTimeFormat("ar-EG",{timeStyle:"short"}).format(new Date())}`;
  } catch (error) {
    console.error(error);
    $("overviewStatus").innerText = `تعذر تحميل بعض المؤشرات: ${error.message}`;
  }
}

async function exactUserSearch(term) {
  const q = clean(term);
  if (!q) return [];

  const jobs = [
    getDoc(doc(db, "users", q)).then(snap => snap.exists() ? [{ uid: snap.id, ...snap.data() }] : []),
    getDocs(query(collection(db, "users"), where("email", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ uid: item.id, ...item.data() }))),
    getDocs(query(collection(db, "users"), where("name", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ uid: item.id, ...item.data() })))
  ];

  return uniqueRows((await Promise.all(jobs)).flat(), "uid");
}

async function loadUsers({ append = false } = {}) {
  const s = state.users;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreUsersBtn").disabled = true;
  $("usersMessage").innerText = s.search ? "جاري البحث المباشر..." : "جاري تحميل المستخدمين...";

  try {
    const total = await countDocs(
      "users",
      s.status === "all" ? [] : [where("subscriptionStatus", "==", s.status)]
    );

    if (s.search) {
      let rows = await exactUserSearch(s.search);
      if (s.status !== "all") rows = rows.filter(row => row.subscriptionStatus === s.status);
      s.rows = rows;
      s.cursor = null;
      s.hasMore = false;
    } else {
      const constraints = [];
      if (s.status !== "all") constraints.push(where("subscriptionStatus", "==", s.status));
      constraints.push(orderBy(documentId()));
      if (append && s.cursor) constraints.push(startAfter(s.cursor));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(query(collection(db, "users"), ...constraints));
      const rows = snap.docs.map(item => ({ uid: item.id, ...item.data() }));
      s.rows = append ? mergeRows(s.rows, rows, "uid") : rows;
      s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      s.hasMore = snap.docs.length === PAGE_SIZE;
    }

    renderUsers();
    $("usersCount").innerText = `الإجمالي: ${total.toLocaleString("ar-EG")}`;
    $("usersMessage").innerText = s.search
      ? `نتائج البحث المباشر: ${s.rows.length}`
      : `المعروض الآن: ${s.rows.length} من ${total}`;
    $("loadMoreUsersBtn").classList.toggle("hidden", !s.hasMore || Boolean(s.search));
    sectionLoaded.usersSection = true;
  } catch (error) {
    console.error(error);
    $("usersMessage").innerText = `تعذر تحميل المستخدمين: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreUsersBtn").disabled = false;
  }
}

function renderUsers() {
  const rows = state.users.rows;
  $("usersContainer").innerHTML = rows.length ? rows.map(user => {
    const initialAlreadyPaid = hasPaidInitialActivation(user);
    const nextAmount = initialAlreadyPaid
      ? PLATFORM_BILLING.monthlyRenewalFee
      : PLATFORM_BILLING.initialActivationFee;

    return `
      <article class="adminCard">
        <div class="cardHead">
          <div><h3>${escapeHTML(user.name || "بدون اسم")}</h3><p>${escapeHTML(user.email || "")}</p></div>
          ${statusPill(user.subscriptionStatus || "pending")}
        </div>
        <div class="metaGrid">
          <span>UID<br><b class="codeText">${escapeHTML(user.uid)}</b></span>
          <span>أول اشتراك<br><b>${initialAlreadyPaid ? "تم" : "لم يتم"}</b></span>
          <span>انتهاء الاشتراك<br><b>${formatDate(user.subscriptionExpiresAt)}</b></span>
          <span>المطلوب الآن<br><b>${formatEgp(nextAmount)}</b></span>
          <span>إحالة<br><b>${escapeHTML(user.referredByUserId || "لا يوجد")}</b></span>
          <span>آخر دفعة اشتراك<br><b>${money(user.lastPaymentAmount || 0)}</b></span>
        </div>
        <div class="actions">
          <button class="primaryBtn" data-action="view-user-payments" data-uid="${escapeHTML(user.uid)}">راجع دفعات الاشتراك</button>
          ${!initialAlreadyPaid && user.subscriptionStatus !== "active"
            ? `<button class="secondaryBtn" data-action="grant-launch-promo" data-uid="${escapeHTML(user.uid)}">🎁 منحة مجانية من رصيد Launch 50</button>`
            : ""}
          ${user.subscriptionStatus === "active"
            ? `<button class="secondaryBtn" data-action="deactivate-user" data-uid="${escapeHTML(user.uid)}">إيقاف الاشتراك</button>`
            : ""}
        </div>
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد نتائج مطابقة.</div>';
}

async function grantLaunchPromo(uid) {
  if (!adminSession?.user?.uid) throw new Error("ADMIN_SESSION_REQUIRED");

  const grantId = `${LAUNCH_PROMO.campaignId}_${uid}`;

  await runTransaction(db, async transaction => {
    const userRef = doc(db, "users", uid);
    const grantRef = doc(db, "subscriptionGrants", grantId);
    const counterRef = doc(db, "platformCounters", LAUNCH_PROMO.campaignId);

    const [userSnap, grantSnap, counterSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(grantRef),
      transaction.get(counterRef)
    ]);

    if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");
    if (grantSnap.exists()) throw new Error("PROMO_ALREADY_GRANTED");

    const userData = userSnap.data();
    if (hasPaidInitialActivation(userData) || userData.subscriptionStatus === "active") {
      throw new Error("PROMO_NOT_ELIGIBLE");
    }

    const used = counterSnap.exists() ? Number(counterSnap.data()?.count || 0) : 0;
    if (used >= LAUNCH_PROMO.limit) throw new Error("PROMO_FULL");

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + LAUNCH_PROMO.subscriptionDays);

    transaction.set(grantRef, {
      grantId,
      userId: uid,
      campaignId: LAUNCH_PROMO.campaignId,
      status: "granted",
      paymentRequired: false,
      value: PLATFORM_BILLING.initialActivationFee,
      currency: PLATFORM_BILLING.currency,
      subscriptionDays: LAUNCH_PROMO.subscriptionDays,
      grantedAt: serverTimestamp(),
      grantedBy: adminSession.user.uid
    });

    const counterData = {
      campaignId: LAUNCH_PROMO.campaignId,
      count: used + 1,
      limit: LAUNCH_PROMO.limit,
      lastGrantedUserId: uid,
      updatedAt: serverTimestamp()
    };

    if (counterSnap.exists()) transaction.update(counterRef, counterData);
    else transaction.set(counterRef, counterData);

    transaction.update(userRef, {
      isActive: true,
      subscriptionStatus: "active",
      initialActivationPaid: false,
      billingCycle: "monthly",
      subscriptionStartedAt: Timestamp.fromDate(now),
      subscriptionExpiresAt: Timestamp.fromDate(expiresAt),
      activatedAt: serverTimestamp(),
      lastActivationSource: "launch_promo",
      lastSubscriptionGrantId: grantId,
      launchPromoCampaignId: LAUNCH_PROMO.campaignId
    });
  });
}

async function approveSubscriptionPayment(paymentId) {
  if (!adminSession?.user?.uid) throw new Error("ADMIN_SESSION_REQUIRED");

  await runTransaction(db, async transaction => {
    const paymentRef = doc(db, "subscriptionPayments", paymentId);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists()) throw new Error("PAYMENT_NOT_FOUND");

    const payment = paymentSnap.data();
    if (payment.status !== "pending_review") throw new Error("PAYMENT_ALREADY_REVIEWED");

    const claimRef = doc(db, "paymentReferenceClaims", clean(payment.paymentReference));
    const claimSnap = await transaction.get(claimRef);
    if (
      !claimSnap.exists()
      || claimSnap.data().paymentId !== paymentId
      || claimSnap.data().userId !== payment.userId
      || claimSnap.data().status !== "pending_review"
    ) {
      throw new Error("PAYMENT_REFERENCE_CLAIM_MISMATCH");
    }

    const uid = clean(payment.userId);
    const userRef = doc(db, "users", uid);
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");

    const data = userSnap.data();
    const initialAlreadyPaid = hasPaidInitialActivation(data);
    const expectedType = initialAlreadyPaid ? "renewal" : "initial";
    const expectedAmount = initialAlreadyPaid
      ? PLATFORM_BILLING.monthlyRenewalFee
      : PLATFORM_BILLING.initialActivationFee;

    if (payment.paymentType !== expectedType || Number(payment.amount) !== Number(expectedAmount)) {
      throw new Error("PAYMENT_DOES_NOT_MATCH_ACCOUNT_STATE");
    }

    const now = new Date();
    const referrerId = /^[A-Za-z0-9_-]{1,128}$/.test(clean(data.referredByUserId))
      ? clean(data.referredByUserId)
      : "";

    let referrerRef = null;
    let referrerSnap = null;
    let referralRef = null;
    let referralSnap = null;

    if (!initialAlreadyPaid && referrerId && referrerId !== uid) {
      referrerRef = doc(db, "users", referrerId);
      referralRef = doc(db, "referrals", `${referrerId}_${uid}`);
      referrerSnap = await transaction.get(referrerRef);
      referralSnap = await transaction.get(referralRef);
    }

    let periodStart = now;
    if (initialAlreadyPaid && data.subscriptionExpiresAt) {
      const currentExpiry = typeof data.subscriptionExpiresAt.toDate === "function"
        ? data.subscriptionExpiresAt.toDate()
        : new Date(data.subscriptionExpiresAt);
      if (!Number.isNaN(currentExpiry.getTime()) && currentExpiry > now) {
        periodStart = currentExpiry;
      }
    }

    const expiresAt = new Date(periodStart);
    expiresAt.setDate(expiresAt.getDate() + PLATFORM_BILLING.subscriptionDays);

    transaction.update(paymentRef, {
      status: "approved",
      reviewedAt: serverTimestamp(),
      reviewedBy: adminSession.user.uid,
      rejectionReason: ""
    });

    transaction.update(claimRef, {
      status: "approved",
      reviewedAt: serverTimestamp(),
      reviewedBy: adminSession.user.uid
    });

    transaction.update(userRef, {
      isActive: true,
      subscriptionStatus: "active",
      initialActivationPaid: true,
      billingCycle: "monthly",
      subscriptionStartedAt: initialAlreadyPaid
        ? (data.subscriptionStartedAt || Timestamp.fromDate(now))
        : Timestamp.fromDate(now),
      subscriptionExpiresAt: Timestamp.fromDate(expiresAt),
      lastPaymentAmount: expectedAmount,
      lastPaymentType: expectedType,
      lastPaymentAt: serverTimestamp(),
      lastSubscriptionPaymentId: paymentId,
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
      const referralId = `${referrerId}_${uid}`;
      const ledgerRef = doc(db, "commissionLedger", `referral_${referralId}`);

      transaction.set(referralRef, {
        referrerUserId: referrerId,
        referredUserId: uid,
        status: "qualified",
        commissionAmount: REFERRAL_CONFIG.qualifiedReferralReward,
        currency: REFERRAL_CONFIG.currency,
        qualifiedAt: serverTimestamp(),
        paidAt: null
      });

      transaction.set(ledgerRef, {
        userId: referrerId,
        sourceType: "referral",
        sourceId: referralId,
        referredUserId: uid,
        amount: REFERRAL_CONFIG.qualifiedReferralReward,
        currency: REFERRAL_CONFIG.currency,
        status: "earned",
        createdAt: serverTimestamp(),
        paidAt: null
      });

      transaction.update(userRef, { referralQualified: true });
    }
  });
}

async function rejectSubscriptionPayment(paymentId, reason) {
  if (!adminSession?.user?.uid) throw new Error("ADMIN_SESSION_REQUIRED");
  const cleanReason = clean(reason);
  if (cleanReason.length < 3 || cleanReason.length > 300) {
    throw new Error("REJECTION_REASON_REQUIRED");
  }

  await runTransaction(db, async transaction => {
    const paymentRef = doc(db, "subscriptionPayments", paymentId);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists()) throw new Error("PAYMENT_NOT_FOUND");
    const payment = paymentSnap.data();
    if (payment.status !== "pending_review") throw new Error("PAYMENT_ALREADY_REVIEWED");

    const claimRef = doc(db, "paymentReferenceClaims", clean(payment.paymentReference));
    const claimSnap = await transaction.get(claimRef);
    if (
      !claimSnap.exists()
      || claimSnap.data().paymentId !== paymentId
      || claimSnap.data().userId !== payment.userId
      || claimSnap.data().status !== "pending_review"
    ) {
      throw new Error("PAYMENT_REFERENCE_CLAIM_MISMATCH");
    }

    transaction.update(paymentRef, {
      status: "rejected",
      reviewedAt: serverTimestamp(),
      reviewedBy: adminSession.user.uid,
      rejectionReason: cleanReason
    });
    transaction.update(claimRef, {
      status: "rejected",
      reviewedAt: serverTimestamp(),
      reviewedBy: adminSession.user.uid
    });
  });
}

async function searchSubscriptionPayments(term) {
  const q = clean(term);
  if (!q) return [];

  const jobs = [
    getDoc(doc(db, "subscriptionPayments", q))
      .then(snap => snap.exists() ? [{ paymentId: snap.id, ...snap.data() }] : []),
    getDocs(query(collection(db, "subscriptionPayments"), where("userId", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ paymentId: item.id, ...item.data() }))),
    getDocs(query(collection(db, "subscriptionPayments"), where("paymentReference", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ paymentId: item.id, ...item.data() })))
  ];

  return uniqueRows((await Promise.all(jobs)).flat(), "paymentId");
}

async function loadSubscriptionPayments({ append = false } = {}) {
  const s = state.subscriptionPayments;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreSubscriptionPaymentsBtn").disabled = true;
  $("subscriptionPaymentsMessage").innerText = s.search
    ? "جاري البحث المباشر..."
    : "جاري تحميل دفعات الاشتراك...";

  try {
    if (s.search) {
      let rows = await searchSubscriptionPayments(s.search);
      if (s.status !== "all") rows = rows.filter(row => row.status === s.status);
      s.rows = rows;
      s.cursor = null;
      s.hasMore = false;
    } else {
      const constraints = [];
      if (s.status !== "all") constraints.push(where("status", "==", s.status));
      constraints.push(orderBy("submittedAt", s.status === "all" ? "desc" : "asc"));
      if (append && s.cursor) constraints.push(startAfter(s.cursor));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(query(collection(db, "subscriptionPayments"), ...constraints));
      const rows = snap.docs.map(item => ({ paymentId: item.id, ...item.data() }));
      s.rows = append ? mergeRows(s.rows, rows, "paymentId") : rows;
      s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      s.hasMore = snap.docs.length === PAGE_SIZE;
    }

    renderSubscriptionPayments();
    $("subscriptionPaymentsMessage").innerText = s.search
      ? `نتائج البحث المباشر: ${s.rows.length}`
      : `المعروض الآن: ${s.rows.length} دفعة`;
    $("loadMoreSubscriptionPaymentsBtn").classList.toggle("hidden", !s.hasMore || Boolean(s.search));
    sectionLoaded.subscriptionPaymentsSection = true;
  } catch (error) {
    console.error(error);
    $("subscriptionPaymentsMessage").innerText = String(error?.code || "").includes("failed-precondition")
      ? "قائمة مراجعة الاشتراكات تحتاج نشر Firestore Index النهائي قبل استخدامها Live."
      : "تعذر تحميل دفعات الاشتراك.";
  } finally {
    s.loading = false;
    $("loadMoreSubscriptionPaymentsBtn").disabled = false;
  }
}

function renderSubscriptionPayments() {
  const rows = state.subscriptionPayments.rows;
  $("subscriptionPaymentsContainer").innerHTML = rows.length ? rows.map(payment => {
    const pending = payment.status === "pending_review";
    return `
      <article class="adminCard">
        <div class="cardHead">
          <div>
            <h3>${escapeHTML(payment.userEmail || payment.userId || "مستخدم")}</h3>
            <p class="codeText">${escapeHTML(payment.paymentId)}</p>
          </div>
          ${statusPill(payment.status || "pending_review")}
        </div>
        <div class="metaGrid">
          <span>User UID<br><b class="codeText">${escapeHTML(payment.userId || "—")}</b></span>
          <span>النوع<br><b>${payment.paymentType === "renewal" ? "تجديد" : "أول تفعيل"}</b></span>
          <span>المبلغ<br><b>${money(payment.amount)}</b></span>
          <span>طريقة الدفع<br><b>InstaPay</b></span>
          <span>مرجع التحويل<br><b class="codeText">${escapeHTML(payment.paymentReference || "—")}</b></span>
          <span>كود الدفع<br><b class="codeText">${escapeHTML(payment.paymentCode || "—")}</b></span>
          <span>الإثبات<br><b>${payment.proofChannel === "whatsapp" ? "WhatsApp" : escapeHTML(payment.proofChannel || "—")}</b></span>
          <span>تاريخ الإرسال<br><b>${formatDate(payment.submittedAt,true)}</b></span>
          <span>المراجع<br><b>${escapeHTML(payment.reviewedBy || "—")}</b></span>
          <span>سبب الرفض<br><b>${escapeHTML(payment.rejectionReason || "—")}</b></span>
        </div>
        <div class="actions">
          <button class="secondaryBtn" data-action="copy-payment-code" data-code="${escapeHTML(payment.paymentCode || "")}">نسخ كود الدفع</button>
          ${pending ? `
            <button class="primaryBtn" data-action="approve-subscription-payment" data-payment="${escapeHTML(payment.paymentId)}">اعتماد وتفعيل</button>
            <button class="dangerBtn" data-action="reject-subscription-payment" data-payment="${escapeHTML(payment.paymentId)}">رفض الإثبات</button>
          ` : ""}
        </div>
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد دفعات مطابقة.</div>';
}

async function searchProjects(term) {
  const q = clean(term);
  if (!q) return [];

  const jobs = [
    getDoc(doc(db, "projects", q)).then(snap => snap.exists() ? [{ projectDocId: snap.id, ...snap.data() }] : []),
    getDocs(query(collection(db, "projects"), where("ownerId", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ projectDocId: item.id, ...item.data() }))),
    getDocs(query(collection(db, "projects"), where("businessName", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ projectDocId: item.id, ...item.data() })))
  ];

  return uniqueRows((await Promise.all(jobs)).flat(), "projectDocId");
}

async function loadProjects({ append = false } = {}) {
  const s = state.projects;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreProjectsBtn").disabled = true;
  $("projectsMessage").innerText = s.search ? "جاري البحث المباشر..." : "جاري تحميل المشاريع...";

  try {
    if (s.search) {
      let rows = await searchProjects(s.search);
      if (s.template !== "all") rows = rows.filter(row => row.template === s.template);
      s.rows = rows;
      s.cursor = null;
      s.hasMore = false;
    } else {
      const constraints = [];
      if (s.template !== "all") constraints.push(where("template", "==", s.template));
      constraints.push(orderBy(documentId()));
      if (append && s.cursor) constraints.push(startAfter(s.cursor));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(query(collection(db, "projects"), ...constraints));
      const rows = snap.docs.map(item => ({ projectDocId: item.id, ...item.data() }));
      s.rows = append ? mergeRows(s.rows, rows, "projectDocId") : rows;
      s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      s.hasMore = snap.docs.length === PAGE_SIZE;
    }

    renderProjects();
    $("projectsMessage").innerText = s.search
      ? `نتائج البحث: ${s.rows.length}`
      : `المعروض الآن: ${s.rows.length} مشروع. القوائم تُحمّل على دفعات حتى لا تتوه مع نمو المنصة.`;
    $("loadMoreProjectsBtn").classList.toggle("hidden", !s.hasMore || Boolean(s.search));
    sectionLoaded.projectsSection = true;
  } catch (error) {
    console.error(error);
    $("projectsMessage").innerText = `تعذر تحميل المشاريع: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreProjectsBtn").disabled = false;
  }
}

function renderProjects() {
  const rows = state.projects.rows;
  $("projectsContainer").innerHTML = rows.length ? rows.map(project => {
    const active = project.isActive === true && project.status === "active";

    return `
      <article class="adminCard">
        <div class="cardHead">
          <div><h3>${escapeHTML(project.businessName || project.template || "مشروع")}</h3>
          <p class="codeText">${escapeHTML(project.projectDocId)}</p></div>
          ${statusPill(active ? "active" : "inactive")}
        </div>
        <div class="metaGrid">
          <span>النوع<br><b>${escapeHTML(project.template || "—")}</b></span>
          <span>المالك<br><b class="codeText">${escapeHTML(project.ownerId || "—")}</b></span>
          <span>نموذج التشغيل<br><b>${escapeHTML(project.operatingModel || "—")}</b></span>
          <span>المشغّل<br><b class="codeText">${escapeHTML(project.operatorId || "—")}</b></span>
          <span>حالة الربط<br><b>${escapeHTML(project.partnerSetupStatus || "—")}</b></span>
          <span>الإصدار<br><b>${escapeHTML(String(project.templateVersion || "—"))}</b></span>
        </div>
        <div class="actions">
          <button class="${active ? "secondaryBtn" : "primaryBtn"}"
            data-action="toggle-project"
            data-project="${escapeHTML(project.projectDocId)}"
            data-active="${active}">
            ${active ? "إيقاف المشروع" : "إعادة تفعيل المشروع"}
          </button>
          <button class="secondaryBtn" data-action="view-project-payments" data-project="${escapeHTML(project.projectDocId)}">
            عرض حساب المشروع
          </button>
        </div>
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد مشاريع مطابقة.</div>';
}

async function searchOperators(term) {
  const q = clean(term);
  if (!q) return [];

  const jobs = [
    getDoc(doc(db, "operators", q)).then(snap => snap.exists() ? [{ operatorId: snap.id, ...snap.data() }] : []),
    getDocs(query(collection(db, "operators"), where("phone", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ operatorId: item.id, ...item.data() }))),
    getDocs(query(collection(db, "operators"), where("whatsapp", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ operatorId: item.id, ...item.data() }))),
    getDocs(query(collection(db, "operators"), where("authLoginEmail", "==", q), limit(SEARCH_LIMIT)))
      .then(snap => snap.docs.map(item => ({ operatorId: item.id, ...item.data() })))
  ];

  return uniqueRows((await Promise.all(jobs)).flat(), "operatorId");
}

async function loadOperators({ append = false } = {}) {
  const s = state.operators;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreOperatorsBtn").disabled = true;
  $("operatorsMessage").innerText = s.search ? "جاري البحث المباشر..." : "جاري تحميل المشغّلين...";

  try {
    if (s.search) {
      s.rows = await searchOperators(s.search);
      s.cursor = null;
      s.hasMore = false;
    } else {
      const constraints = [orderBy(documentId())];
      if (append && s.cursor) constraints.push(startAfter(s.cursor));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(query(collection(db, "operators"), ...constraints));
      const rows = snap.docs.map(item => ({ operatorId: item.id, ...item.data() }));
      s.rows = append ? mergeRows(s.rows, rows, "operatorId") : rows;
      s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      s.hasMore = snap.docs.length === PAGE_SIZE;
    }

    renderOperators();
    $("operatorsMessage").innerText = s.search
      ? `نتائج البحث: ${s.rows.length}`
      : `المعروض الآن: ${s.rows.length} مشغّل.`;
    $("loadMoreOperatorsBtn").classList.toggle("hidden", !s.hasMore || Boolean(s.search));
    sectionLoaded.operatorsSection = true;
  } catch (error) {
    console.error(error);
    $("operatorsMessage").innerText = `تعذر تحميل المشغّلين: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreOperatorsBtn").disabled = false;
  }
}

function renderOperators() {
  const rows = state.operators.rows;
  $("operatorsContainer").innerHTML = rows.length ? rows.map(operator => {
    const active = operator.isActive === true && operator.status === "active";
    const canReactivate = Boolean(operator.authUid) && operator.agreementStatus === "accepted";

    return `
      <article class="adminCard">
        <div class="cardHead">
          <div><h3>${escapeHTML(operator.name || operator.contactName || "مشغّل")}</h3>
          <p class="codeText">${escapeHTML(operator.projectId || operator.operatorId)}</p></div>
          ${statusPill(active ? "active" : operator.status || "inactive")}
        </div>
        <div class="metaGrid">
          <span>القالب<br><b>${escapeHTML(operator.templateId || "—")}</b></span>
          <span>الهاتف<br><b>${escapeHTML(operator.phone || "—")}</b></span>
          <span>واتساب<br><b>${escapeHTML(operator.whatsapp || "—")}</b></span>
          <span>الاتفاق<br><b>${escapeHTML(operator.agreementStatus || "—")}</b></span>
          <span>Auth UID<br><b class="codeText">${escapeHTML(operator.authUid || "غير مفعّل")}</b></span>
          <span>بريد الدعوة<br><b>${escapeHTML(operator.authLoginEmail || "—")}</b></span>
        </div>
        <div class="actions">
          ${active
            ? `<button class="secondaryBtn" data-action="toggle-operator" data-operator="${escapeHTML(operator.operatorId)}" data-active="true">إيقاف التشغيل</button>`
            : canReactivate
              ? `<button class="primaryBtn" data-action="toggle-operator" data-operator="${escapeHTML(operator.operatorId)}" data-active="false">إعادة التفعيل</button>`
              : '<span class="smallMuted">إعادة التفعيل متاحة بعد تفعيل الدعوة وقبول الاتفاق.</span>'}
        </div>
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد نتائج مطابقة.</div>';
}

async function loadAdminOrders({ append = false } = {}) {
  const s = state.orders;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreOrdersBtn").disabled = true;
  $("ordersAdminMessage").innerText = s.search ? "جاري البحث المباشر..." : "جاري تحميل الطلبات...";

  try {
    if (s.search) {
      const exact = await getDoc(doc(db, "orders", s.search));
      const byProject = await getDocs(query(
        collection(db, "orders"),
        where("projectId", "==", s.search),
        orderBy("createdAt", "desc"),
        limit(SEARCH_LIMIT)
      ));

      let rows = [
        ...(exact.exists() ? [{ orderId: exact.id, ...exact.data() }] : []),
        ...byProject.docs.map(item => ({ orderId: item.id, ...item.data() }))
      ];
      rows = uniqueRows(rows, "orderId");
      if (s.status !== "all") {
        rows = rows.filter(row => row.status === s.status || row.laundryStage === s.status);
      }

      s.rows = rows;
      s.cursor = null;
      s.hasMore = false;
    } else {
      const constraints = [];
      if (s.status !== "all") constraints.push(where("status", "==", s.status));
      constraints.push(orderBy("createdAt", "desc"));
      if (append && s.cursor) constraints.push(startAfter(s.cursor));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(query(collection(db, "orders"), ...constraints));
      const rows = snap.docs.map(item => ({ orderId: item.id, ...item.data() }));
      s.rows = append ? mergeRows(s.rows, rows, "orderId") : rows;
      s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      s.hasMore = snap.docs.length === PAGE_SIZE;
    }

    renderAdminOrders();
    $("ordersAdminMessage").innerText = s.search
      ? `نتائج البحث: ${s.rows.length}`
      : `المعروض الآن: ${s.rows.length} طلب.`;
    $("loadMoreOrdersBtn").classList.toggle("hidden", !s.hasMore || Boolean(s.search));
    sectionLoaded.ordersSection = true;
  } catch (error) {
    console.error(error);
    $("ordersAdminMessage").innerText = `تعذر تحميل الطلبات: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreOrdersBtn").disabled = false;
  }
}

function renderAdminOrders() {
  const rows = state.orders.rows;
  $("ordersTableBody").innerHTML = rows.length ? rows.map(order => `
    <tr>
      <td><b>#${escapeHTML(order.orderId.slice(0,8))}</b><br><small>${formatDate(order.createdAt,true)}</small></td>
      <td>${escapeHTML(order.templateType || "—")}<br><small class="codeText">${escapeHTML(order.projectId || "—")}</small></td>
      <td>${escapeHTML(order.customerName || "—")}<br><small>${escapeHTML(order.customerPhone || "")}</small></td>
      <td>${statusPill(order.status || order.laundryStage || "—")}<br><small>${escapeHTML(order.laundryStage || "")}</small></td>
      <td><b>${money(order.total ?? order.price ?? 0)}</b></td>
      <td>${order.commissionLocked
        ? `<b>${money(order.commissionAmount)}</b><br><small>${escapeHTML(order.commissionTrigger || "legacy")}</small>`
        : "—"}</td>
    </tr>
  `).join("") : '<tr><td colspan="6">لا توجد طلبات مطابقة.</td></tr>';
}


function visibleOperationalExceptions() {
  const s = state.exceptions;
  return [...s.rows]
    .filter(row => s.template === "all" || row.templateType === s.template)
    .filter(row => s.level === "all" || row.operationalAlert?.level === s.level)
    .sort((a, b) => {
      const levelDelta = (b.operationalAlert?.level === "critical" ? 1 : 0)
        - (a.operationalAlert?.level === "critical" ? 1 : 0);
      if (levelDelta) return levelDelta;
      return Number(b.operationalAlert?.ageMinutes || 0) - Number(a.operationalAlert?.ageMinutes || 0);
    });
}

function updateOperationalExceptionsMessage() {
  const visible = visibleOperationalExceptions().length;
  const loaded = state.exceptions.rows.length;
  $("exceptionsMessage").innerText = loaded
    ? `المعروض ${visible} تنبيه من ${loaded} طلب متأخر محمّل. القائمة مرتبة حسب شدة التأخير.`
    : "لا توجد طلبات متأخرة في الدفعة المحمّلة.";
}

async function loadOperationalExceptions({ append = false } = {}) {
  const s = state.exceptions;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreExceptionsBtn").disabled = true;
  $("exceptionsMessage").innerText = "جاري فحص أقدم الطلبات المفتوحة...";

  try {
    const cutoff = Timestamp.fromMillis(Date.now() - 15 * 60 * 1000);
    const constraints = [
      where("status", "in", ACTIVE_EXCEPTION_STATUSES),
      where("createdAt", "<=", cutoff),
      orderBy("createdAt", "asc")
    ];

    if (append && s.cursor) constraints.push(startAfter(s.cursor));
    constraints.push(limit(PAGE_SIZE));

    const snap = await getDocs(query(collection(db, "orders"), ...constraints));
    const rows = snap.docs
      .map(item => ({ orderId: item.id, ...item.data() }))
      .map(order => {
        const operationalAlert = getOrderOperationalAlert(order);
        return operationalAlert ? { ...order, operationalAlert } : null;
      })
      .filter(Boolean);

    s.rows = append ? mergeRows(s.rows, rows, "orderId") : rows;
    s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
    s.hasMore = snap.docs.length === PAGE_SIZE;

    renderOperationalExceptions();
    updateOperationalExceptionsMessage();
    $("loadMoreExceptionsBtn").classList.toggle("hidden", !s.hasMore);
    sectionLoaded.exceptionsSection = true;
  } catch (error) {
    console.error(error);
    const code = String(error?.code || "").toLowerCase();
    $("exceptionsMessage").innerText = code.includes("failed-precondition") && String(error?.message || "").toLowerCase().includes("index")
      ? "تنبيهات التشغيل تحتاج نشر Firestore Index النهائي قبل استخدامها Live. باقي لوحة الإدارة تعمل بشكل طبيعي."
      : `تعذر تحميل تنبيهات التشغيل: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreExceptionsBtn").disabled = false;
  }
}

function renderOperationalExceptions() {
  const rows = visibleOperationalExceptions();
  $("exceptionsTableBody").innerHTML = rows.length ? rows.map(order => {
    const alert = order.operationalAlert;
    const severity = alert.level === "critical" ? "متأخر جدًا" : "متأخر";
    const severityClass = alert.level === "critical" ? "exceptionCritical" : "exceptionWarning";

    return `
      <tr>
        <td><span class="pill ${severityClass}">${severity}</span><br><small>${escapeHTML(alert.message)}</small></td>
        <td><b>#${escapeHTML(order.orderId.slice(0,8))}</b><br><small>${formatDate(order.createdAt,true)}</small></td>
        <td>${escapeHTML(order.templateType || "—")}<br><small class="codeText">${escapeHTML(order.projectId || "—")}</small></td>
        <td>${escapeHTML(order.customerName || "—")}<br><small>${escapeHTML(order.customerPhone || "")}</small></td>
        <td>${statusPill(order.status || "—")}<br><small>${escapeHTML(order.laundryStage || "")}</small></td>
        <td>
          <small>آخر تحديث: ${formatDate(order.statusUpdatedAt || order.createdAt,true)}</small><br>
          <button class="secondaryBtn" type="button" data-action="open-exception-order" data-order="${escapeHTML(order.orderId)}">فتح الطلب</button>
        </td>
      </tr>
    `;
  }).join("") : '<tr><td colspan="6">لا توجد تنبيهات مطابقة للفلاتر الحالية.</td></tr>';
}

async function loadCommissions({ append = false } = {}) {
  const s = state.commissions;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreCommissionsBtn").disabled = true;
  $("commissionsMessage").innerText = s.search ? "جاري البحث المباشر..." : "جاري تحميل دفتر العمولات...";

  try {
    if (s.search) {
      const exact = await getDoc(doc(db, "commissionLedger", s.search));
      const [byProject, byUser] = await Promise.all([
        getDocs(query(
          collection(db, "commissionLedger"),
          where("projectId", "==", s.search),
          orderBy("createdAt", "desc"),
          limit(SEARCH_LIMIT)
        )),
        getDocs(query(
          collection(db, "commissionLedger"),
          where("userId", "==", s.search),
          orderBy("createdAt", "desc"),
          limit(SEARCH_LIMIT)
        ))
      ]);

      let rows = [
        ...(exact.exists() ? [{ entryId: exact.id, ...exact.data() }] : []),
        ...byProject.docs.map(item => ({ entryId: item.id, ...item.data() })),
        ...byUser.docs.map(item => ({ entryId: item.id, ...item.data() }))
      ];

      rows = uniqueRows(rows, "entryId");
      if (s.status !== "all") rows = rows.filter(row => row.status === s.status);
      s.rows = rows;
      s.cursor = null;
      s.hasMore = false;
    } else {
      const constraints = [];
      if (s.status !== "all") constraints.push(where("status", "==", s.status));
      constraints.push(orderBy("createdAt", "desc"));
      if (append && s.cursor) constraints.push(startAfter(s.cursor));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(query(collection(db, "commissionLedger"), ...constraints));
      const rows = snap.docs.map(item => ({ entryId: item.id, ...item.data() }));
      s.rows = append ? mergeRows(s.rows, rows, "entryId") : rows;
      s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      s.hasMore = snap.docs.length === PAGE_SIZE;
    }

    renderCommissions();
    $("commissionsMessage").innerText = s.search
      ? `نتائج البحث: ${s.rows.length}`
      : `المعروض الآن: ${s.rows.length} قيد.`;
    $("loadMoreCommissionsBtn").classList.toggle("hidden", !s.hasMore || Boolean(s.search));
    sectionLoaded.commissionsSection = true;
  } catch (error) {
    console.error(error);
    $("commissionsMessage").innerText = `تعذر تحميل العمولات: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreCommissionsBtn").disabled = false;
  }
}

function renderCommissions() {
  const rows = state.commissions.rows;
  $("commissionsTableBody").innerHTML = rows.length ? rows.map(entry => `
    <tr>
      <td><b class="codeText">${escapeHTML(entry.entryId)}</b><br><small>${formatDate(entry.createdAt || entry.earnedAt,true)}</small></td>
      <td>${escapeHTML(entry.sourceType || "—")}<br><small class="codeText">${escapeHTML(entry.projectId || entry.sourceId || "—")}</small></td>
      <td><span class="codeText">${escapeHTML(entry.userId || "—")}</span></td>
      <td><b>${money(entry.amount)}</b></td>
      <td>${statusPill(entry.status || "earned")}</td>
      <td>${entry.settlementId ? escapeHTML(entry.settlementId) : "الدفع يُسجل منفصلًا"}</td>
    </tr>
  `).join("") : '<tr><td colspan="6">لا توجد قيود عمولة.</td></tr>';
}

async function loadSettlements() {
  const s = state.settlements;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreSettlementsBtn").disabled = true;
  $("settlementsMessage").innerText = s.search ? "جاري البحث المباشر..." : "جاري تحميل عمليات الدفع...";

  try {
    if (s.search) {
      const snap = await getDocs(query(
        collection(db, "commissionSettlements"),
        where("projectId", "==", s.search),
        orderBy("createdAt", "desc"),
        limit(SEARCH_LIMIT)
      ));

      let rows = snap.docs.map(item => ({ settlementId: item.id, ...item.data() }));
      if (s.status !== "all") rows = rows.filter(row => row.status === s.status);
      s.rows = rows;
      s.cursor = null;
      s.hasMore = false;
    } else {
      s.rows = await listRecentCommissionSettlements({
        status: s.status,
        pageSize: PAGE_SIZE
      });
      s.cursor = null;
      s.hasMore = false;
    }

    renderSettlements();
    $("settlementsMessage").innerText = s.search
      ? `نتائج البحث: ${s.rows.length}`
      : `آخر ${s.rows.length} عملية دفع — للمتابعة فقط.`;
    $("loadMoreSettlementsBtn").classList.add("hidden");
    sectionLoaded.settlementsSection = true;
  } catch (error) {
    console.error(error);
    const code = String(error?.code || "").toLowerCase();
    $("settlementsMessage").innerText = code.includes("permission-denied")
      ? "عمليات الدفع الجديدة تحتاج نشر Firestore Rules النهائية. باقي لوحة الإدارة تعمل بشكل طبيعي."
      : `تعذر تحميل عمليات الدفع: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreSettlementsBtn").disabled = false;
  }
}

function renderSettlements() {
  const rows = state.settlements.rows;
  $("settlementsContainer").innerHTML = rows.length ? rows.map(item => `
    <article class="adminCard settlementCard ${escapeHTML(item.status || "")}">
      <div class="cardHead">
        <div>
          <h3>${escapeHTML(item.businessName || item.templateId || "عملية دفع")}</h3>
          <p class="codeText">${escapeHTML(item.settlementId)}</p>
        </div>
        ${statusPill(item.status)}
      </div>
      <div class="metaGrid">
        <span>المشروع<br><b class="codeText">${escapeHTML(item.projectId || "—")}</b></span>
        <span>المبلغ<br><b>${money(item.amount)}</b></span>
        <span>طريقة الدفع<br><b>${escapeHTML(item.paymentMethod || "—")}</b></span>
        <span>مرجع الدفع<br><b>${escapeHTML(item.paymentReference || "—")}</b></span>
        <span>سجلها المشغّل<br><b>${formatDate(item.declaredAt || item.createdAt,true)}</b></span>
        <span>تأكيد المشترك<br><b>${formatDate(item.confirmedAt,true)}</b></span>
        <span>المشغّل UID<br><b class="codeText">${escapeHTML(item.declaredBy || "—")}</b></span>
        <span>المشترك UID<br><b class="codeText">${escapeHTML(item.ownerId || "—")}</b></span>
      </div>
      <p class="smallMuted">لو العملية معلقة، الإجراء المطلوب بين المشغّل والمشترك فقط. الإدارة تراقب ولا تؤكد نيابة عن أي طرف.</p>
    </article>
  `).join("") : '<div class="emptyState">لا توجد عمليات دفع مطابقة.</div>';
}


async function loadReversals({ append = false } = {}) {
  const s = state.reversals;
  if (s.loading) return;
  s.loading = true;
  $("loadMoreReversalsBtn").disabled = true;
  $("reversalsMessage").innerText = s.search ? "جاري البحث المباشر..." : "جاري تحميل طلبات عكس العمولات...";

  try {
    const constraints = [];

    if (s.search) {
      constraints.push(where("projectId", "==", s.search));
      constraints.push(orderBy("createdAt", "desc"));
      constraints.push(limit(SEARCH_LIMIT));

      const snap = await getDocs(query(collection(db, "commissionReversals"), ...constraints));
      let rows = snap.docs.map(item => ({ reversalId: item.id, ...item.data() }));

      if (s.status !== "all") {
        rows = rows.filter(row => row.status === s.status);
      }

      s.rows = rows;
      s.cursor = null;
      s.hasMore = false;
    } else {
      if (s.status !== "all") constraints.push(where("status", "==", s.status));
      constraints.push(orderBy("createdAt", "desc"));
      if (append && s.cursor) constraints.push(startAfter(s.cursor));
      constraints.push(limit(PAGE_SIZE));

      const snap = await getDocs(query(collection(db, "commissionReversals"), ...constraints));
      const rows = snap.docs.map(item => ({ reversalId: item.id, ...item.data() }));

      s.rows = append ? mergeRows(s.rows, rows, "reversalId") : rows;
      s.cursor = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      s.hasMore = snap.docs.length === PAGE_SIZE;
    }

    renderReversals();
    $("reversalsMessage").innerText = s.search
      ? `نتائج البحث: ${s.rows.length}`
      : `المعروض الآن: ${s.rows.length} طلب عكس — للمتابعة فقط.`;
    $("loadMoreReversalsBtn").classList.toggle("hidden", !s.hasMore || Boolean(s.search));
    sectionLoaded.reversalsSection = true;
  } catch (error) {
    console.error(error);
    const code = String(error?.code || "").toLowerCase();
    $("reversalsMessage").innerText = code.includes("permission-denied")
      ? "طلبات عكس العمولات تحتاج نشر Firestore Rules النهائية. باقي لوحة الإدارة تعمل بشكل طبيعي."
      : `تعذر تحميل طلبات العكس: ${error.message}`;
  } finally {
    s.loading = false;
    $("loadMoreReversalsBtn").disabled = false;
  }
}

function reversalReasonLabel(reason) {
  return ({
    customer_canceled_after_dispatch: "العميل ألغى بعد الإرسال",
    delivery_failed: "تعذر التوصيل",
    duplicate_order: "طلب مكرر",
    operator_error: "خطأ تشغيلي",
    other: "سبب آخر"
  })[reason] || reason || "—";
}

function renderReversals() {
  const rows = state.reversals.rows;

  $("reversalsContainer").innerHTML = rows.length ? rows.map(item => `
    <article class="adminCard settlementCard ${escapeHTML(item.status || "")}">
      <div class="cardHead">
        <div>
          <h3>طلب #${escapeHTML(String(item.orderId || "").slice(0, 8))}</h3>
          <p class="codeText">${escapeHTML(item.reversalId)}</p>
        </div>
        ${statusPill(item.status)}
      </div>
      <div class="metaGrid">
        <span>المشروع<br><b class="codeText">${escapeHTML(item.projectId || "—")}</b></span>
        <span>قيمة العمولة<br><b>${money(item.amount)}</b></span>
        <span>السبب<br><b>${escapeHTML(reversalReasonLabel(item.reasonCode))}</b></span>
        <span>المشغّل UID<br><b class="codeText">${escapeHTML(item.requestedBy || "—")}</b></span>
        <span>المشترك UID<br><b class="codeText">${escapeHTML(item.ownerId || "—")}</b></span>
        <span>تاريخ الطلب<br><b>${formatDate(item.requestedAt || item.createdAt,true)}</b></span>
        <span>تاريخ التأكيد<br><b>${formatDate(item.confirmedAt,true)}</b></span>
        <span>تاريخ الرفض<br><b>${formatDate(item.rejectedAt,true)}</b></span>
      </div>
      ${item.note ? `<p class="smallMuted">ملاحظة: ${escapeHTML(item.note)}</p>` : ""}
      <p class="smallMuted">الإدارة تراقب فقط؛ قرار عكس العمولة بين المشغّل والمشترك.</p>
    </article>
  `).join("") : '<div class="emptyState">لا توجد طلبات عكس مطابقة.</div>';
}

async function ensureSectionLoaded(sectionId) {
  if (sectionLoaded[sectionId]) return;
  if (sectionId === "usersSection") await loadUsers();
  if (sectionId === "subscriptionPaymentsSection") await loadSubscriptionPayments();
  if (sectionId === "projectsSection") await loadProjects();
  if (sectionId === "operatorsSection") await loadOperators();
  if (sectionId === "ordersSection") await loadAdminOrders();
  if (sectionId === "exceptionsSection") await loadOperationalExceptions();
  if (sectionId === "commissionsSection") await loadCommissions();
  if (sectionId === "settlementsSection") await loadSettlements();
  if (sectionId === "reversalsSection") await loadReversals();
}

function switchSection(sectionId) {
  document.querySelectorAll(".adminSection").forEach(section =>
    section.classList.toggle("activeSection", section.id === sectionId)
  );
  document.querySelectorAll(".tabBtn").forEach(button =>
    button.classList.toggle("active", button.dataset.section === sectionId)
  );
  ensureSectionLoaded(sectionId);
}

async function refreshLoadedSections() {
  await loadOverview();
  const jobs = [];
  if (sectionLoaded.usersSection) jobs.push(loadUsers());
  if (sectionLoaded.subscriptionPaymentsSection) jobs.push(loadSubscriptionPayments());
  if (sectionLoaded.projectsSection) jobs.push(loadProjects());
  if (sectionLoaded.operatorsSection) jobs.push(loadOperators());
  if (sectionLoaded.ordersSection) jobs.push(loadAdminOrders());
  if (sectionLoaded.exceptionsSection) jobs.push(loadOperationalExceptions());
  if (sectionLoaded.commissionsSection) jobs.push(loadCommissions());
  if (sectionLoaded.settlementsSection) jobs.push(loadSettlements());
  if (sectionLoaded.reversalsSection) jobs.push(loadReversals());
  await Promise.all(jobs);
}

function debounceSearch(fn) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(fn, 350);
}

document.querySelectorAll(".tabBtn").forEach(button => {
  button.addEventListener("click", () => switchSection(button.dataset.section));
});

$("refreshAllBtn").addEventListener("click", refreshLoadedSections);
$("refreshSubscriptionPaymentsBtn").addEventListener("click", () => loadSubscriptionPayments());
$("refreshProjectsBtn").addEventListener("click", () => loadProjects());
$("refreshOperatorsBtn").addEventListener("click", () => loadOperators());
$("refreshOrdersAdminBtn").addEventListener("click", () => loadAdminOrders());
$("refreshExceptionsBtn").addEventListener("click", () => loadOperationalExceptions());
$("refreshCommissionsBtn").addEventListener("click", () => loadCommissions());
$("refreshSettlementsBtn").addEventListener("click", () => loadSettlements());
$("refreshReversalsBtn").addEventListener("click", () => loadReversals());

$("usersSearch").addEventListener("input", event => {
  state.users.search = clean(event.target.value);
  state.users.cursor = null;
  debounceSearch(() => loadUsers());
});
$("usersStatusFilter").addEventListener("change", event => {
  state.users.status = event.target.value;
  state.users.cursor = null;
  loadUsers();
});
$("loadMoreUsersBtn").addEventListener("click", () => loadUsers({ append: true }));

$("subscriptionPaymentsSearch").addEventListener("input", event => {
  state.subscriptionPayments.search = clean(event.target.value);
  state.subscriptionPayments.cursor = null;
  debounceSearch(() => loadSubscriptionPayments());
});
$("subscriptionPaymentsStatusFilter").addEventListener("change", event => {
  state.subscriptionPayments.status = event.target.value;
  state.subscriptionPayments.cursor = null;
  loadSubscriptionPayments();
});
$("loadMoreSubscriptionPaymentsBtn").addEventListener("click", () => loadSubscriptionPayments({ append: true }));

$("subscriptionPaymentsContainer").addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  if (button.dataset.action === "copy-payment-code") {
    try {
      await navigator.clipboard.writeText(button.dataset.code || "");
      $("subscriptionPaymentsMessage").innerText = "تم نسخ كود الدفع. ابحث به في محادثات واتساب للمراجعة.";
    } catch {
      $("subscriptionPaymentsMessage").innerText = "تعذر نسخ الكود تلقائيًا. انسخه من البطاقة.";
    }
    return;
  }

  const paymentId = button.dataset.payment;
  if (!paymentId) return;
  button.disabled = true;

  try {
    if (button.dataset.action === "approve-subscription-payment") {
      const confirmed = confirm("اعتماد هذه الدفعة سيُفعّل/يُجدد الاشتراك فورًا. هل طابقت كود الدفع ومرجع InstaPay مع Screenshot المرسل على واتساب؟");
      if (!confirmed) return;
      await approveSubscriptionPayment(paymentId);
      $("subscriptionPaymentsMessage").innerText = "تم اعتماد الدفعة وتحديث الاشتراك بنجاح ✅";
    } else if (button.dataset.action === "reject-subscription-payment") {
      const reason = prompt("اكتب سبب الرفض ليظهر للمشترك:");
      if (reason === null) return;
      await rejectSubscriptionPayment(paymentId, reason);
      $("subscriptionPaymentsMessage").innerText = "تم رفض الإثبات بدون تغيير حالة الاشتراك.";
    }

    await Promise.all([loadSubscriptionPayments(), loadUsers(), loadOverview()]);
  } catch (error) {
    console.error(error);
    const message = String(error?.message || "");
    $("subscriptionPaymentsMessage").innerText =
      message === "REJECTION_REASON_REQUIRED"
        ? "سبب الرفض يجب أن يكون واضحًا من 3 إلى 300 حرف."
        : message === "PAYMENT_DOES_NOT_MATCH_ACCOUNT_STATE"
          ? "الدفعة لا تطابق حالة الاشتراك الحالية. راجع نوع الدفعة والمبلغ."
          : message === "PAYMENT_ALREADY_REVIEWED"
            ? "تمت مراجعة هذه الدفعة بالفعل. حدّث القائمة."
            : message === "PAYMENT_REFERENCE_CLAIM_MISMATCH"
              ? "مرجع التحويل لا يملك سجل حماية مطابقًا. لا تعتمد الدفعة وتحقق منها يدويًا."
              : "تعذر تنفيذ مراجعة الدفعة. حدّث البيانات وحاول مرة أخرى.";
  } finally {
    button.disabled = false;
  }
});

$("projectsSearch").addEventListener("input", event => {
  state.projects.search = clean(event.target.value);
  state.projects.cursor = null;
  debounceSearch(() => loadProjects());
});
$("projectsTemplateFilter").addEventListener("change", event => {
  state.projects.template = event.target.value;
  state.projects.cursor = null;
  loadProjects();
});
$("loadMoreProjectsBtn").addEventListener("click", () => loadProjects({ append: true }));

$("operatorsSearch").addEventListener("input", event => {
  state.operators.search = clean(event.target.value);
  state.operators.cursor = null;
  debounceSearch(() => loadOperators());
});
$("loadMoreOperatorsBtn").addEventListener("click", () => loadOperators({ append: true }));

$("ordersSearch").addEventListener("input", event => {
  state.orders.search = clean(event.target.value);
  state.orders.cursor = null;
  debounceSearch(() => loadAdminOrders());
});
$("ordersStatusFilter").addEventListener("change", event => {
  state.orders.status = event.target.value;
  state.orders.cursor = null;
  loadAdminOrders();
});
$("loadMoreOrdersBtn").addEventListener("click", () => loadAdminOrders({ append: true }));

$("exceptionsTemplateFilter").addEventListener("change", event => {
  state.exceptions.template = event.target.value;
  renderOperationalExceptions();
  updateOperationalExceptionsMessage();
});
$("exceptionsLevelFilter").addEventListener("change", event => {
  state.exceptions.level = event.target.value;
  renderOperationalExceptions();
  updateOperationalExceptionsMessage();
});
$("loadMoreExceptionsBtn").addEventListener("click", () => loadOperationalExceptions({ append: true }));
$("exceptionsTableBody").addEventListener("click", async event => {
  const button = event.target.closest("[data-action=\"open-exception-order\"][data-order]");
  if (!button) return;
  state.orders.search = button.dataset.order;
  state.orders.cursor = null;
  $("ordersSearch").value = button.dataset.order;
  switchSection("ordersSection");
  await loadAdminOrders();
});

$("commissionsSearch").addEventListener("input", event => {
  state.commissions.search = clean(event.target.value);
  state.commissions.cursor = null;
  debounceSearch(() => loadCommissions());
});
$("commissionsStatusFilter").addEventListener("change", event => {
  state.commissions.status = event.target.value;
  state.commissions.cursor = null;
  loadCommissions();
});
$("loadMoreCommissionsBtn").addEventListener("click", () => loadCommissions({ append: true }));

$("settlementsSearch").addEventListener("input", event => {
  state.settlements.search = clean(event.target.value);
  debounceSearch(() => loadSettlements());
});
$("settlementsStatusFilter").addEventListener("change", event => {
  state.settlements.status = event.target.value;
  loadSettlements();
});

$("reversalsSearch").addEventListener("input", event => {
  state.reversals.search = clean(event.target.value);
  state.reversals.cursor = null;
  debounceSearch(() => loadReversals());
});
$("reversalsStatusFilter").addEventListener("change", event => {
  state.reversals.status = event.target.value;
  state.reversals.cursor = null;
  loadReversals();
});
$("loadMoreReversalsBtn").addEventListener("click", () => loadReversals({ append: true }));

$("usersContainer").addEventListener("click", async event => {
  const button = event.target.closest("[data-action][data-uid]");
  if (!button) return;

  if (button.dataset.action === "view-user-payments") {
    state.subscriptionPayments.search = button.dataset.uid;
    state.subscriptionPayments.status = "all";
    state.subscriptionPayments.cursor = null;
    $("subscriptionPaymentsSearch").value = button.dataset.uid;
    $("subscriptionPaymentsStatusFilter").value = "all";
    switchSection("subscriptionPaymentsSection");
    await loadSubscriptionPayments();
    return;
  }

  if (button.dataset.action === "grant-launch-promo") {
    const confirmed = confirm(`منح هذا المستخدم اشتراكًا مجانيًا لمدة ${LAUNCH_PROMO.subscriptionDays} يوم من رصيد ${LAUNCH_PROMO.limit} منحة؟ يمكنك توزيع المنح في أي وقت وعلى المستخدمين الذين تختارهم. هذا التفعيل لا يُحسب كدفعة مدفوعة ولا يؤهل عمولة إحالة.`);
    if (!confirmed) return;

    button.disabled = true;
    try {
      await grantLaunchPromo(button.dataset.uid);
      $("usersMessage").innerText = "تم تفعيل اشتراك Launch 50 المجاني ✅";
      await Promise.all([loadUsers(), loadOverview()]);
    } catch (error) {
      console.error(error);
      const code = String(error?.message || "");
      $("usersMessage").innerText =
        code === "PROMO_FULL"
          ? "تم استخدام كل منح Launch 50 المجانية المتاحة."
          : code === "PROMO_ALREADY_GRANTED"
            ? "هذا المستخدم حصل على العرض بالفعل."
            : code === "PROMO_NOT_ELIGIBLE"
              ? "هذا المستخدم لم يعد مؤهلًا لأول تفعيل مجاني."
              : "تعذر تفعيل العرض المجاني. حدّث البيانات وحاول مرة أخرى.";
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action !== "deactivate-user") return;
  button.disabled = true;

  try {
    await updateDoc(doc(db, "users", button.dataset.uid), {
      isActive: false,
      subscriptionStatus: "inactive"
    });
    $("usersMessage").innerText = "تم إيقاف الاشتراك.";
    await Promise.all([loadUsers(), loadOverview()]);
  } catch (error) {
    console.error(error);
    $("usersMessage").innerText = "تعذر إيقاف الاشتراك. حاول مرة أخرى.";
  } finally {
    button.disabled = false;
  }
});

$("projectsContainer").addEventListener("click", async event => {
  const button = event.target.closest("[data-action][data-project]");
  if (!button) return;

  const projectId = button.dataset.project;

  if (button.dataset.action === "view-project-payments") {
    state.settlements.search = projectId;
    $("settlementsSearch").value = projectId;
    switchSection("settlementsSection");
    await loadSettlements();
    return;
  }

  if (button.dataset.action === "toggle-project") {
    button.disabled = true;
    try {
      const active = button.dataset.active === "true";
      await updateDoc(doc(db, "projects", projectId), {
        isActive: !active,
        status: active ? "inactive" : "active"
      });
      $("projectsMessage").innerText = active ? "تم إيقاف المشروع." : "تم إعادة تفعيل المشروع.";
      await Promise.all([loadProjects(), loadOverview()]);
    } catch (error) {
      console.error(error);
      $("projectsMessage").innerText = `تعذر تحديث المشروع: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }
});

$("operatorsContainer").addEventListener("click", async event => {
  const button = event.target.closest("[data-action='toggle-operator']");
  if (!button) return;
  button.disabled = true;

  try {
    const active = button.dataset.active === "true";
    await updateDoc(doc(db, "operators", button.dataset.operator), {
      isActive: !active,
      status: active ? "inactive" : "active",
      updatedAt: serverTimestamp()
    });
    $("operatorsMessage").innerText = active ? "تم إيقاف المشغّل." : "تم إعادة تفعيل المشغّل.";
    await Promise.all([loadOperators(), loadOverview()]);
  } catch (error) {
    console.error(error);
    $("operatorsMessage").innerText = `تعذر تحديث المشغّل: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

protectAdmin(async session => {
  adminSession = session;

  if (!session.authorized) {
    $("accessDenied").classList.remove("hidden");
    $("adminIdentity").innerText = "غير مصرح";
    return;
  }

  $("adminApp").classList.remove("hidden");
  $("adminIdentity").innerText = session.userData?.name
    ? `${session.userData.name} · Admin`
    : `${session.user.email || "Admin"}`;

  await Promise.all([loadOverview(), loadUsers()]);
});
