import db from "../core/firebase/firebase-db.js";
import { protectAdmin } from "../core/auth/admin-guard.js";
import {
  PLATFORM_BILLING,
  REFERRAL_CONFIG,
  formatEgp
} from "../core/config/platform-config.js";
import { escapeHTML } from "../core/utils/helpers.js";

import {
  collection,
  getDocs,
  getCountFromServer,
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

const usersContainer = document.getElementById("usersContainer");
const usersCount = document.getElementById("usersCount");
const usersSearch = document.getElementById("usersSearch");
const usersStatusFilter = document.getElementById("usersStatusFilter");
const usersMessage = document.getElementById("usersMessage");
const loadMoreUsersBtn = document.getElementById("loadMoreUsersBtn");

const USERS_PAGE_SIZE = 50;
const USERS_SEARCH_PAGE_SIZE = 100;

let users = [];
let usersCursor = null;
let usersHasMore = false;
let usersLoading = false;
let searchTimer = null;
let currentSearch = "";
let currentStatus = "all";

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

  document.getElementById("usersControls")?.classList.remove("hidden");
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

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

function matchesSearch(user, term) {
  const q = normalizeSearch(term);
  if (!q) return true;

  return normalizeSearch([
    user.uid,
    user.name,
    user.email
  ].filter(Boolean).join(" ")).includes(q);
}

function userQueryConstraints({
  status = "all",
  cursor = null,
  pageSize = USERS_PAGE_SIZE
} = {}) {
  const constraints = [];

  if (status !== "all") {
    constraints.push(where("subscriptionStatus", "==", status));
  }

  constraints.push(orderBy(documentId()));

  if (cursor) {
    constraints.push(startAfter(cursor));
  }

  constraints.push(limit(pageSize));
  return constraints;
}

async function listUsersPage(options = {}) {
  const snap = await getDocs(
    query(collection(db, "users"), ...userQueryConstraints(options))
  );

  return {
    users: snap.docs.map(item => ({ uid: item.id, ...item.data() })),
    nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === Math.max(
      1,
      Math.min(100, Number(options.pageSize) || USERS_PAGE_SIZE)
    )
  };
}

async function countUsers(status = "all") {
  const constraints = [];
  if (status !== "all") {
    constraints.push(where("subscriptionStatus", "==", status));
  }

  const snap = await getCountFromServer(
    query(collection(db, "users"), ...constraints)
  );

  return snap.data().count;
}

async function searchAllUsers(term, status = "all") {
  const matches = [];
  let cursor = null;
  while (true) {
    const page = await listUsersPage({
      status,
      cursor,
      pageSize: USERS_SEARCH_PAGE_SIZE
    });

    matches.push(...page.users.filter(user => matchesSearch(user, term)));
    if (!page.hasMore || !page.nextCursor) break;
    if (cursor && page.nextCursor.id === cursor.id) {
      throw new Error("USERS_PAGINATION_STALLED");
    }

    cursor = page.nextCursor;
  }

  return matches;
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
    const referrerId = /^[A-Za-z0-9_-]{1,128}$/.test(String(data.referredByUserId || ""))
      ? String(data.referredByUserId)
      : "";

    if (!initialAlreadyPaid && referrerId && referrerId !== uid) {
      referrerRef = doc(db, "users", referrerId);
      referralRef = doc(db, "referrals", `${referrerId}_${uid}`);

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

      transaction.update(userRef, {
        referralQualified: true
      });
    }
  });
}

function renderUsers() {
  if (!users.length) {
    usersContainer.innerHTML = '<p style="padding:20px;text-align:center;">لا توجد نتائج مطابقة.</p>';
    return;
  }

  usersContainer.innerHTML = users.map(user => {
    const initialAlreadyPaid = hasPaidInitialActivation(user);
    const nextAmount = initialAlreadyPaid
      ? PLATFORM_BILLING.monthlyRenewalFee
      : PLATFORM_BILLING.initialActivationFee;

    return `
      <article class="userCard" data-user="${escapeHTML(user.uid)}">
        <div class="userCardHead">
          <div>
            <h3>${escapeHTML(user.name || "بدون اسم")}</h3>
            <p>${escapeHTML(user.email || "")}</p>
          </div>
          <span class="statusPill">${escapeHTML(user.subscriptionStatus || "pending")}</span>
        </div>
        <div class="userMeta">
          <span>أول اشتراك: <b>${initialAlreadyPaid ? "تم" : "لم يتم"}</b></span>
          <span>انتهاء الاشتراك: <b>${formatDate(user.subscriptionExpiresAt)}</b></span>
          <span>الإحالة: <b>${user.referredByUserId ? "موجودة" : "لا يوجد"}</b></span>
          <span>المبلغ المطلوب الآن: <b>${formatEgp(nextAmount)}</b></span>
        </div>
        <div class="userActions">
          <button data-action="activate" data-uid="${escapeHTML(user.uid)}">
            ${initialAlreadyPaid
              ? `تأكيد تجديد ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)}`
              : `تفعيل أول مرة ${formatEgp(PLATFORM_BILLING.initialActivationFee)}`}
          </button>
          <button data-action="deactivate" data-uid="${escapeHTML(user.uid)}" class="secondaryBtn">
            إيقاف الاشتراك
          </button>
        </div>
      </article>
    `;
  }).join("");
}

async function loadUsers({ append = false } = {}) {
  if (usersLoading) return;

  const search = currentSearch.trim();
  if (search && search.length < 2) {
    usersMessage.innerText = "اكتب حرفين على الأقل للبحث في كل المستخدمين.";
    users = [];
    usersCursor = null;
    usersHasMore = false;
    loadMoreUsersBtn.classList.add("hidden");
    renderUsers();
    return;
  }

  usersLoading = true;
  loadMoreUsersBtn.disabled = true;
  usersMessage.innerText = search
    ? "جاري البحث في كل المستخدمين..."
    : (append ? "جاري تحميل المزيد..." : "جاري تحميل المستخدمين...");

  try {
    const total = await countUsers(currentStatus);

    if (search) {
      users = await searchAllUsers(search, currentStatus);
      usersCursor = null;
      usersHasMore = false;
      usersCount.innerText = `نتائج البحث: ${users.length} من ${total}`;
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
      usersCount.innerText = currentStatus === "all"
        ? `إجمالي المستخدمين: ${total}`
        : `إجمالي الحالة المحددة: ${total}`;
    }

    renderUsers();
    usersMessage.innerText = users.length
      ? `المعروض الآن: ${users.length}`
      : "لا توجد نتائج مطابقة.";
    loadMoreUsersBtn.classList.toggle("hidden", !usersHasMore || Boolean(search));
  } catch (error) {
    console.error(error);
    usersMessage.innerText = `تعذر تحميل المستخدمين: ${error.message}`;
  } finally {
    usersLoading = false;
    loadMoreUsersBtn.disabled = false;
  }
}

usersSearch?.addEventListener("input", event => {
  currentSearch = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadUsers(), 300);
});

usersStatusFilter?.addEventListener("change", event => {
  currentStatus = event.target.value;
  usersCursor = null;
  usersHasMore = false;
  loadUsers();
});

loadMoreUsersBtn?.addEventListener("click", () => {
  loadUsers({ append: true });
});

usersContainer?.addEventListener("click", async event => {
  const button = event.target.closest("[data-action][data-uid]");
  if (!button) return;

  const uid = button.dataset.uid;
  const action = button.dataset.action;
  button.disabled = true;

  try {
    if (action === "activate") {
      await activateOrRenewUser(uid);
      alert("تم تحديث الاشتراك بنجاح");
    }

    if (action === "deactivate") {
      await updateDoc(
        doc(db, "users", uid),
        {
          isActive: false,
          subscriptionStatus: "inactive"
        }
      );
      alert("تم إيقاف الاشتراك");
    }

    await loadUsers();
  } catch (error) {
    console.error(error);
    alert(action === "activate" ? "تعذر تحديث الاشتراك" : "تعذر إيقاف الاشتراك");
  } finally {
    button.disabled = false;
  }
});
