import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAuthGuide,
  buildWorkspaceGuide,
  buildPartnerProjectGuide
} from "../core/onboarding/guide-state.js";

function currentId(journey) {
  return journey.steps.find(step => step.status === "current")?.id;
}

test("newly registered account is guided to payment", () => {
  const journey = buildAuthGuide({ mode: "registered" });
  assert.equal(currentId(journey), "payment");
});

test("inactive workspace stays on payment/activation before project creation", () => {
  const journey = buildWorkspaceGuide({
    userData: { initialActivationPaid: false, subscriptionStatus: "pending" },
    projects: [],
    subscriptionActive: false
  });
  assert.equal(currentId(journey), "payment");
  assert.equal(journey.steps.find(step => step.id === "create-project").status, "pending");
});

test("active workspace with no projects guides to create a project", () => {
  const journey = buildWorkspaceGuide({
    userData: { initialActivationPaid: true, subscriptionStatus: "active" },
    projects: [],
    subscriptionActive: true
  });
  assert.equal(currentId(journey), "create-project");
});

test("active workspace with an existing project guides to project setup", () => {
  const journey = buildWorkspaceGuide({
    userData: { initialActivationPaid: true, subscriptionStatus: "active" },
    projects: [{ projectId: "restaurant", projectDocId: "u_restaurant" }],
    subscriptionActive: true
  });
  assert.equal(currentId(journey), "setup-project");
});

test("partner project guides setup before operator invite", () => {
  const journey = buildPartnerProjectGuide({ templateId: "restaurant", bundle: {} });
  assert.equal(currentId(journey), "partner-setup");
});

test("configured partner project guides operator invitation until accepted and active", () => {
  const journey = buildPartnerProjectGuide({
    templateId: "restaurant",
    bundle: {
      restaurant: { name: "Test" },
      operator: { isActive: false },
      agreement: { status: "pending", currentAmount: null }
    }
  });
  assert.equal(currentId(journey), "invite");
});

test("ready partner project guides sharing the customer link", () => {
  const journey = buildPartnerProjectGuide({
    templateId: "restaurant",
    bundle: {
      restaurant: { name: "Test" },
      operator: { isActive: true },
      agreement: { status: "accepted", currentAmount: 2 }
    }
  });
  assert.equal(currentId(journey), "customer-link");
});

test("guide UI has no Firebase writes or AI/network API calls", () => {
  const source = readFileSync("core/onboarding/guide.js", "utf8");
  for (const forbidden of ["setDoc(", "updateDoc(", "addDoc(", "firebase-firestore", "fetch(", "XMLHttpRequest", "openai"]) {
    assert.equal(source.includes(forbidden), false, `guide must not contain ${forbidden}`);
  }
});
