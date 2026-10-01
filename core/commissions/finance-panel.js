import {
  getProjectPaymentSummary,
  listProjectPaymentRequests,
  declareOperatorPayment,
  confirmOwnerPayment,
  rejectOwnerPayment
} from "./settlement-service.js";
import {
  listProjectCommissionReversals,
  confirmCommissionReversal,
  rejectCommissionReversal
} from "./reversal-service.js";

function money(value) {
  return `${Number(value || 0).toLocaleString("ar-EG")} جنيه`;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function dateText(value) {
  if (!value) return "—";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function statusText(status) {
  return ({
    pending_owner_confirmation: "بانتظار تأكيد المشترك",
    confirmed: "تم التأكيد",
    rejected: "مرفوض",
    paid: "مدفوع - نظام سابق"
  })[status] || status || "—";
}

function ensureStyles() {
  if (document.getElementById("commissionFinancePanelStyles")) return;

  const style = document.createElement("style");
  style.id = "commissionFinancePanelStyles";
  style.textContent = `
    .fbFinancePanel{margin:14px 0;padding:16px;border:1px solid #dce7df;border-radius:18px;background:#fff;box-shadow:0 6px 20px rgba(22,61,38,.05)}
    .fbFinanceHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
    .fbFinanceHead h2{margin:3px 0 4px;font-size:20px}.fbFinanceHead p{margin:0;color:#66756b;font-size:13px;line-height:1.6}
    .fbFinanceGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}
    .fbFinanceStat{padding:12px;border-radius:13px;background:#f6f9f7;border:1px solid #e2e9e4}
    .fbFinanceStat span{display:block;color:#6b756e;font-size:12px}.fbFinanceStat b{display:block;margin-top:5px;font-size:19px}
    .fbFinanceDue{background:#fff7df;border-color:#f2dda2}.fbFinancePaid{background:#edf8f1;border-color:#cce8d5}
    .fbFinanceForm{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
    .fbFinanceForm input,.fbFinanceForm select{width:100%;padding:10px 11px;border:1px solid #cbd8cf;border-radius:10px;background:#fff;font:inherit}
    .fbFinanceForm .fbWide{grid-column:1/-1}.fbFinanceActions{display:flex;gap:8px;flex-wrap:wrap}
    .fbFinanceBtn{border:0;border-radius:10px;padding:10px 13px;font:inherit;font-weight:800;cursor:pointer;background:#176a38;color:#fff}
    .fbFinanceBtn.secondary{background:#e8eeea;color:#26352b}.fbFinanceBtn.danger{background:#8a3131;color:#fff}
    .fbFinanceMessage{min-height:22px;margin:8px 0;color:#5e6b62;font-size:13px}
    .fbPaymentList{display:grid;gap:8px;margin-top:10px}.fbPaymentItem{padding:11px;border:1px solid #e2e9e4;border-radius:12px;background:#fafcfa}
    .fbPaymentTop{display:flex;justify-content:space-between;gap:10px;align-items:center}.fbPaymentTop strong{font-size:16px}
    .fbPaymentMeta{margin-top:5px;color:#68756c;font-size:12px;line-height:1.65}
    .fbPendingBox{padding:12px;border-radius:12px;background:#fff8df;border:1px solid #ecd99c;margin:10px 0}
    @media(max-width:650px){.fbFinanceGrid,.fbFinanceForm{grid-template-columns:1fr}.fbFinanceForm .fbWide{grid-column:auto}.fbFinanceHead,.fbPaymentTop{flex-direction:column;align-items:stretch}}
  `;
  document.head.appendChild(style);
}

function panelRoot(container, role) {
  ensureStyles();
  const id = `commissionFinancePanel_${role}`;
  let root = document.getElementById(id);

  if (!root) {
    root = document.createElement("section");
    root.id = id;
    root.className = "fbFinancePanel";
    const anchor = container.querySelector(".statGrid, .stats");
    if (anchor?.nextSibling) {
      anchor.parentNode.insertBefore(root, anchor.nextSibling);
    } else if (anchor) {
      anchor.parentNode.appendChild(root);
    } else {
      container.prepend(root);
    }
  }

  return root;
}

function reversalReasonText(reason) {
  return ({
    customer_canceled_after_dispatch: "العميل ألغى بعد الإرسال للتوصيل",
    delivery_failed: "تعذر التوصيل",
    duplicate_order: "طلب مكرر",
    operator_error: "خطأ تشغيلي",
    other: "سبب آخر"
  })[reason] || reason || "—";
}

function renderReversalHistory(items) {
  if (!items.length) {
    return '<div class="fbPaymentItem">لا توجد طلبات عكس عمولة حتى الآن.</div>';
  }

  return items.slice(0, 6).map(item => `
    <div class="fbPaymentItem">
      <div class="fbPaymentTop">
        <strong>${money(item.amount)}</strong>
        <span>${esc(statusText(item.status))}</span>
      </div>
      <div class="fbPaymentMeta">
        طلب #${esc(String(item.orderId || "").slice(0, 8))} · ${esc(reversalReasonText(item.reasonCode))}
        ${item.note ? `<br>${esc(item.note)}` : ""}
        <br>${dateText(item.createdAt || item.requestedAt)}
      </div>
    </div>
  `).join("");
}

function renderHistory(items) {
  if (!items.length) {
    return '<div class="fbPaymentItem">لا توجد عمليات دفع مسجلة حتى الآن.</div>';
  }

  return items.slice(0, 6).map(item => `
    <div class="fbPaymentItem">
      <div class="fbPaymentTop">
        <strong>${money(item.amount)}</strong>
        <span>${esc(statusText(item.status))}</span>
      </div>
      <div class="fbPaymentMeta">
        ${esc(item.paymentMethod || "طريقة دفع غير محددة")}
        ${item.paymentReference ? ` · مرجع: ${esc(item.paymentReference)}` : ""}
        <br>${dateText(item.createdAt || item.declaredAt)}
      </div>
    </div>
  `).join("");
}

export async function renderOwnerFinancePanel({
  container,
  projectId,
  ownerId,
  onBalanceChanged = null
}) {
  if (!container || !projectId || !ownerId) return;

  const root = panelRoot(container, "owner");
  root.innerHTML = '<p class="fbFinanceMessage">جاري تحميل حساب العمولة...</p>';

  try {
    const [summary, payments, reversals] = await Promise.all([
      getProjectPaymentSummary(projectId, { ownerId }),
      listProjectPaymentRequests(projectId, { pageSize: 20 }),
      listProjectCommissionReversals(projectId, { pageSize: 20 })
    ]);

    const pending = payments.find(item => item.status === "pending_owner_confirmation");
    const pendingReversals = reversals.filter(item => item.status === "pending_owner_confirmation");

    root.innerHTML = `
      <div class="fbFinanceHead">
        <div>
          <span>الحساب بينك وبين المشغّل</span>
          <h2>العمولة والسداد</h2>
          <p>المبلغ المستحق يقل فقط بعد ما المشغّل يسجل الدفع وأنت تؤكد استلامه.</p>
        </div>
      </div>
      <div class="fbFinanceGrid">
        <div class="fbFinanceStat"><span>إجمالي العمولة</span><b>${money(summary.earnedAmount)}</b></div>
        <div class="fbFinanceStat fbFinancePaid"><span>تم تأكيد استلامه</span><b>${money(summary.paidAmount)}</b></div>
        <div class="fbFinanceStat fbFinanceDue"><span>المتبقي لك</span><b>${money(summary.outstandingAmount)}</b></div>
      </div>
      ${pending ? `
        <div class="fbPendingBox">
          <b>المشغّل سجل إنه دفع لك ${money(pending.amount)}</b>
          <div class="fbPaymentMeta">
            الطريقة: ${esc(pending.paymentMethod || "—")}
            ${pending.paymentReference ? ` · المرجع: ${esc(pending.paymentReference)}` : ""}
            <br>${dateText(pending.createdAt || pending.declaredAt)}
          </div>
          <div class="fbFinanceActions" style="margin-top:10px">
            <button class="fbFinanceBtn" data-finance-action="confirm" data-id="${esc(pending.settlementId)}">تأكيد استلام المبلغ</button>
            <button class="fbFinanceBtn danger" data-finance-action="reject" data-id="${esc(pending.settlementId)}">لم أستلم المبلغ</button>
          </div>
        </div>
      ` : '<div class="fbFinanceMessage">لا توجد دفعة بانتظار تأكيدك الآن.</div>'}
      <h3>طلبات عكس العمولة</h3>
      ${pendingReversals.length ? pendingReversals.map(item => `
        <div class="fbPendingBox">
          <b>المشغّل طلب عكس عمولة ${money(item.amount)} عن الطلب #${esc(String(item.orderId || "").slice(0, 8))}</b>
          <div class="fbPaymentMeta">
            السبب: ${esc(reversalReasonText(item.reasonCode))}
            ${item.note ? `<br>${esc(item.note)}` : ""}
          </div>
          <div class="fbFinanceActions" style="margin-top:10px">
            <button class="fbFinanceBtn" data-reversal-action="confirm" data-id="${esc(item.reversalId)}">موافقة على عكس العمولة</button>
            <button class="fbFinanceBtn danger" data-reversal-action="reject" data-id="${esc(item.reversalId)}">رفض طلب العكس</button>
          </div>
        </div>
      `).join("") : '<div class="fbFinanceMessage">لا توجد طلبات عكس عمولة بانتظار قرارك.</div>'}
      <div class="fbPaymentList">${renderReversalHistory(reversals)}</div>
      <h3>طلبات عكس العمولة</h3>
      <div class="fbPaymentList">${renderReversalHistory(reversals)}</div>
      <h3>آخر عمليات الدفع</h3>
      <div class="fbPaymentList">${renderHistory(payments)}</div>
      <p class="fbFinanceMessage" data-finance-message></p>
    `;

    root.querySelectorAll("[data-reversal-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const message = root.querySelector("[data-finance-message]");
        button.disabled = true;

        try {
          if (button.dataset.reversalAction === "confirm") {
            message.textContent = "جاري عكس العمولة...";
            await confirmCommissionReversal({
              reversalId: button.dataset.id,
              ownerUid: ownerId
            });
            message.textContent = "تم تأكيد عكس العمولة وتحديث الرصيد.";
          } else {
            message.textContent = "جاري رفض طلب العكس...";
            await rejectCommissionReversal({
              reversalId: button.dataset.id,
              ownerUid: ownerId
            });
            message.textContent = "تم رفض طلب عكس العمولة.";
          }

          if (typeof onBalanceChanged === "function") {
            await onBalanceChanged();
          }

          await renderOwnerFinancePanel({
            container,
            projectId,
            ownerId,
            onBalanceChanged
          });
        } catch (error) {
          message.textContent = `تعذر تنفيذ الإجراء: ${error.message}`;
        } finally {
          button.disabled = false;
        }
      });
    });

    root.querySelectorAll("[data-finance-action]").forEach(button => {
      button.addEventListener("click", async () => {
        const message = root.querySelector("[data-finance-message]");
        button.disabled = true;

        try {
          if (button.dataset.financeAction === "confirm") {
            message.textContent = "جاري تأكيد الاستلام...";
            await confirmOwnerPayment({
              settlementId: button.dataset.id,
              ownerUid: ownerId
            });
            message.textContent = "تم تأكيد الاستلام وتحديث الرصيد.";
          } else {
            message.textContent = "جاري رفض عملية الدفع...";
            await rejectOwnerPayment({
              settlementId: button.dataset.id,
              ownerUid: ownerId
            });
            message.textContent = "تم تسجيل أن المبلغ لم يتم استلامه.";
          }

          if (typeof onBalanceChanged === "function") {
            await onBalanceChanged();
          }
          await renderOwnerFinancePanel({
            container,
            projectId,
            ownerId,
            onBalanceChanged
          });
        } catch (error) {
          message.textContent = `تعذر تنفيذ الإجراء: ${error.message}`;
        } finally {
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    root.innerHTML = `<p class="fbFinanceMessage">تعذر تحميل حساب العمولة: ${esc(error.message)}</p>`;
  }
}

export async function renderOperatorFinancePanel({
  container,
  projectId,
  operatorUid
}) {
  if (!container || !projectId || !operatorUid) return;

  const root = panelRoot(container, "operator");
  root.innerHTML = '<p class="fbFinanceMessage">جاري تحميل حساب العمولة...</p>';

  try {
    const [summary, payments, reversals] = await Promise.all([
      getProjectPaymentSummary(projectId),
      listProjectPaymentRequests(projectId, { pageSize: 20 }),
      listProjectCommissionReversals(projectId, { pageSize: 20 })
    ]);

    const pending = payments.find(item => item.status === "pending_owner_confirmation");
    const defaultAmount = summary.outstandingAmount > 0
      ? summary.outstandingAmount
      : "";

    root.innerHTML = `
      <div class="fbFinanceHead">
        <div>
          <span>حساب العمولة مع صاحب المشروع</span>
          <h2>المستحق والسداد</h2>
          <p>لو حولت مبلغ لصاحب المشروع سجله هنا. الرصيد لا يتغير إلا بعد ما يؤكد استلامه.</p>
        </div>
      </div>
      <div class="fbFinanceGrid">
        <div class="fbFinanceStat"><span>إجمالي العمولة</span><b>${money(summary.earnedAmount)}</b></div>
        <div class="fbFinanceStat fbFinancePaid"><span>تم تأكيد سداده</span><b>${money(summary.paidAmount)}</b></div>
        <div class="fbFinanceStat fbFinanceDue"><span>المطلوب سداده</span><b>${money(summary.outstandingAmount)}</b></div>
      </div>
      ${pending ? `
        <div class="fbPendingBox">
          <b>تم تسجيل دفعة ${money(pending.amount)}</b>
          <div class="fbPaymentMeta">
            في انتظار تأكيد صاحب المشروع.
            ${pending.paymentReference ? ` · المرجع: ${esc(pending.paymentReference)}` : ""}
          </div>
        </div>
      ` : summary.outstandingAmount > 0 ? `
        <div class="fbFinanceForm">
          <input data-payment-amount type="number" min="0.01" step="0.01" value="${defaultAmount}" placeholder="المبلغ الذي تم تحويله">
          <select data-payment-method>
            <option value="instapay">InstaPay</option>
            <option value="bank_transfer">تحويل بنكي</option>
            <option value="cash">نقدي</option>
            <option value="other">أخرى</option>
          </select>
          <input class="fbWide" data-payment-reference maxlength="200" placeholder="مرجع التحويل أو ملاحظة - اختياري">
        </div>
        <div class="fbFinanceActions">
          <button class="fbFinanceBtn" data-finance-action="declare">تم سداد هذا المبلغ</button>
        </div>
      ` : '<div class="fbFinanceMessage">لا توجد عمولات مستحقة الآن.</div>'}
      <h3>آخر عمليات الدفع</h3>
      <div class="fbPaymentList">${renderHistory(payments)}</div>
      <p class="fbFinanceMessage" data-finance-message></p>
    `;

    const declareButton = root.querySelector("[data-finance-action='declare']");
    if (declareButton) {
      declareButton.addEventListener("click", async () => {
        const message = root.querySelector("[data-finance-message]");
        declareButton.disabled = true;

        try {
          const amount = root.querySelector("[data-payment-amount]").value;
          const paymentMethod = root.querySelector("[data-payment-method]").value;
          const paymentReference = root.querySelector("[data-payment-reference]").value;

          message.textContent = "جاري تسجيل عملية الدفع...";

          await declareOperatorPayment({
            projectId,
            operatorUid,
            amount,
            paymentMethod,
            paymentReference
          });

          message.textContent = "تم تسجيل الدفع. في انتظار تأكيد صاحب المشروع.";
          await renderOperatorFinancePanel({
            container,
            projectId,
            operatorUid
          });
        } catch (error) {
          message.textContent = `تعذر تسجيل الدفع: ${error.message}`;
        } finally {
          declareButton.disabled = false;
        }
      });
    }
  } catch (error) {
    root.innerHTML = `<p class="fbFinanceMessage">تعذر تحميل حساب العمولة: ${esc(error.message)}</p>`;
  }
}
