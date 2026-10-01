import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkerDispatchMessage,
  buildWorkerWhatsAppUrl,
  normalizeWhatsAppPhone
} from "../core/whatsapp/dispatch-service.js";

test("bakery dispatch includes business, products, quantities, pricing and totals", () => {
  const message = buildWorkerDispatchMessage({
    templateId: "bakery",
    orderId: "bakery_order_1",
    businessName: "مخبز النور",
    worker: { name: "أحمد" },
    order: {
      customerName: "محمد",
      customerPhone: "01000000000",
      customerAddress: "حدائق أكتوبر",
      items: [
        {
          name: "فينو",
          quantity: 2,
          unitPrice: 5,
          subtotal: 10
        },
        {
          name: "باتيه",
          quantity: 1,
          unitPrice: 12,
          subtotal: 12
        }
      ],
      subtotal: 22,
      deliveryFee: 8,
      total: 30,
      notes: "الاتصال قبل الوصول"
    }
  });

  for (const expected of [
    "مخبز النور",
    "2 × فينو",
    "5 جنيه للوحدة",
    "الإجمالي 10 جنيه",
    "1 × باتيه",
    "قيمة المنتجات: 22 جنيه",
    "التوصيل: 8 جنيه",
    "إجمالي التحصيل: 30 جنيه",
    "الاتصال قبل الوصول"
  ]) {
    assert.equal(message.includes(expected), true, expected);
  }
});

test("supermarket and restaurant dispatch keep full item details", () => {
  for (const templateId of ["supermarket", "restaurant"]) {
    const message = buildWorkerDispatchMessage({
      templateId,
      orderId: `${templateId}_1`,
      businessName: "نشاط اختبار",
      worker: { name: "مندوب" },
      order: {
        customerName: "عميل",
        customerPhone: "01111111111",
        items: [{
          productName: "منتج اختبار",
          quantity: 3,
          unitPrice: 7,
          subtotal: 21
        }],
        deliveryFee: 4,
        total: 25
      }
    });

    assert.equal(message.includes("3 × منتج اختبار"), true, templateId);
    assert.equal(message.includes("7 جنيه للوحدة"), true, templateId);
    assert.equal(message.includes("إجمالي التحصيل: 25 جنيه"), true, templateId);
  }
});

test("laundry dispatch includes pieces, service and collection total", () => {
  const message = buildWorkerDispatchMessage({
    templateId: "laundry",
    orderId: "laundry_1",
    businessName: "مغسلة النور",
    worker: { name: "سعيد" },
    order: {
      customerName: "عميل",
      customerPhone: "01222222222",
      items: [{
        label: "قميص",
        serviceLabel: "غسيل + مكواة",
        quantity: 2,
        unitPrice: 15,
        subtotal: 30
      }],
      pickupTime: "6 مساءً",
      price: 30
    }
  });

  assert.equal(message.includes("2 × قميص"), true);
  assert.equal(message.includes("غسيل + مكواة"), true);
  assert.equal(message.includes("موعد الاستلام: 6 مساءً"), true);
  assert.equal(message.includes("إجمالي التحصيل: 30 جنيه"), true);
});

test("WhatsApp URL keeps Egyptian phone normalization and encoded message", () => {
  assert.equal(normalizeWhatsAppPhone("0100 123 4567"), "201001234567");

  const url = buildWorkerWhatsAppUrl({
    templateId: "bakery",
    orderId: "order_1",
    businessName: "مخبز",
    worker: { name: "مندوب", whatsapp: "01001234567" },
    order: {
      customerName: "عميل",
      items: [{ name: "فينو", quantity: 1 }],
      total: 20
    }
  });

  assert.equal(url.startsWith("https://wa.me/201001234567?text="), true);
  assert.equal(decodeURIComponent(url).includes("1 × فينو"), true);
});
