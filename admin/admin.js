Warning: truncated output (original token count: 21753)
Total output lines: 1755

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
import { TRIAL_REGISTRATION_ENABLED } from "../core/subscriptions/trial-rollout.js";
import { getProjectPaymentSummary } from "../core/commissions/settlement-service.js";
import { protectAdmin } from "../core/auth/admin-guard.js";
import {
  PLATFORM_BILLING,
  REFERRAL_CONFIG,
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
      aggregateAmount("commissionLedger"),
      aggregateAmount("commissionLedger", [where("status", "==", "reversed")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
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
        ? `التسجيل مجاني · الاشتراك الجديد ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} شهري بعد المهلة · الحسابات القديمة تحتفظ بباقة التفعيل السابقة · إحالة ${formatEgp(REFERRAL_CONFIG.qualifiedReferralReward)}`
        : `${formatEgp(PLATFORM_BILLING.initialActivationFee)} أول مرة · ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} شهري · إحالة ${formatEgp(REFERRAL_CONFIG.qualifiedReferralReward)}`;

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
          <span>إحالة<br><b>${escapeHTML(user.referredByUserId || "لا يوجد")}</b></span>
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

      transaction.update(userRef, { referralQualified: true });…11753 tokens truncated…   state.subscriptionPayments.cursor = null;
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

