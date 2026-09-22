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

function supermarketItems(order = {}) {
  if (!Array.isArray(order.items)) return "";

  return order.items
    .filter(item => Number(item?.quantity || 0) > 0)
    .map(item => {
      const quantity = Number(item.quantity || 0);
      const name = text(item.name || item.productName || item.key || "منتج");
      return `${quantity} × ${name}`;
    })
    .join("\n");
}

function laundryItems(order = {}) {
  if (!Array.isArray(order.items)) return "";

  return order.items
    .filter(item => Number(item?.quantity || 0) > 0)
    .map(item => {
      const quantity = Number(item.quantity || 0);
      const name = text(item.label || item.name || item.key || "قطعة");
      const service = text(item.service);
      return `${quantity} × ${name}${service ? ` — ${service}` : ""}`;
    })
    .join("\n");
}

export function buildWorkerDispatchMessage({
  templateId,
  orderId,
  order = {},
  worker = {}
}) {
  const lines = [
    "طلب جديد من Family Business",
    `رقم الطلب: ${text(orderId) || "-"}`
  ];

  addLine(lines, "المسؤول", worker.name);
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
    addLine(lines, "الحساب", order.price != null ? `${order.price} جنيه` : "");
    addLine(lines, "ملاحظات", order.notes);
  } else if (templateId === "supermarket") {
    const items = supermarketItems(order);
    if (items) {
      lines.push("تفاصيل الطلب:");
      lines.push(items);
    }

    addLine(
      lines,
      "إجمالي التحصيل",
      order.total != null
        ? `${order.total} جنيه`
        : order.price != null
          ? `${order.price} جنيه`
          : ""
    );
    addLine(lines, "ملاحظات", order.notes);
  } else if (templateId === "laundry") {
    const items = laundryItems(order);
    if (items) {
      lines.push("تفاصيل القطع:");
      lines.push(items);
    }

    addLine(lines, "موعد الاستلام", order.pickupTime || order.visitTime);
    addLine(lines, "الحساب", order.price != null ? `${order.price} جنيه` : "");
    addLine(lines, "ملاحظات", order.notes);
  } else {
    addLine(lines, "الحساب", order.price != null ? `${order.price} جنيه` : "");
    addLine(lines, "ملاحظات", order.notes);
  }

  return lines.join("\n");
}

export function buildWorkerWhatsAppUrl({
  templateId,
  orderId,
  order,
  worker
}) {
  const phone = normalizeWhatsAppPhone(worker?.whatsapp || worker?.phone);

  if (!phone) {
    throw new Error("WORKER_WHATSAPP_REQUIRED");
  }

  const message = buildWorkerDispatchMessage({
    templateId,
    orderId,
    order,
    worker
  });

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function openWorkerWhatsAppDispatch(payload) {
  const url = buildWorkerWhatsAppUrl(payload);
  window.open(url, "_blank", "noopener");
  return url;
}
