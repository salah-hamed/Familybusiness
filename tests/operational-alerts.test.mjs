import test from "node:test";
import assert from "node:assert/strict";
import {
  getOperationalStage,
  getOrderOperationalAlert,
  summarizeOperationalAlerts
} from "../core/orders/operational-alerts.js";

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const ts = minutesAgo => ({ seconds: Math.floor((NOW - minutesAgo * 60_000) / 1000) });

test("new food order is not stale before threshold", () => {
  assert.equal(getOrderOperationalAlert({
    templateType: "restaurant",
    status: "new",
    createdAt: ts(14)
  }, NOW), null);
});

test("new order becomes warning after threshold", () => {
  const alert = getOrderOperationalAlert({
    templateType: "supermarket",
    status: "new",
    createdAt: ts(16)
  }, NOW);
  assert.equal(alert?.stage, "new");
  assert.equal(alert?.level, "warning");
  assert.match(alert?.message || "", /16 دقيقة/);
});

test("active order age uses latest status update instead of original creation", () => {
  assert.equal(getOrderOperationalAlert({
    templateType: "restaurant",
    status: "preparing",
    createdAt: ts(180),
    statusUpdatedAt: ts(10)
  }, NOW), null);
});

test("food order becomes critical at twice its stage threshold", () => {
  const alert = getOrderOperationalAlert({
    templateType: "bakery",
    status: "ready",
    createdAt: ts(120),
    statusUpdatedAt: ts(31)
  }, NOW);
  assert.equal(alert?.level, "critical");
});

test("laundry uses laundryStage and longer operating thresholds", () => {
  const order = {
    templateType: "laundry",
    status: "accepted",
    laundryStage: "processing",
    createdAt: ts(2000),
    statusUpdatedAt: ts(300)
  };
  assert.equal(getOperationalStage(order), "processing");
  assert.equal(getOrderOperationalAlert(order, NOW), null);
  assert.equal(getOrderOperationalAlert({...order, statusUpdatedAt: ts(1500)}, NOW)?.stage, "processing");
});

test("terminal orders never create stale alerts", () => {
  for (const status of ["delivered", "done", "canceled"]) {
    assert.equal(getOrderOperationalAlert({
      templateType: "supermarket",
      status,
      createdAt: ts(500)
    }, NOW), null);
  }
});

test("summary exposes actionable count and critical count", () => {
  assert.equal(summarizeOperationalAlerts([]), "");
  const text = summarizeOperationalAlerts([{level:"warning"},{level:"critical"}]);
  assert.match(text, /2/);
  assert.match(text, /1 متأخر جدًا/);
});
