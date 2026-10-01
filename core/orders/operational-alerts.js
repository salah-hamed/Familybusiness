const MINUTE = 60 * 1000;

const DEFAULT_POLICY = Object.freeze({
  new: { minutes: 15, label: "طلب جديد لم يُقبل" },
  accepted: { minutes: 20, label: "طلب مقبول ينتظر بدء التنفيذ" },
  preparing: { minutes: 45, label: "التحضير متوقف" },
  ready: { minutes: 15, label: "الطلب جاهز وينتظر التوصيل" },
  assigned: { minutes: 15, label: "تم تعيين المندوب ولم يبدأ التوصيل" },
  out_for_delivery: { minutes: 60, label: "التوصيل متأخر" }
});

const LAUNDRY_POLICY = Object.freeze({
  new: { minutes: 30, label: "طلب جديد لم يُقبل" },
  accepted: { minutes: 60, label: "طلب مقبول ينتظر تعيين الاستلام" },
  pickup_assigned: { minutes: 60, label: "مندوب الاستلام لم يؤكد الاستلام" },
  picked_up: { minutes: 240, label: "تم الاستلام ولم يبدأ التجهيز" },
  processing: { minutes: 1440, label: "التجهيز بالمغسلة متأخر" },
  ready_delivery: { minutes: 60, label: "الطلب جاهز وينتظر مندوب التوصيل" },
  out_for_delivery: { minutes: 120, label: "التوصيل متأخر" }
});

const TERMINAL_STATUSES = new Set(["delivered", "done", "canceled"]);

function timestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function getOperationalStage(order = {}) {
  if (TERMINAL_STATUSES.has(order.status)) return "";
  if (order.templateType === "laundry" && order.status === "accepted" && order.laundryStage) {
    return order.laundryStage;
  }
  return order.status || order.laundryStage || "";
}

export function getOperationalAlertPolicy(order = {}) {
  const stage = getOperationalStage(order);
  if (!stage) return null;
  const policy = order.templateType === "laundry" ? LAUNDRY_POLICY : DEFAULT_POLICY;
  return policy[stage] ? { stage, ...policy[stage] } : null;
}

function formatAge(ageMinutes) {
  if (ageMinutes < 60) return `${ageMinutes} دقيقة`;
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  return minutes ? `${hours} ساعة و${minutes} دقيقة` : `${hours} ساعة`;
}

export function getOrderOperationalAlert(order = {}, now = Date.now()) {
  const policy = getOperationalAlertPolicy(order);
  if (!policy) return null;

  const baseTime = policy.stage === "new"
    ? timestampMillis(order.createdAt)
    : timestampMillis(order.statusUpdatedAt) ?? timestampMillis(order.createdAt);

  if (!Number.isFinite(baseTime)) return null;

  const ageMinutes = Math.max(0, Math.floor((Number(now) - baseTime) / MINUTE));
  if (ageMinutes < policy.minutes) return null;

  const level = ageMinutes >= policy.minutes * 2 ? "critical" : "warning";

  return {
    stage: policy.stage,
    level,
    ageMinutes,
    thresholdMinutes: policy.minutes,
    message: `⚠️ ${policy.label} منذ ${formatAge(ageMinutes)} — يحتاج متابعة.`
  };
}

export function summarizeOperationalAlerts(alerts = []) {
  const valid = alerts.filter(Boolean);
  if (!valid.length) return "";
  const critical = valid.filter(alert => alert.level === "critical").length;
  const criticalText = critical ? `، منها ${critical} متأخر جدًا` : "";
  return `⚠️ يوجد ${valid.length} طلب متأخر يحتاج متابعة الآن${criticalText}.`;
}
