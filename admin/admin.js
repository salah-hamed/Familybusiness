import db from "../core/firebase/firebase-db.js";
import { buildReviewedBillingGuard } from "../core/subscriptions/subscription-billing-guard.js";
import { migrateLegacyPendingProof, reconcileLegacyBillingAccount } from "../core/subscriptions/billing-guard-reconciliation-service.js";
import { projectMerchantOverview } from "../core/merchants/merchant-overview.js";
import { assessMerchantCutoverReadiness, formatMerchantCutoverReadiness } from "../core/merchants/merchant-cutover-readiness.js";
import { assessMerchantTransfer, formatMerchantTransferPreflight } from "../core/merchants/merchant-transfer-preflight.js";
import { PLATFORM_MERCHANT_RECOVERY_ENABLED } from "../core/merchants/platform-recovery-rollout.js";
import { MERCHANT_TRANSFER_CASES_ENABLED } from "../core/merchants/transfer-case-rollout.js";
import { MERCHANT_CUTOVER_ENABLED } from "../core/merchants/merchant-cutover-rollout.js";
import { executeMerchantCutover } from "../core/merchants/merchant-cutover-service.js";
import { PLATFORM_COMMISSION_BENEFICIARY } from "../core/merchants/merchant-commission-beneficiary.js";
import { openMerchantTransferCase, reviewMerchantTransferFinance } from "../core/merchants/transfer-case-service.js";
import { merchantTransferConsentLink } from "../core/merchants/transfer-consent-view.js";
import { executePlatformMerchantRecovery } from "../core/merchants/platform-recovery-service.js";
import { MERCHANT_REPEAT_RECOVERY_ENABLED,MERCHANT_REPEAT_ASSIGNMENT_ENABLED }
  from "../core/merchants/merchant-cycle-rollout.js";
import { executeRepeatMerchantRecovery,executeRepeatMerchantAssignment }
  from "../core/merchants/merchant-cycle-service.js";
import { openRepeatMerchantTransferCase,reviewRepeatMerchantFinances }
  from "../core/merchants/merchant-cycle-consent-service.js";
import { requiredSubscriptionPayment } from "../core/subscriptions/payment-policy.js";
import { TRIAL_REGISTRATION_ENABLED } from "../core/subscriptions/trial-rollout.js?v=20261016-free-trial1";
import { getProjectPaymentSummary } from "../core/commissions/settlement-service.js";
import { protectAdmin } from "../core/auth/admin-guard.js";
import {
  PLATFORM_BILLING,
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
  settlements: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" }
};

const sectionLoaded = {
  usersSection: false,
  subscriptionPaymentsSection: false,
  projectsSection: false,
  operatorsSection: false,
  ordersSection: false,
  exceptionsSection: false,
  commissionsSection: false,
  settlementsSection: false
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
    trial: "فترة التجهيز المجانية",
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
      trialUsers,
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
      pendingSubscriptionPayments
    ] = await Promise.all([
      countDocs("users"),
      countDocs("users", [where("subscriptionStatus", "==", "active")]),
      countDocs("users", [where("subscriptionStatus", "==", "trial")]),
      countDocs("users", [where("subscriptionStatus", "==", "pending")]),
      countDocs("projects"),
      countDocs("operators"),
      countDocs("operators", [where("isActive", "==", true)]),
      countDocs("orders"),
      aggregateAmount("commissionLedger", [where("sourceType", "==", "project_order")]),
      aggregateAmount("commissionLedger", [where("sourceType", "==", "project_order"), where("status", "==", "reversed")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      aggregateAmount("commissionSettlements", [where("status", "==", "confirmed")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      aggregateAmount("commissionSettlements", [where("status", "==", "paid")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      countDocs("commissionSettlements", [where("status", "==", "pending_owner_confirmation")]).catch(() => null),
      countDocs("subscriptionPayments", [where("status", "==", "pending_review")]).catch(() => null)
    ]);

    const netCommission = Math.max(0, totalCommission.totalAmount - reversedCommission.totalAmount);
    const confirmedPaid = confirmedPayments.totalAmount + legacyPayments.totalAmount;
    const outstanding = Math.max(0, netCommission - confirmedPaid);

    $("metricUsers").innerText = totalUsers.toLocaleString("ar-EG");
    $("metricUsersMeta").innerText = `${activeUsers} نشط · ${trialUsers} تجربة مجانية · ${pendingUsers} بانتظار التفعيل`;
    $("metricPendingSubscriptionPayments").innerText = pendingSubscriptionPayments == null
      ? "—"
      : pendingSubscriptionPayments.toLocaleString("ar-EG");
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

    $("billingSummary").innerText =
      TRIAL_REGISTRATION_ENABLED
        ? `التسجيل مجاني · الاشتراك الجديد ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} شهري بعد المهلة · الحسابات القديمة تحتفظ بباقة التفعيل السابقة`
        : `${formatEgp(PLATFORM_BILLING.initialActivationFee)} أول مرة · ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} شهري`;

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
    const nextAmount = requiredSubscriptionPayment(user).amount;

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
          <span>آخر دفعة اشتراك<br><b>${money(user.lastPaymentAmount || 0)}</b></span>
        </div>
        <div class="actions">
          <button class="primaryBtn" data-action="view-user-payments" data-uid="${escapeHTML(user.uid)}">راجع دفعات الاشتراك</button>
          ${["active","trial"].includes(user.subscriptionStatus)
            ? `<button class="secondaryBtn" data-action="deactivate-user" data-uid="${escapeHTML(user.uid)}">إيقاف الاشتراك</button>`
            : ""}
        </div>
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد نتائج مطابقة.</div>';
}

async function approveSubscriptionPayment(paymentId) {
  if (!adminSession?.user?.uid) throw new Error("ADMIN_SESSION_REQUIRED");

  await runTransaction(db, async transaction => {
    const paymentRef = doc(db, "subscriptionPayments", paymentId);
    const paymentSnap = await transaction.get(paymentRef);
    if (!paymentSnap.exists()) throw new Error("PAYMENT_NOT_FOUND");

    const payment = paymentSnap.data();
    if (payment.status !== "pending_review") throw new Error("PAYMENT_ALREADY_REVIEWED");

    const uid = clean(payment.userId);
    const guardRef=doc(db,"subscriptionBillingGuards",uid);
    const userRef = doc(db, "users", uid);
    const [guardSnap,userSnap] = await Promise.all([
      transaction.get(guardRef),transaction.get(userRef)
    ]);
    if(!guardSnap.exists())throw new Error("PAYMENT_BILLING_GUARD_MISSING");
    const guardNext=buildReviewedBillingGuard(guardSnap.data(),uid,paymentId,serverTimestamp());
    if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");

    const data = userSnap.data();
    const initialAlreadyPaid = hasPaidInitialActivation(data);
    const expectedInvoice = requiredSubscriptionPayment(data);
    const expectedType = expectedInvoice.paymentType;
    const expectedAmount = expectedInvoice.amount;

    if (payment.paymentType !== expectedType || Number(payment.amount) !== Number(expectedAmount)) {
      throw new Error("PAYMENT_DOES_NOT_MATCH_ACCOUNT_STATE");
    }

    const now = new Date();

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

    transaction.set(guardRef,guardNext);
    transaction.update(paymentRef, {
      status: "approved",
      reviewedAt: serverTimestamp(),
      reviewedBy: adminSession.user.uid,
      rejectionReason: ""
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

  });
}

async function rejectSubscriptionPayment(paymentId, reason) {
  if (!adminSession?.user?.uid) throw new Error("ADMIN_SESSION_REQUIRED");
  const cleanReason = clean(reason);
  if (cleanReason.length < 3 || cleanReason.length > 300) {
    throw new Error("REJECTION_REASON_REQUIRED");
  }
  await runTransaction(db,async tx=>{
    const paymentRef=doc(db,"subscriptionPayments",paymentId);
    const paymentSnap=await tx.get(paymentRef);
    if(!paymentSnap.exists()||paymentSnap.data().status!=="pending_review")
      throw new Error("PAYMENT_ALREADY_REVIEWED");
    const uid=paymentSnap.data().userId;
    const guardRef=doc(db,"subscriptionBillingGuards",uid);
    const guardSnap=await tx.get(guardRef);
    if(!guardSnap.exists())throw new Error("PAYMENT_BILLING_GUARD_MISSING");
    tx.set(guardRef,buildReviewedBillingGuard(
      guardSnap.data(),uid,paymentId,serverTimestamp()
    ));
    tx.update(paymentRef,{
      status: "rejected",
      reviewedAt:serverTimestamp(),
      reviewedBy:adminSession.user.uid,
      rejectionReason:cleanReason
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
          <span>قناة التأكيد<br><b>${payment.proofChannel === "whatsapp" ? "WhatsApp" : escapeHTML(payment.proofChannel || "—")}</b></span>
          <span>تاريخ الإرسال<br><b>${formatDate(payment.submittedAt,true)}</b></span>
          <span>المراجع<br><b>${escapeHTML(payment.reviewedBy || "—")}</b></span>
          <span>سبب الرفض<br><b>${escapeHTML(payment.rejectionReason || "—")}</b></span>
        </div>
        <div class="actions">
          <button class="secondaryBtn" data-action="copy-payment-code" data-code="${escapeHTML(payment.paymentCode || "")}">نسخ كود الدفع</button>
          <button class="secondaryBtn" data-action="reconcile-billing-uid" data-payment="${escapeHTML(payment.paymentId)}" data-uid="${escapeHTML(payment.userId||"")}">مطابقة حساب الاشتراك القديم</button>
          ${pending ? `
            <button class="secondaryBtn" data-action="migrate-legacy-payment" data-payment="${escapeHTML(payment.paymentId)}">ترحيل سجل دفعة قديم (عند الحاجة)</button>
            <button class="primaryBtn" data-action="approve-subscription-payment" data-payment="${escapeHTML(payment.paymentId)}">اعتماد وتفعيل</button>
            <button class="dangerBtn" data-action="reject-subscription-payment" data-payment="${escapeHTML(payment.paymentId)}">رفض الدفعة</button>
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
    const merchant = projectMerchantOverview(project, project.projectDocId);

    return `
      <article class="adminCard">
        <div class="cardHead">
          <div><h3>${escapeHTML(project.businessName || project.template || "مشروع")}</h3>
          <p class="codeText">${escapeHTML(project.projectDocId)}</p></div>
          ${statusPill(active ? "active" : "inactive")}
        </div>
        <div class="metaGrid">
          <span>النوع<br><b>${escapeHTML(project.template || "—")}</b></span>
          <span>المالك التشغيلي التاريخي<br><b class="codeText">${escapeHTML(project.ownerId || "—")}</b></span>
          <span>معرّف النشاط المركزي<br><b class="codeText">${escapeHTML(merchant.merchantId || "—")}</b></span>
          <span>المشترك الأصلي<br><b class="codeText">${escapeHTML(merchant.originalSubscriberId || "—")}</b></span>
          <span>المشترك المخصص<br><b class="codeText">${escapeHTML(merchant.assignedSubscriberId || "—")}</b></span>
          <span>التخصيص<br><b>${escapeHTML(merchant.displayState)}${merchant.legacy ? " (سجل قديم)" : ""}</b></span>
          <span>تاريخ ربط النشاط<br><b>${formatDate(merchant.linkedAt)}</b></span>
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
          ${merchant.platformManaged ? `<button class="secondaryBtn"
            data-action="show-platform-recovery-dues"
            data-project="${escapeHTML(project.projectDocId)}" type="button">
            مستحقات المنصة والمشترك السابق
          </button>` : ""}
          ${merchant.assignmentStatus === "platform_managed" ? `<button class="secondaryBtn"
            data-action="check-final-cutover"
            data-project="${escapeHTML(project.projectDocId)}" type="button">
            مراجعة جاهزية تسليم المحل (بدون تنفيذ)
          </button>` : ""}
          <label class="transferPreflightInput">فحص نقل النشاط للمشترك الجديد
            <input class="candidateSubscriberUid" type="text" maxlength="128" placeholder="UID المشترك الجديد" autocomplete="off">
          </label>
          ${PLATFORM_MERCHANT_RECOVERY_ENABLED && !merchant.platformManaged && !merchant.legacy ? `
            <label class="transferPreflightInput">سبب استرداد الإدارة
              <select class="merchantRecoveryReason">
                <option value="overdue_renewal">تأخر تجديد الاشتراك</option>
                <option value="unpaid_first_month">لم يسدد أول اشتراك بعد المهلة</option>
                <option value="confirmed_violation">مخالفة موثقة ومؤكدة</option>
              </select>
            </label>
            <button class="dangerBtn" data-action="recover-platform-merchant" data-project="${escapeHTML(project.projectDocId)}" type="button">
              استرداد إدارة المحل للمنصة
            </button>` : ""}
          ${MERCHANT_REPEAT_RECOVERY_ENABLED
            && merchant.platformManaged && merchant.assignmentStatus==="assigned_to_new_subscriber"
            && (project.assignmentCycle??1)>=1 ? `
            <label class="transferPreflightInput">سبب استرداد المحل بعد انتهاء تخصيصه
              <select class="merchantRepeatReason">
                <option value="overdue_renewal">تأخر التجديد</option>
                <option value="unpaid_first_month">أول اشتراك غير مسدد</option>
                <option value="confirmed_violation">مخالفة موثقة</option>
              </select>
            </label>
            <button class="dangerBtn" type="button" data-action="repeat-recover-merchant"
              data-project="${escapeHTML(project.projectDocId)}">استرداد جديد مع حفظ المستحقات</button>`:""}
          ${MERCHANT_REPEAT_ASSIGNMENT_ENABLED && merchant.platformManaged
            && merchant.assignmentStatus==="platform_managed"
            && Number.isSafeInteger(project.assignmentCycle)
            && project.assignmentCycle>=2 ? `
            <label class="transferPreflightInput">سبب التخصيص المتكرر
              <input class="repeatTransferReason" minlength="15" maxlength="300"
                placeholder="اكتب سببًا واضحًا لا يقل عن 15 حرفًا">
            </label>
            <button class="secondaryBtn" type="button" data-action="repeat-open-transfer"
              data-project="${escapeHTML(project.projectDocId)}">طلب موافقات جديدة</button>
            <button class="secondaryBtn" type="button" data-action="repeat-review-finance"
              data-project="${escapeHTML(project.projectDocId)}">توثيق الحسابات دون سداد</button>
            <button class="dangerBtn" type="button" data-action="repeat-execute-transfer"
              data-project="${escapeHTML(project.projectDocId)}">نقل المحل بعد مراجعة الموافقات</button>
          `:""}
          <button class="secondaryBtn" data-action="preflight-merchant-transfer" data-project="${escapeHTML(project.projectDocId)}" type="button">
            فحص أهلية النقل (قراءة فقط)
          </button>
          ${MERCHANT_TRANSFER_CASES_ENABLED && merchant.assignmentStatus === "platform_managed" && !merchant.legacy ? `
            <label class="transferPreflightInput">سبب التخصيص الجديد
              <input class="transferCaseReason" type="text" minlength="15" maxlength="300"
                placeholder="سبب مفصل لا يقل عن 15 حرفًا">
            </label>
            <button class="secondaryBtn" type="button" data-action="open-merchant-transfer-case"
              data-project="${escapeHTML(project.projectDocId)}">إنشاء اتفاق تخصيص جديد</button>
            <button class="secondaryBtn" type="button" data-action="review-merchant-transfer-finance"
              data-project="${escapeHTML(project.projectDocId)}">توثيق مراجعة الحسابات (بدون سداد)</button>
            ${MERCHANT_CUTOVER_ENABLED ? `<button class="dangerBtn" type="button" data-action="execute-merchant-cutover"
              data-project="${escapeHTML(project.projectDocId)}">تنفيذ النقل الفعلي بعد المراجعة</button>` : ""}
          ` : ""}

        </div>
        <p class="transferPreflightResult" role="status" aria-live="polite"></p>
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
        ...(exact.exists() && exact.data().sourceType === "project_order" ? [{ entryId: exact.id, ...exact.data() }] : []),
        ...byProject.docs.map(item => ({ entryId: item.id, ...item.data() })),
        ...byUser.docs.map(item => ({ entryId: item.id, ...item.data() }))
      ];

      rows = uniqueRows(rows, "entryId").filter(row => row.sourceType === "project_order");
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
      const rows = snap.docs.map(item => ({ entryId: item.id, ...item.data() }))
        .filter(row => row.sourceType === "project_order");
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
    if (button.dataset.action === "migrate-legacy-payment") {
      if (!confirm("هل هذه دفعة قديمة من قبل تحديث قواعد Firebase؟ سيتم ربطها بسجل المراجعة الآمن، بدون تفعيل الاشتراك.")) return;
      await migrateLegacyPendingProof({paymentId,adminUid:adminSession.user.uid});
      $("subscriptionPaymentsMessage").innerText="تم ترحيل الإثبات القديم لمراجعته بأمان.";
    } else if (button.dataset.action === "reconcile-billing-uid") {
      if(!confirm("تأكد أولًا أن كل إثباتات InstaPay وواتساب القديمة لهذا الحساب تمت مراجعتها، وأنه لا توجد دفعة معلقة. هذه الخطوة تسمح بفحص الاسترداد لاحقًا.")) return;
      await reconcileLegacyBillingAccount({uid:button.dataset.uid,adminUid:adminSession.user.uid});
      $("subscriptionPaymentsMessage").innerText="تم توثيق مطابقة الحساب المالي القديم.";
    } else if (button.dataset.action === "approve-subscription-payment") {
      const confirmed = confirm("اعتماد هذه الدفعة سيُفعّل/يُجدد الاشتراك فورًا. هل تحققت من استلام المبلغ بمطابقة مرجع InstaPay مع حساب الاستلام أو تأكيد المستلم؟");
      if (!confirmed) return;
      await approveSubscriptionPayment(paymentId);
      $("subscriptionPaymentsMessage").innerText = "تم اعتماد الدفعة وتحديث الاشتراك بنجاح ✅";
    } else if (button.dataset.action === "reject-subscription-payment") {
      const reason = prompt("اكتب سبب الرفض ليظهر للمشترك:");
      if (reason === null) return;
      await rejectSubscriptionPayment(paymentId, reason);
      $("subscriptionPaymentsMessage").innerText = "تم رفض الدفعة بدون تغيير حالة الاشتراك.";
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

  if (button.dataset.action === "check-final-cutover") {
    const result = button.closest(".adminCard")?.querySelector(".transferPreflightResult");
    button.disabled = true;
    if (result) result.textContent = "جاري فحص التخصيص والموافقات والمستحقات...";
    try {
      const [projectSnap, caseSnap, operatorSnap, agreementSnap, auditSnap] = await Promise.all([
        getDoc(doc(db, "projects", projectId)),
        getDoc(doc(db, "merchantTransferCases", projectId)),
        getDoc(doc(db, "operators", projectId)),
        getDoc(doc(db, "commissionAgreements", projectId)),
        getDoc(doc(db, "merchantRecoveries", projectId))
      ]);
      const project = projectSnap.exists() ? projectSnap.data() : null;
      const transferCase = caseSnap.exists() ? caseSnap.data() : null;
      if (!project || project.platformManaged !== true) throw new Error("NOT_A_RECOVERED_MERCHANT");
      const newUid = String(transferCase?.proposedSubscriberId || "");
      const recipientSnap = /^[A-Za-z0-9_-]{1,128}$/.test(newUid)
        ? await getDoc(doc(db, "users", newUid)) : null;
      const [platformSummary, historicalSummary] = await Promise.all([
        getProjectPaymentSummary(projectId),
        getProjectPaymentSummary(projectId, { ownerId: project.originalSubscriberId || project.ownerId })
      ]);
      const report = assessMerchantCutoverReadiness({
        projectId, project, transferCase,
        recoveryAudit:auditSnap.exists() ? auditSnap.data() : null,
        operator:operatorSnap.exists() ? operatorSnap.data() : null,
        agreement:agreementSnap.exists() ? agreementSnap.data() : null,
        recipient:recipientSnap?.exists() ? {...recipientSnap.data(),uid:newUid} : null,
        recipientUid:newUid,
        platformSummary,historicalSummary
      });
      if (result) result.textContent = formatMerchantCutoverReadiness(report);
    } catch (error) {
      console.error(error);
      if (result) result.textContent = "تعذر التحقق من شروط التسليم؛ لم تتغير أي بيانات.";
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === "show-platform-recovery-dues") {
    const container = button.closest(".adminCard")?.querySelector(".transferPreflightResult");
    button.disabled = true;
    if (container) container.textContent = "جاري مراجعة المستحقات منفصلة...";
    try {
      const projectSnap = await getDoc(doc(db, "projects", projectId));
      if (!projectSnap.exists() || projectSnap.data().platformManaged !== true) {
        throw new Error("NOT_A_RECOVERED_MERCHANT");
      }
      const oldUid = projectSnap.data().originalSubscriberId || projectSnap.data().ownerId;
      const allocated = projectSnap.data().assignmentStatus === "assigned_to_new_subscriber";
      const newUid = allocated ? String(projectSnap.data().assignedSubscriberId || "") : "";
      const [platform, historical, incoming] = await Promise.all([
        getProjectPaymentSummary(projectId, { ownerId: PLATFORM_COMMISSION_BENEFICIARY }),
        getProjectPaymentSummary(projectId, { ownerId: oldUid }),
        allocated && newUid ? getProjectPaymentSummary(projectId,{ownerId:newUid}) : Promise.resolve(null)
      ]);
      if (container) container.textContent =
        `مستحقات المنصة بعد الاسترداد وقبل التسليم: ${money(platform.outstandingAmount)} | إجمالي المتحقق: ${money(platform.earnedAmount)}\n` +
        `حقوق المشترك القديم (لم تُنقل): ${money(historical.outstandingAmount)} | إجمالي أرباحه السابقة: ${money(historical.earnedAmount)}\n` +
        (incoming ? `حقوق المشترك الجديد بعد النقل: ${money(incoming.outstandingAmount)} | إجمالي عمولته: ${money(incoming.earnedAmount)}\n` : "") +
        "للعرض والمتابعة فقط؛ لا يتم تأكيد سداد أو إعادة توزيع أي رصيد من هنا.";
    } catch (error) {
      console.error(error);
      if (container) container.textContent = "تعذر تحميل فصل المستحقات. لم تتغير أي بيانات.";
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === "repeat-recover-merchant") {
    if (!MERCHANT_REPEAT_RECOVERY_ENABLED) return;
    const card=button.closest(".adminCard");
    const reason=card?.querySelector(".merchantRepeatReason")?.value;
    const result=card?.querySelector(".transferPreflightResult");
    if(!confirm("هل تحققت من انتهاء الاشتراك أو المخالفة، وعدم وجود إثبات دفع معلق، وتوثيق حقوق المشترك السابق؟"))return;
    button.disabled=true;
    try{
      const done=await executeRepeatMerchantRecovery({
        projectId,adminUid:adminSession.user.uid,reason
      });
      if(result)result.textContent="تم الاسترداد الموثق لدورة "+done.cycle+". المحل شغال ومستحقات المشترك السابق محفوظة.";
      await Promise.all([loadProjects(),loadOverview()]);
    }catch(error){
      console.error(error);
      if(result)result.textContent="تعذر الاسترداد: يلزم مطابقة المدفوعات والأدلة مع سجل الدورة السابقة.";
    }finally{button.disabled=false;}
    return;
  }
  if (button.dataset.action === "repeat-open-transfer") {
    if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)return;
    const card=button.closest(".adminCard");
    const candidateUid=String(card?.querySelector(".candidateSubscriberUid")?.value||"").trim();
    const reason=String(card?.querySelector(".repeatTransferReason")?.value||"").trim();
    const result=card?.querySelector(".transferPreflightResult");
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(candidateUid)||reason.length<15||reason.length>300){
      if(result)result.textContent="راجع UID المشترك الجديد وسبب التخصيص أولًا.";return;
    }
    if(!confirm("سجل طلب موافقة مستقل للمشغل والمشترك الجديد، بدون تدخل المشترك السابق؟"))return;
    button.disabled=true;
    try{
      const r=await openRepeatMerchantTransferCase({
        projectId,candidateUid,reason,adminUid:adminSession.user.uid
      });
      const root=new URL("../",window.location.href).href;
      const link=merchantTransferConsentLink(root,projectId,Number(r.cycleId.split("_").at(-1)));
      if(result)result.textContent="ابعت رابط الموافقات لصاحب المحل والمشترك المستلم عبر واتساب: "+link;
      try{await navigator.clipboard?.writeText(link);}catch{}
    }catch(error){console.error(error);
      if(result)result.textContent="تعذر إنشاء طلب جديد؛ تأكد من المشغل والحساب والعمولة.";
    }finally{button.disabled=false;}
    return;
  }
  if (button.dataset.action === "repeat-review-finance") {
    if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)return;
    const result=button.closest(".adminCard")?.querySelector(".transferPreflightResult");
    if(!confirm("تسجيل مراجعة مالية فقط، بدون إلغاء ديون أو سداد نيابة عن الطرفين؟"))return;
    button.disabled=true;
    try{
      await reviewRepeatMerchantFinances({projectId,adminUid:adminSession.user.uid});
      if(result)result.textContent="تمت مراجعة المستحقات السابقة بصورة منفصلة.";
    }catch(error){console.error(error);
      if(result)result.textContent="تعذر مراجعة الحسابات؛ تحقق من الموافقات وثبات العمولة.";
    }finally{button.disabled=false;}
    return;
  }
  if (button.dataset.action === "repeat-execute-transfer") {
    if(!MERCHANT_REPEAT_ASSIGNMENT_ENABLED)return;
    const result=button.closest(".adminCard")?.querySelector(".transferPreflightResult");
    if(!confirm("تسليم المحل للمشترك الجديد بعد توثيق الموافقتين والمراجعة المالية، مع الاحتفاظ بكل السجلات القديمة؟"))return;
    button.disabled=true;
    try{
      await executeRepeatMerchantAssignment({projectId,adminUid:adminSession.user.uid});
      if(result)result.textContent="تم النقل الذري للدورة الجديدة بدون تغيير رقم المحل أو سجلاته القديمة.";
      await loadProjects();
    }catch(error){console.error(error);
      if(result)result.textContent="لم يتم النقل؛ سجل الموافقة أو الاستحقاقات أو الحساب المستلم غير مكتمل.";
    }finally{button.disabled=false;}
    return;
  }

  if (button.dataset.action === "execute-merchant-cutover") {
    if (!MERCHANT_CUTOVER_ENABLED || !MERCHANT_TRANSFER_CASES_ENABLED) return;
    const result = button.closest(".adminCard")?.querySelector(".transferPreflightResult");
    const approved = confirm("تنفيذ نقل الإدارة والعمولات المستقبلية للمشترك المستلم؟ الموافقتان ومراجعة المستحقات شرط إلزامي. لا تتغير أي سجلات أو مدفوعات قديمة، ولا يلزم موافقة المشترك السابق.");
    if (!approved) return;
    button.disabled = true;
    try {
      await executeMerchantCutover({projectId,adminUid:adminSession.user.uid});
      if (result) result.textContent = "تم النقل الموثق. هوية المحل وسجلات المشترك السابق سليمة، وعمولات الطلبات الجديدة تتبع المشترك الجديد.";
      await loadProjects();
    } catch (error) {
      console.error(error);
      if (result) result.textContent = "لم يتم النقل؛ حالة المشروع أو الموافقات أو مراجعة المستحقات غير مكتملة. لم تُغيَّر الصلاحيات.";
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === "view-project-payments") {
    state.settlements.search = projectId;
    $("settlementsSearch").value = projectId;
    switchSection("settlementsSection");
    await loadSettlements();
    return;
  }

  if (button.dataset.action === "review-merchant-transfer-finance") {
    if (!MERCHANT_TRANSFER_CASES_ENABLED) return;
    const result = button.closest(".adminCard")?.querySelector(".transferPreflightResult");
    const approved = confirm("تأكيد مراجعة رصيد المنصة وحقوق المشترك السابق بعد قبول المشغّل والمشترك الجديد؟ ده توثيق للمراجعة فقط، ولا يعني سداد أي مبلغ أو تصفيره.");
    if (!approved) return;
    button.disabled = true;
    try {
      await reviewMerchantTransferFinance({projectDocId:projectId,adminUid:adminSession.user.uid});
      if (result) result.textContent = "تم توثيق مراجعة الفترات المالية بدون تأكيد سداد أو نقل للمحل. المستحقات السابقة محفوظة.";
    } catch (error) {
      console.error(error);
      if (result) result.textContent = "تعذر اعتماد المراجعة. تأكد من موافقتي المشغّل والمشترك الجديد وثبات عمولتهما.";
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === "open-merchant-transfer-case") {
    if (!MERCHANT_TRANSFER_CASES_ENABLED) return;
    const card = button.closest(".adminCard");
    const result = card?.querySelector(".transferPreflightResult");
    const candidateUid = String(card?.querySelector(".candidateSubscriberUid")?.value || "").trim();
    const reason = String(card?.querySelector(".transferCaseReason")?.value || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(candidateUid) || reason.length < 15 || reason.length > 300) {
      if (result) result.textContent = "راجع UID المشترك الجديد واكتب سببًا واضحًا من 15 إلى 300 حرف.";
      return;
    }
    const approved = confirm("هل راجعت أهلية المشترك الجديد؟ الطلب ده لتسجيل موافقات صاحب المحل والمشترك الجديد، وليس نقلًا نهائيًا ولا يحتاج موافقة المشترك السابق.");
    if (!approved) return;
    button.disabled = true;
    try {
      await openMerchantTransferCase({
        projectDocId: projectId, candidateUid, reason,
        adminUid: adminSession.user.uid
      });
      const root = new URL("../", window.location.href).href;
      const link = merchantTransferConsentLink(root, projectId);
      if (result) result.textContent =
        "تم إنشاء طلب الموافقات. ابعت الرابط ده لصاحب المحل والمشترك الجديد عبر واتساب: " +
        link + "\nرابط الاتفاق لا يغيّر الإدارة أو مستحقات أي طرف حتى تتم مرحلة النقل النهائي.";
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(link); } catch { /* display link regardless */ }
      }
    } catch (error) {
      console.error(error);
      if (result) result.textContent =
        "تعذر إنشاء طلب الموافقات. راجع النشاط والاشتراك واتفاق العمولة، أو وجود طلب سابق.";
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === "preflight-merchant-transfer") {
    const panel = button.closest(".adminCard");
    const result = panel?.querySelector(".transferPreflightResult");
    const candidateUid = String(panel?.querySelector(".candidateSubscriberUid")?.value || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(candidateUid)) {
      if (result) result.textContent = "اكتب UID صحيح للمشترك الجديد أولًا.";
      return;
    }
    button.disabled = true;
    if (result) result.textContent = "جاري مراجعة النشاط وحساب المشترك والاتفاق...";
    try {
      const [projectSnap,operatorSnap,agreementSnap,candidateSnap] = await Promise.all([
        getDoc(doc(db,"projects",projectId)),
        getDoc(doc(db,"operators",projectId)),
        getDoc(doc(db,"commissionAgreements",projectId)),
        getDoc(doc(db,"users",candidateUid))
      ]);
      const report = assessMerchantTransfer({
        projectDocId:projectId,
        project:projectSnap.exists() ? projectSnap.data() : null,
        operator:operatorSnap.exists() ? operatorSnap.data() : null,
        agreement:agreementSnap.exists() ? agreementSnap.data() : null,
        candidate:candidateSnap.exists() ? candidateSnap.data() : null,
        candidateUid
      });
      if (result) result.textContent = formatMerchantTransferPreflight(report);
    } catch (error) {
      console.error(error);
      if (result) result.textContent = "تعذر مراجعة النقل حاليًا. لم تتغير أي بيانات.";
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === "recover-platform-merchant") {
    if (!PLATFORM_MERCHANT_RECOVERY_ENABLED) return;
    const card=button.closest(".adminCard");
    const reason=card?.querySelector(".merchantRecoveryReason")?.value;
    const result=card?.querySelector(".transferPreflightResult");
    const approved=confirm("استرداد إدارة المحل للمنصة بدون موافقة المشترك القديم، مع حفظ جميع حقوقه المالية السابقة. هل تمت مراجعة حالة الدفع ودليل المخالفة؟");
    if (!approved) return;
    button.disabled=true;
    if (result) result.textContent="جاري التحقق وتنفيذ الاسترداد الموثق...";
    try {
      await executePlatformMerchantRecovery({projectDocId:projectId,adminUid:adminSession.user.uid,reason});
      if (result) result.textContent="تم استرداد إدارة المحل للمنصة مع استمرار التشغيل وحفظ المستحقات القديمة.";
      await Promise.all([loadProjects(),loadOverview()]);
    } catch (error) {
      console.error(error);
      if (result) result.textContent="لم يتم الاسترداد. راجع الاشتراك وأي دفعة معلقة وإثبات المخالفة. لم تتغير البيانات.";
    } finally {
      button.disabled=false;
    }
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
