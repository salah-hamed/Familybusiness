function text(value) {
  return String(value ?? "").trim();
}

export function normalizeWhatsAppPhone(value) {
  const digits = text(value).replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("20")) return digits;
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  if (/^1\d{9}$/.test(digits)) return `20${digits}`;

  return digits;
}

function mapsUrl(order = {}) {
  const direct = text(order.location);

  if (direct.startsWith("http://") || direct.startsWith("https://")) {
    return direct;
  }

  const lat = Number(order.lat ?? order.latitude ?? order.location?.lat);
  const lng = Number(order.lng ?? order.longitude ?? order.location?.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }

  return "";
}

function addLine(lines, label, value) {
  const normalized = text(value);
  if (normalized) lines.push(`${label}: ${normalized}`);
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toLocaleString("ar-EG")} جنيه` : "";
}

function orderItems(order = {}) {
  if (!Array.isArray(order.items)) return "";

  return order.items
    .filter(item => Number(item?.quantity || 0) > 0)
    .map(item => {
      const quantity = Number(item.quantity || 0);
      const name = text(item.name || item.productName || item.label || item.key || "صنف");
      const service = text(item.serviceLabel || item.service);
      const unitPrice = Number(item.unitPrice);
      const subtotal = Number(item.subtotal);
      const details = [];

      if (service) details.push(service);
      if (Number.isFinite(unitPrice)) details.push(`${formatMoney(unitPrice)} للوحدة`);
      if (Number.isFinite(subtotal)) details.push(`الإجمالي ${formatMoney(subtotal)}`);

      return `${quantity} × ${name}${details.length ? ` — ${details.join(" — ")}` : ""}`;
    })
    .join("\n");
}

function orderTotal(order = {}) {
  if (order.total != null) return formatMoney(order.total);
  if (order.price != null) return formatMoney(order.price);
  return "";
}

export function buildWorkerDispatchMessage({
  templateId,
  orderId,
  order = {},
  worker = {},
  businessName = ""
}) {
  const lines = [
    "طلب توصيل من Family Business",
    `رقم الطلب: ${text(orderId) || "-"}`
  ];

  addLine(lines, "النشاط", businessName || order.businessName);
  addLine(lines, "المندوب", worker.name);
  addLine(lines, "العميل", order.customerName);
  addLine(lines, "رقم العميل", order.customerPhone);
  addLine(lines, "العنوان", order.customerAddress || order.address);

  const location = mapsUrl(order);
  if (location) lines.push(`الموقع: ${location}`);

  if (templateId === "cleaning") {
    addLine(lines, "التاريخ", order.visitDate);
    addLine(lines, "الوقت", order.visitTime);
    addLine(lines, "الغرف", order.rooms);
    addLine(lines, "الحمامات", order.bathrooms);
    addLine(lines, "المطبخ", order.kitchen);
    addLine(lines, "السلالم", order.stairs);
    addLine(lines, "الحساب", orderTotal(order));
  } else if (["supermarket", "restaurant", "bakery"].includes(templateId)) {
    const items = orderItems(order);
    if (items) {
      lines.push("تفاصيل الطلب:");
      lines.push(items);
    }

    addLine(lines, "قيمة المنتجات", order.subtotal != null ? formatMoney(order.subtotal) : "");
    addLine(lines, "التوصيل", order.deliveryFee != null ? formatMoney(order.deliveryFee) : "");
    addLine(lines, "إجمالي التحصيل", orderTotal(order));
  } else if (templateId === "laundry") {
    const items = orderItems(order);
    if (items) {
      lines.push("تفاصيل القطع:");
      lines.push(items);
    }

    addLine(lines, "موعد الاستلام", order.pickupTime || order.visitTime);
    addLine(lines, "إجمالي التحصيل", orderTotal(order));
  } else {
    addLine(lines, "الحساب", orderTotal(order));
  }

  addLine(lines, "ملاحظات", order.notes);

  return lines.join("\n");
}

export function buildWorkerWhatsAppUrl({
  templateId,
  orderId,
  order,
  worker,
  businessName = ""
}) {
  const phone = normalizeWhatsAppPhone(worker?.whatsapp || worker?.phone);

  if (!phone) {
    throw new Error("WORKER_WHATSAPP_REQUIRED");
  }

  const message = buildWorkerDispatchMessage({
    templateId,
    orderId,
    order,
    worker,
    businessName
  });

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function openWhatsAppPlaceholder() {
  try {
    return window.open("about:blank", "_blank");
  } catch {
    return null;
  }
}

export function navigatePreparedWhatsAppWindow(popup, url) {
  if (!popup || popup.closed) return false;

  try {
    popup.opener = null;
    popup.location.href = url;
    return true;
  } catch {
    try {
      popup.close();
    } catch {
      // Ignore close failures.
    }
    return false;
  }
}

export function openWorkerWhatsAppDispatch(payload) {
  const url = buildWorkerWhatsAppUrl(payload);
  const popup = window.open(url, "_blank", "noopener");
  return { url, opened: Boolean(popup) };
}
