import db from "../core/firebase/firebase-db.js";
import { protectAdmin } from "../core/auth/admin-guard.js";
import {
  PLATFORM_BILLING,
  REFERRAL_CONFIG,
  formatEgp
} from "../core/config/platform-config.js";
import { escapeHTML } from "../core/utils/helpers.js";
import { listRecentCommissionSettlements } from "../core/commissions/settlement-service.js";

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

let adminSession = null;
let searchTimer = null;

const state = {
  users: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" },
  projects: { rows: [], cursor: null, hasMore: false, loading: false, search: "", template: "all" },
  operators: { rows: [], cursor: null, hasMore: false, loading: false, search: "" },
  orders: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" },
  commissions: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" },
  settlements: { rows: [], cursor: null, hasMore: false, loading: false, search: "", status: "all" }
};

const sectionLoaded = {
  usersSection: false,
  projectsSection: false,
  operatorsSection: false,
  ordersSection: false,
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
    pending_invite: "دعوة معلقة",
    accepted: "مقبول",
    earned: "مستحق",
    paid: "مدفوع - نظام سابق",
    confirmed: "تم تأكيد الدفع",
    pending_owner_confirmation: "بانتظار تأكيد المشترك",
    rejected: "مرفوض",
    new: "جديد",
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
      confirmedPayments,
      legacyPayments,
      pendingPayments
    ] = await Promise.all([
      countDocs("users"),
      countDocs("users", [where("subscriptionStatus", "==", "active")]),
      countDocs("users", [where("subscriptionStatus", "==", "pending")]),
      countDocs("projects"),
      countDocs("operators"),
      countDocs("operators", [where("isActive", "==", true)]),
      countDocs("orders"),
      aggregateAmount("commissionLedger"),
      aggregateAmount("commissionSettlements", [where("status", "==", "confirmed")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      aggregateAmount("commissionSettlements", [where("status", "==", "paid")]).catch(() => ({ totalAmount: 0, entryCount: 0 })),
      countDocs("commissionSettlements", [where("status", "==", "pending_owner_confirmation")]).catch(() => null)
    ]);

    const confirmedPaid = confirmedPayments.totalAmount + legacyPayments.totalAmount;
    const outstanding = Math.max(0, totalCommission.totalAmount - confirmedPaid);

    $("metricUsers").innerText = totalUsers.toLocaleString("ar-EG");
    $("metricUsersMeta").innerText = `${activeUsers} نشط · ${pendingUsers} بانتظار التفعيل`;
    $("metricProjects").innerText = totalProjects.toLocaleString("ar-EG");
    $("metricOperators").innerText = totalOperators.toLocaleString("ar-EG");
    $("metricOperatorsMeta").innerText = `${activeOperators} مشغّل نشط`;
    $("metricOrders").innerText = totalOrders.toLocaleString("ar-EG");
    $("metricOrdersMeta").innerText = "إجمالي الطلبات المسجلة";
    $("metricEarned").innerText = money(totalCommission.totalAmount);
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
          <button class="primaryBtn" data-action="activate-user" data-uid="${escapeHTML(user.uid)}">
            ${initialAlreadyPaid ? "تأكيد التجديد" : "تفعيل أول مرة"}
          </button>
          <button class="secondaryBtn" data-action="deactivate-user" data-uid="${escapeHTML(user.uid)}">إيقاف الاشتراك</button>
        </div>
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد نتائج مطابقة.</div>';
}

async function activateOrRenewUser(uid) {
  await runTransaction(db, async transaction => {
    const userRef = doc(db, "users", uid);
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");

    const data = userSnap.data();
    const initialAlreadyPaid = hasPaidInitialActivation(data);
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

async function ensureSectionLoaded(sectionId) {
  if (sectionLoaded[sectionId]) return;
  if (sectionId === "usersSection") await loadUsers();
  if (sectionId === "projectsSection") await loadProjects();
  if (sectionId === "operatorsSection") await loadOperators();
  if (sectionId === "ordersSection") await loadAdminOrders();
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
  if (sectionLoaded.projectsSection) jobs.push(loadProjects());
  if (sectionLoaded.operatorsSection) jobs.push(loadOperators());
  if (sectionLoaded.ordersSection) jobs.push(loadAdminOrders());
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
$("refreshProjectsBtn").addEventListener("click", () => loadProjects());
$("refreshOperatorsBtn").addEventListener("click", () => loadOperators());
$("refreshOrdersAdminBtn").addEventListener("click", () => loadAdminOrders());
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
  button.disabled = true;

  try {
    if (button.dataset.action === "activate-user") {
      await activateOrRenewUser(button.dataset.uid);
      $("usersMessage").innerText = "تم تحديث الاشتراك بنجاح.";
    } else if (button.dataset.action === "deactivate-user") {
      await updateDoc(doc(db, "users", button.dataset.uid), {
        isActive: false,
        subscriptionStatus: "inactive"
      });
      $("usersMessage").innerText = "تم إيقاف الاشتراك.";
    }

    await Promise.all([loadUsers(), loadOverview()]);
  } catch (error) {
    console.error(error);
    $("usersMessage").innerText = `تعذر تنفيذ الإجراء: ${error.message}`;
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
