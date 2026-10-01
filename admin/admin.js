import db from "../core/firebase/firebase-db.js";
import { protectAdmin } from "../core/auth/admin-guard.js";
import {
  PLATFORM_BILLING,
  REFERRAL_CONFIG,
  formatEgp
} from "../core/config/platform-config.js";
import { escapeHTML } from "../core/utils/helpers.js";
import {
  createProjectCommissionSettlement,
  listRecentCommissionSettlements,
  markCommissionSettlementPaid,
  voidCommissionSettlement
} from "../core/commissions/settlement-service.js";

import {
  collection,
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
const USERS_PAGE_SIZE = 50;
const USERS_SEARCH_PAGE_SIZE = 100;
const ADMIN_LIST_LIMIT = 100;

let adminSession = null;
let users = [];
let usersCursor = null;
let usersHasMore = false;
let usersLoading = false;
let currentSearch = "";
let currentStatus = "all";
let searchTimer = null;

let projects = [];
let operators = [];
let adminOrders = [];
let commissions = [];
let settlements = [];

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

function normalizeSearch(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

function containsSearch(parts, term) {
  const q = normalizeSearch(term);
  if (!q) return true;
  return normalizeSearch(parts.filter(Boolean).join(" ")).includes(q);
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
    paid: "مدفوع",
    void: "ملغي",
    new: "جديد",
    delivered: "تم التوصيل",
    done: "مكتمل",
    canceled: "ملغي"
  })[value] || value;
  return `<span class="pill ${escapeHTML(value)}">${escapeHTML(label)}</span>`;
}

async function countDocs(collectionName, constraints = []) {
  const snap = await getCountFromServer(query(collection(db, collectionName), ...constraints));
  return Number(snap.data().count || 0);
}

async function aggregateLedger(constraints = []) {
  const snap = await getAggregateFromServer(
    query(collection(db, "commissionLedger"), ...constraints),
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
      earnedLedger,
      paidLedger,
      pendingSettlements
    ] = await Promise.all([
      countDocs("users"),
      countDocs("users", [where("subscriptionStatus", "==", "active")]),
      countDocs("users", [where("subscriptionStatus", "==", "pending")]),
      countDocs("projects"),
      countDocs("operators"),
      countDocs("operators", [where("isActive", "==", true)]),
      countDocs("orders"),
      aggregateLedger([where("status", "==", "earned")]),
      aggregateLedger([where("status", "==", "paid")]),
      countDocs("commissionSettlements", [where("status", "==", "pending")])
    ]);

    const allCommission = earnedLedger.totalAmount + paidLedger.totalAmount;

    $("metricUsers").innerText = totalUsers.toLocaleString("ar-EG");
    $("metricUsersMeta").innerText = `${activeUsers} نشط · ${pendingUsers} بانتظار التفعيل`;
    $("metricProjects").innerText = totalProjects.toLocaleString("ar-EG");
    $("metricOperators").innerText = totalOperators.toLocaleString("ar-EG");
    $("metricOperatorsMeta").innerText = `${activeOperators} مشغّل نشط`;
    $("metricOrders").innerText = totalOrders.toLocaleString("ar-EG");
    $("metricOrdersMeta").innerText = "إجمالي الطلبات المسجلة";
    $("metricEarned").innerText = money(allCommission);
    $("metricPaid").innerText = money(paidLedger.totalAmount);
    $("metricOutstanding").innerText = money(earnedLedger.totalAmount);
    $("metricPendingSettlements").innerText = pendingSettlements.toLocaleString("ar-EG");
    $("metricPendingSettlementsMeta").innerText = pendingSettlements ? "تحتاج مراجعة أو سداد" : "لا توجد تسويات معلقة";

    $("billingSummary").innerText =
      `${formatEgp(PLATFORM_BILLING.initialActivationFee)} أول مرة · ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} شهري · إحالة ${formatEgp(REFERRAL_CONFIG.qualifiedReferralReward)}`;

    $("overviewStatus").innerText = `آخر تحديث: ${new Intl.DateTimeFormat("ar-EG",{timeStyle:"short"}).format(new Date())}`;
  } catch (error) {
    console.error(error);
    $("overviewStatus").innerText = `تعذر تحميل بعض المؤشرات: ${error.message}`;
  }
}

function userQueryConstraints({ status = "all", cursor = null, pageSize = USERS_PAGE_SIZE } = {}) {
  const constraints = [];
  pageSize = Math.max(1, Math.min(100, Number(pageSize) || USERS_PAGE_SIZE));
  if (status !== "all") constraints.push(where("subscriptionStatus", "==", status));
  constraints.push(orderBy(documentId()));
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(pageSize));
  return constraints;
}

async function listUsersPage(options = {}) {
  const snap = await getDocs(query(collection(db, "users"), ...userQueryConstraints(options)));
  const size = Math.max(1, Math.min(100, Number(options.pageSize) || USERS_PAGE_SIZE));
  return {
    users: snap.docs.map(item => ({ uid: item.id, ...item.data() })),
    nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === size
  };
}

async function searchAllUsers(term, status = "all") {
  const matches = [];
  let cursor = null;

  while (true) {
    const page = await listUsersPage({ status, cursor, pageSize: USERS_SEARCH_PAGE_SIZE });
    matches.push(...page.users.filter(user =>
      containsSearch([user.uid, user.name, user.email], term)
    ));
    if (!page.hasMore || !page.nextCursor) break;
    if (cursor && page.nextCursor.id === cursor.id) throw new Error("USERS_PAGINATION_STALLED");
    cursor = page.nextCursor;
  }

  return matches;
}

async function activateOrRenewUser(uid) {
  await runTransaction(db, async transaction => {
    const userRef = doc(db, "users", uid);
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) throw new Error("USER_NOT_FOUND");

    const data = userSnap.data();
    const initialAlreadyPaid = hasPaidInitialActivation(data);
    const now = new Date();

    let referrerRef = null;
    let referrerSnap = null;
    let referralRef = null;
    let referralSnap = null;
    const referrerId = /^[A-Za-z0-9_-]{1,128}$/.test(clean(data.referredByUserId))
      ? clean(data.referredByUserId)
      : "";

    if (!initialAlreadyPaid && referrerId && referrerId !== uid) {
      referrerRef = doc(db, "users", referrerId);
      referralRef = doc(db, "referrals", `${referrerId}_${uid}`);
      referrerSnap = await transaction.get(referrerRef);
      referralSnap = await transaction.get(referralRef);
    }

    let periodStart = now;
    if (initialAlreadyPaid && data.subscriptionExpiresAt) {
      const existingExpiry = typeof data.subscriptionExpiresAt.toDate === "function"
        ? data.subscriptionExpiresAt.toDate()
        : new Date(data.subscriptionExpiresAt);
      if (!Number.isNaN(existingExpiry.getTime()) && existingExpiry > now) periodStart = existingExpiry;
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

function renderUsers() {
  const container = $("usersContainer");
  if (!users.length) {
    container.innerHTML = '<div class="emptyState">لا توجد نتائج مطابقة.</div>';
    return;
  }

  container.innerHTML = users.map(user => {
    const initialAlreadyPaid = hasPaidInitialActivation(user);
    const nextAmount = initialAlreadyPaid
      ? PLATFORM_BILLING.monthlyRenewalFee
      : PLATFORM_BILLING.initialActivationFee;

    return `
      <article class="adminCard" data-user="${escapeHTML(user.uid)}">
        <div class="cardHead">
          <div>
            <h3>${escapeHTML(user.name || "بدون اسم")}</h3>
            <p>${escapeHTML(user.email || "")}</p>
          </div>
          ${statusPill(user.subscriptionStatus || "pending")}
        </div>
        <div class="metaGrid">
          <span>UID<br><b class="codeText">${escapeHTML(user.uid)}</b></span>
          <span>أول اشتراك<br><b>${initialAlreadyPaid ? "تم" : "لم يتم"}</b></span>
          <span>انتهاء الاشتراك<br><b>${formatDate(user.subscriptionExpiresAt)}</b></span>
          <span>المطلوب الآن<br><b>${formatEgp(nextAmount)}</b></span>
          <span>إحالة<br><b>${user.referredByUserId ? escapeHTML(user.referredByUserId) : "لا يوجد"}</b></span>
          <span>آخر دفعة<br><b>${money(user.lastPaymentAmount || 0)}</b></span>
        </div>
        <div class="actions">
          <button class="primaryBtn" data-action="activate-user" data-uid="${escapeHTML(user.uid)}">
            ${initialAlreadyPaid ? "تأكيد التجديد" : "تفعيل أول مرة"}
          </button>
          <button class="secondaryBtn" data-action="deactivate-user" data-uid="${escapeHTML(user.uid)}">إيقاف الاشتراك</button>
        </div>
      </article>
    `;
  }).join("");
}

async function loadUsers({ append = false } = {}) {
  if (usersLoading) return;
  const search = currentSearch.trim();

  if (search && search.length < 2) {
    $("usersMessage").innerText = "اكتب حرفين على الأقل للبحث في كل المستخدمين.";
    users = [];
    renderUsers();
    return;
  }

  usersLoading = true;
  $("loadMoreUsersBtn").disabled = true;
  $("usersMessage").innerText = search ? "جاري البحث..." : "جاري تحميل المستخدمين...";

  try {
    const total = await countDocs("users", currentStatus === "all" ? [] : [where("subscriptionStatus", "==", currentStatus)]);

    if (search) {
      users = await searchAllUsers(search, currentStatus);
      usersCursor = null;
      usersHasMore = false;
      $("usersCount").innerText = `${users.length} نتيجة من ${total}`;
    } else {
      const page = await listUsersPage({
        status: currentStatus,
        cursor: append ? usersCursor : null,
        pageSize: USERS_PAGE_SIZE
      });

      if (append) {
        const known = new Set(users.map(user => user.uid));
        users.push(...page.users.filter(user => !known.has(user.uid)));
      } else {
        users = page.users;
      }

      usersCursor = page.nextCursor;
      usersHasMore = page.hasMore;
      $("usersCount").innerText = `الإجمالي: ${total}`;
    }

    renderUsers();
    $("usersMessage").innerText = `المعروض الآن: ${users.length}`;
    $("loadMoreUsersBtn").classList.toggle("hidden", !usersHasMore || Boolean(search));
    sectionLoaded.usersSection = true;
  } catch (error) {
    console.error(error);
    $("usersMessage").innerText = `تعذر تحميل المستخدمين: ${error.message}`;
  } finally {
    usersLoading = false;
    $("loadMoreUsersBtn").disabled = false;
  }
}

async function loadProjects() {
  $("projectsMessage").innerText = "جاري تحميل المشاريع...";
  try {
    const snap = await getDocs(query(collection(db, "projects"), orderBy(documentId()), limit(ADMIN_LIST_LIMIT)));
    projects = snap.docs.map(item => ({ projectDocId: item.id, ...item.data() }));
    renderProjects();
    $("projectsMessage").innerText = `آخر ${projects.length} مشروع — استخدم البحث لتصفية المعروض.`;
    sectionLoaded.projectsSection = true;
  } catch (error) {
    console.error(error);
    $("projectsMessage").innerText = `تعذر تحميل المشاريع: ${error.message}`;
  }
}

function renderProjects() {
  const term = $("projectsSearch").value;
  const template = $("projectsTemplateFilter").value;
  const filtered = projects.filter(project =>
    (template === "all" || project.template === template) &&
    containsSearch([project.projectDocId, project.ownerId, project.businessName, project.template], term)
  );

  $("projectsContainer").innerHTML = filtered.length ? filtered.map(project => {
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
          <button class="${active ? "secondaryBtn" : "primaryBtn"}" data-action="toggle-project" data-project="${escapeHTML(project.projectDocId)}" data-active="${active}">
            ${active ? "إيقاف المشروع" : "إعادة تفعيل المشروع"}
          </button>
          <button class="secondaryBtn" data-action="prepare-settlement" data-project="${escapeHTML(project.projectDocId)}">تسوية عمولات المشروع</button>
        </div>
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد مشاريع مطابقة.</div>';
}

async function loadOperators() {
  $("operatorsMessage").innerText = "جاري تحميل المشغّلين...";
  try {
    const snap = await getDocs(query(collection(db, "operators"), orderBy(documentId()), limit(ADMIN_LIST_LIMIT)));
    operators = snap.docs.map(item => ({ operatorId: item.id, ...item.data() }));
    renderOperators();
    $("operatorsMessage").innerText = `المعروض: ${operators.length} مشغّل.`;
    sectionLoaded.operatorsSection = true;
  } catch (error) {
    console.error(error);
    $("operatorsMessage").innerText = `تعذر تحميل المشغّلين: ${error.message}`;
  }
}

function renderOperators() {
  const term = $("operatorsSearch").value;
  const filtered = operators.filter(operator =>
    containsSearch([
      operator.operatorId, operator.projectId, operator.name, operator.contactName,
      operator.phone, operator.whatsapp, operator.authLoginEmail
    ], term)
  );

  $("operatorsContainer").innerHTML = filtered.length ? filtered.map(operator => {
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

async function loadAdminOrders() {
  $("ordersAdminMessage").innerText = "جاري تحميل آخر الطلبات...";
  try {
    const snap = await getDocs(
      query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(ADMIN_LIST_LIMIT))
    );
    adminOrders = snap.docs.map(item => ({ orderId: item.id, ...item.data() }));
    renderAdminOrders();
    $("ordersAdminMessage").innerText = `آخر ${adminOrders.length} طلب.`;
    sectionLoaded.ordersSection = true;
  } catch (error) {
    console.error(error);
    $("ordersAdminMessage").innerText = `تعذر تحميل الطلبات: ${error.message}`;
  }
}

function renderAdminOrders() {
  const term = $("ordersSearch").value;
  const status = $("ordersStatusFilter").value;
  const filtered = adminOrders.filter(order =>
    (status === "all" || order.status === status || order.laundryStage === status) &&
    containsSearch([order.orderId, order.projectId, order.customerName, order.customerPhone, order.templateType], term)
  );

  $("ordersTableBody").innerHTML = filtered.length ? filtered.map(order => `
    <tr>
      <td><b>#${escapeHTML(order.orderId.slice(0,8))}</b><br><small>${formatDate(order.createdAt,true)}</small></td>
      <td>${escapeHTML(order.templateType || "—")}<br><small class="codeText">${escapeHTML(order.projectId || "—")}</small></td>
      <td>${escapeHTML(order.customerName || "—")}<br><small>${escapeHTML(order.customerPhone || "")}</small></td>
      <td>${statusPill(order.status || order.laundryStage || "—")}<br><small>${escapeHTML(order.laundryStage || "")}</small></td>
      <td><b>${money(order.total ?? order.price ?? 0)}</b></td>
      <td>${order.commissionLocked ? `<b>${money(order.commissionAmount)}</b><br><small>${escapeHTML(order.commissionTrigger || "legacy")}</small>` : "—"}</td>
    </tr>
  `).join("") : '<tr><td colspan="6">لا توجد طلبات مطابقة.</td></tr>';
}

async function loadCommissions() {
  $("commissionsMessage").innerText = "جاري تحميل دفتر العمولات...";
  try {
    const snap = await getDocs(
      query(collection(db, "commissionLedger"), orderBy("createdAt", "desc"), limit(ADMIN_LIST_LIMIT))
    );
    commissions = snap.docs.map(item => ({ entryId: item.id, ...item.data() }));
    renderCommissions();
    $("commissionsMessage").innerText = `آخر ${commissions.length} قيد عمولة.`;
    sectionLoaded.commissionsSection = true;
  } catch (error) {
    console.error(error);
    $("commissionsMessage").innerText = `تعذر تحميل العمولات: ${error.message}`;
  }
}

function renderCommissions() {
  $("commissionsTableBody").innerHTML = commissions.length ? commissions.map(entry => `
    <tr>
      <td><b class="codeText">${escapeHTML(entry.entryId)}</b><br><small>${formatDate(entry.createdAt || entry.earnedAt,true)}</small></td>
      <td>${escapeHTML(entry.sourceType || "—")}<br><small class="codeText">${escapeHTML(entry.projectId || entry.sourceId || "—")}</small></td>
      <td><span class="codeText">${escapeHTML(entry.userId || "—")}</span></td>
      <td><b>${money(entry.amount)}</b></td>
      <td>${statusPill(entry.status || "earned")}</td>
      <td>${entry.settlementId ? `<span class="codeText">${escapeHTML(entry.settlementId.slice(0,12))}</span><br>${statusPill(entry.settlementStatus || "pending")}` : "غير مجمّعة"}</td>
    </tr>
  `).join("") : '<tr><td colspan="6">لا توجد قيود عمولة.</td></tr>';
}

async function loadSettlements() {
  $("settlementsMessage").innerText = "جاري تحميل التسويات...";
  try {
    settlements = await listRecentCommissionSettlements({ pageSize: ADMIN_LIST_LIMIT });
    renderSettlements();
    $("settlementsMessage").innerText = `المعروض: ${settlements.length} تسوية.`;
    sectionLoaded.settlementsSection = true;
  } catch (error) {
    console.error(error);
    $("settlementsMessage").innerText = `تعذر تحميل التسويات: ${error.message}`;
  }
}

function renderSettlements() {
  $("settlementsContainer").innerHTML = settlements.length ? settlements.map(item => {
    const pending = item.status === "pending";
    return `
      <article class="adminCard settlementCard ${escapeHTML(item.status || "")}" data-settlement="${escapeHTML(item.settlementId)}">
        <div class="cardHead">
          <div>
            <h3>${escapeHTML(item.businessName || item.templateId || "تسوية عمولات")}</h3>
            <p class="codeText">${escapeHTML(item.settlementId)}</p>
          </div>
          ${statusPill(item.status)}
        </div>
        <div class="metaGrid">
          <span>المشروع<br><b class="codeText">${escapeHTML(item.projectId)}</b></span>
          <span>عدد الطلبات<br><b>${Number(item.entryCount || 0).toLocaleString("ar-EG")}</b></span>
          <span>قيمة التسوية<br><b>${money(item.amount)}</b></span>
          <span>أُنشئت<br><b>${formatDate(item.createdAt,true)}</b></span>
          <span>طريقة الدفع<br><b>${escapeHTML(item.paymentMethod || "—")}</b></span>
          <span>مرجع الدفع<br><b>${escapeHTML(item.paymentReference || "—")}</b></span>
          <span>السداد<br><b>${formatDate(item.paidAt,true)}</b></span>
          <span>ملاحظة<br><b>${escapeHTML(item.note || "—")}</b></span>
        </div>
        ${pending ? `
          <div class="settlementActions">
            <select data-field="paymentMethod">
              <option value="instapay">InstaPay</option>
              <option value="bank_transfer">تحويل بنكي</option>
              <option value="cash">نقدي</option>
              <option value="other">أخرى</option>
            </select>
            <input data-field="paymentReference" maxlength="200" placeholder="رقم/مرجع التحويل - اختياري">
            <button class="primaryBtn" data-action="pay-settlement" data-settlement="${escapeHTML(item.settlementId)}">تأكيد السداد</button>
            <button class="dangerBtn" data-action="void-settlement" data-settlement="${escapeHTML(item.settlementId)}">إلغاء التسوية</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("") : '<div class="emptyState">لا توجد تسويات بعد.</div>';
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

document.querySelectorAll(".tabBtn").forEach(button => {
  button.addEventListener("click", () => switchSection(button.dataset.section));
});

$("refreshAllBtn").addEventListener("click", refreshLoadedSections);
$("refreshProjectsBtn").addEventListener("click", loadProjects);
$("refreshOperatorsBtn").addEventListener("click", loadOperators);
$("refreshOrdersAdminBtn").addEventListener("click", loadAdminOrders);
$("refreshCommissionsBtn").addEventListener("click", loadCommissions);
$("refreshSettlementsBtn").addEventListener("click", loadSettlements);

$("usersSearch").addEventListener("input", event => {
  currentSearch = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadUsers(), 300);
});
$("usersStatusFilter").addEventListener("change", event => {
  currentStatus = event.target.value;
  usersCursor = null;
  usersHasMore = false;
  loadUsers();
});
$("loadMoreUsersBtn").addEventListener("click", () => loadUsers({ append: true }));

$("projectsSearch").addEventListener("input", renderProjects);
$("projectsTemplateFilter").addEventListener("change", renderProjects);
$("operatorsSearch").addEventListener("input", renderOperators);
$("ordersSearch").addEventListener("input", renderAdminOrders);
$("ordersStatusFilter").addEventListener("change", renderAdminOrders);

$("usersContainer").addEventListener("click", async event => {
  const button = event.target.closest("[data-action][data-uid]");
  if (!button) return;
  button.disabled = true;

  try {
    if (button.dataset.action === "activate-user") {
      await activateOrRenewUser(button.dataset.uid);
      $("usersMessage").innerText = "تم تحديث الاشتراك بنجاح.";
    }
    if (button.dataset.action === "deactivate-user") {
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

  if (button.dataset.action === "prepare-settlement") {
    $("settlementProjectId").value = projectId;
    switchSection("commissionsSection");
    $("settlementProjectId").focus();
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

$("createSettlementBtn").addEventListener("click", async () => {
  const button = $("createSettlementBtn");
  const projectId = clean($("settlementProjectId").value);
  if (!projectId) {
    $("commissionsMessage").innerText = "اكتب Project ID أولًا.";
    return;
  }

  button.disabled = true;
  $("commissionsMessage").innerText = "جاري إنشاء كشف المستحقات...";

  try {
    const result = await createProjectCommissionSettlement({
      projectId,
      adminUid: adminSession.user.uid,
      note: $("settlementNote").value
    });

    $("commissionsMessage").innerText = result.hasMore
      ? `تم إنشاء تسوية لـ ${result.entryCount} طلب. ما زالت هناك قيود أخرى وستحتاج تسوية إضافية.`
      : `تم إنشاء التسوية بنجاح لـ ${result.entryCount} طلب.`;

    sectionLoaded.settlementsSection = false;
    await Promise.all([loadCommissions(), loadOverview(), loadSettlements()]);
    switchSection("settlementsSection");
  } catch (error) {
    console.error(error);
    $("commissionsMessage").innerText = `تعذر إنشاء التسوية: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

$("settlementsContainer").addEventListener("click", async event => {
  const button = event.target.closest("[data-action][data-settlement]");
  if (!button) return;

  const card = button.closest("[data-settlement]");
  const settlementId = button.dataset.settlement;
  button.disabled = true;

  try {
    if (button.dataset.action === "pay-settlement") {
      const paymentMethod = card.querySelector("[data-field='paymentMethod']").value;
      const paymentReference = card.querySelector("[data-field='paymentReference']").value;

      await markCommissionSettlementPaid({
        settlementId,
        adminUid: adminSession.user.uid,
        paymentMethod,
        paymentReference
      });

      $("settlementsMessage").innerText = "تم تسجيل السداد وتحديث كل قيود العمولة المرتبطة.";
    }

    if (button.dataset.action === "void-settlement") {
      const accepted = window.confirm("إلغاء هذه التسوية سيعيد قيود العمولة إلى المستحقات غير المجمعة. هل تريد الاستمرار؟");
      if (!accepted) return;

      await voidCommissionSettlement({
        settlementId,
        adminUid: adminSession.user.uid,
        note: "Voided from admin control center"
      });

      $("settlementsMessage").innerText = "تم إلغاء التسوية وإعادة القيود للمستحقات.";
    }

    await Promise.all([loadSettlements(), loadCommissions(), loadOverview()]);
  } catch (error) {
    console.error(error);
    $("settlementsMessage").innerText = `تعذر تنفيذ الإجراء: ${error.message}`;
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
