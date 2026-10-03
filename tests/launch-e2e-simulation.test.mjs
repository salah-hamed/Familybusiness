import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch
} from "firebase/firestore";

const PROJECT_ID = "family-business-launch-e2e";
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8")
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

function registrationProfile(uid, referredByUserId = "") {
  return {
    uid,
    name: "Launch Test User",
    email: `${uid}@example.com`,
    projectType: "",
    isActive: false,
    subscriptionStatus: "pending",
    initialActivationPaid: false,
    billingCycle: "initial",
    referredByUserId,
    referralQualified: false,
    createdAt: serverTimestamp()
  };
}

function initialPayment(uid, paymentId) {
  return {
    paymentId,
    paymentCode: "FB-LAUNCH-E2E",
    userId: uid,
    userEmail: `${uid}@example.com`,
    paymentType: "initial",
    amount: 350,
    currency: "EGP",
    paymentMethod: "instapay",
    paymentReference: "IPN-E2E-12345",
    proofChannel: "whatsapp",
    status: "pending_review",
    submittedAt: serverTimestamp(),
    whatsappPreparedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: "",
    rejectionReason: ""
  };
}

async function seedAdmin(adminId) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", adminId), {
      uid: adminId,
      name: "Admin",
      email: `${adminId}@example.com`,
      role: "admin",
      isActive: true,
      subscriptionStatus: "active"
    });
  });
}

async function seedActiveReferrer(uid) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", uid), {
      uid,
      name: "Referrer",
      email: `${uid}@example.com`,
      isActive: true,
      subscriptionStatus: "active",
      initialActivationPaid: true,
      billingCycle: "monthly",
      subscriptionExpiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z"))
    });
  });
}

function activeSupermarketProject(uid) {
  return {
    ownerId: uid,
    projectId: "supermarket",
    template: "supermarket",
    operatingModel: "partner_operated",
    templateVersion: 1,
    operatorId: "",
    partnerSetupStatus: "not_started",
    businessName: "Launch E2E Market",
    status: "active",
    isActive: true,
    createdAt: serverTimestamp(),
    whatsappNumber: "",
    instapayLink: "",
    logo: "",
    coverImage: "",
    primaryColor: "#16A34A",
    priceConfig: {}
  };
}

test("paid referral path: register -> WhatsApp proof record -> admin approval -> referral reward", async () => {
  const uid = "paid_referred_user";
  const referrerId = "referrer_user";
  const adminId = "admin_paid_e2e";
  const paymentId = `${uid}_payment_1`;

  await seedAdmin(adminId);
  await seedActiveReferrer(referrerId);

  const userDb = testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(
    setDoc(doc(userDb, "users", uid), registrationProfile(uid, referrerId))
  );
  await assertSucceeds(
    setDoc(doc(userDb, "subscriptionPayments", paymentId), initialPayment(uid, paymentId))
  );

  const adminDb = testEnv.authenticatedContext(adminId).firestore();
  const batch = writeBatch(adminDb);

  batch.update(doc(adminDb, "subscriptionPayments", paymentId), {
    status: "approved",
    reviewedAt: serverTimestamp(),
    reviewedBy: adminId,
    rejectionReason: ""
  });

  batch.update(doc(adminDb, "users", uid), {
    isActive: true,
    subscriptionStatus: "active",
    initialActivationPaid: true,
    billingCycle: "monthly",
    subscriptionStartedAt: serverTimestamp(),
    subscriptionExpiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    lastPaymentAmount: 350,
    lastPaymentType: "initial",
    lastPaymentAt: serverTimestamp(),
    lastSubscriptionPaymentId: paymentId,
    lastRenewalAt: null,
    activatedAt: serverTimestamp(),
    referralQualified: true
  });

  const referralId = `${referrerId}_${uid}`;
  batch.set(doc(adminDb, "referrals", referralId), {
    referrerUserId: referrerId,
    referredUserId: uid,
    status: "qualified",
    commissionAmount: 50,
    currency: "EGP",
    qualifiedAt: serverTimestamp(),
    paidAt: null
  });

  batch.set(doc(adminDb, "commissionLedger", `referral_${referralId}`), {
    userId: referrerId,
    sourceType: "referral",
    sourceId: referralId,
    referredUserId: uid,
    amount: 50,
    currency: "EGP",
    status: "earned",
    createdAt: serverTimestamp(),
    paidAt: null
  });

  await assertSucceeds(batch.commit());

  const userSnap = await getDoc(doc(adminDb, "users", uid));
  const paymentSnap = await getDoc(doc(adminDb, "subscriptionPayments", paymentId));
  const referralSnap = await getDoc(doc(adminDb, "referrals", referralId));
  const rewardSnap = await getDoc(doc(adminDb, "commissionLedger", `referral_${referralId}`));

  assert.equal(userSnap.data().subscriptionStatus, "active");
  assert.equal(userSnap.data().referralQualified, true);
  assert.equal(paymentSnap.data().status, "approved");
  assert.equal(referralSnap.data().commissionAmount, 50);
  assert.equal(rewardSnap.data().amount, 50);
  assert.equal(rewardSnap.data().status, "earned");
});

test("Launch 50 path: register -> admin-selected free grant -> active subscriber -> create project", async () => {
  const uid = "launch50_selected_user";
  const adminId = "admin_launch50_e2e";
  const grantId = `launch50_${uid}`;

  await seedAdmin(adminId);

  const userDb = testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(setDoc(doc(userDb, "users", uid), registrationProfile(uid)));

  const adminDb = testEnv.authenticatedContext(adminId).firestore();
  const grantBatch = writeBatch(adminDb);

  grantBatch.set(doc(adminDb, "subscriptionGrants", grantId), {
    grantId,
    userId: uid,
    campaignId: "launch50",
    status: "granted",
    paymentRequired: false,
    value: 350,
    currency: "EGP",
    subscriptionDays: 30,
    grantedAt: serverTimestamp(),
    grantedBy: adminId
  });

  grantBatch.set(doc(adminDb, "platformCounters", "launch50"), {
    campaignId: "launch50",
    count: 1,
    limit: 50,
    lastGrantedUserId: uid,
    updatedAt: serverTimestamp()
  });

  grantBatch.update(doc(adminDb, "users", uid), {
    isActive: true,
    subscriptionStatus: "active",
    initialActivationPaid: false,
    billingCycle: "monthly",
    subscriptionStartedAt: serverTimestamp(),
    subscriptionExpiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    activatedAt: serverTimestamp(),
    lastActivationSource: "launch_promo",
    lastSubscriptionGrantId: grantId,
    launchPromoCampaignId: "launch50"
  });

  await assertSucceeds(grantBatch.commit());

  await assertSucceeds(
    setDoc(doc(userDb, "projects", `${uid}_supermarket`), activeSupermarketProject(uid))
  );

  const projectSnap = await getDoc(doc(userDb, "projects", `${uid}_supermarket`));
  assert.equal(projectSnap.data().ownerId, uid);
  assert.equal(projectSnap.data().template, "supermarket");
  assert.equal(projectSnap.data().status, "active");
});

async function seedOperationalRuntime() {
  const ownerId = "owner_ops_e2e";
  const operatorUid = "operator_ops_e2e";
  const adminId = "admin_ops_e2e";
  const projectId = `${ownerId}_supermarket`;
  const workerId = "worker_ops_e2e";
  const orderId = "order_ops_e2e";
  const trackingToken = "t".repeat(48);

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users", ownerId), {
      uid: ownerId,
      name: "Owner",
      email: `${ownerId}@example.com`,
      isActive: true,
      subscriptionStatus: "active",
      initialActivationPaid: true,
      subscriptionExpiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z"))
    });
    await setDoc(doc(db, "users", adminId), {
      uid: adminId,
      role: "admin",
      isActive: true,
      subscriptionStatus: "active"
    });
    await setDoc(doc(db, "projects", projectId), {
      ownerId,
      projectId: "supermarket",
      template: "supermarket",
      operatingModel: "partner_operated",
      templateVersion: 1,
      operatorId: projectId,
      partnerSetupStatus: "active",
      businessName: "Launch E2E Market",
      status: "active",
      isActive: true,
      priceConfig: {}
    });
    await setDoc(doc(db, "operators", projectId), {
      operatorId: projectId,
      projectId,
      ownerId,
      templateId: "supermarket",
      name: "Launch Operator",
      contactName: "Operator",
      phone: "201000000000",
      whatsapp: "201000000000",
      email: "",
      authLoginEmail: "operator.ops@familybusiness.local",
      authUid: operatorUid,
      status: "active",
      agreementStatus: "accepted",
      isActive: true
    });
    await setDoc(doc(db, "commissionAgreements", projectId), {
      agreementId: projectId,
      projectId,
      ownerId,
      operatorId: projectId,
      templateId: "supermarket",
      currency: "EGP",
      unit: "per_completed_order",
      currentAmount: 5,
      acceptedVersion: 1,
      pendingAmount: null,
      status: "accepted",
      pendingStatus: "none",
      version: 1
    });
    await setDoc(doc(db, "supermarkets", projectId), {
      isAcceptingOrders: true,
      deliveryFee: 10
    });
  });

  return { ownerId, operatorUid, adminId, projectId, workerId, orderId, trackingToken };
}

test("operational launch path: customer tracking -> worker -> locked commission -> delivery -> peer settlement", async () => {
  const { ownerId, operatorUid, adminId, projectId, workerId, orderId, trackingToken } =
    await seedOperationalRuntime();

  const publicDb = testEnv.unauthenticatedContext().firestore();
  const publicCreate = writeBatch(publicDb);

  const order = {
    projectId,
    providerId: projectId,
    templateType: "supermarket",
    serviceType: "supermarket_delivery",
    status: "new",
    customerName: "عميل إطلاق",
    customerPhone: "01000000000",
    customerAddress: "عنوان اختبار الإطلاق",
    location: "",
    notes: "",
    items: [{ name: "Milk", quantity: 1, unitPrice: 20, subtotal: 20 }],
    subtotal: 20,
    deliveryFee: 10,
    total: 30,
    price: 30,
    pricingLocked: false,
    commissionEligible: false,
    commissionLocked: false,
    commissionAmount: 0,
    trackingToken,
    createdAt: serverTimestamp()
  };

  publicCreate.set(doc(publicDb, "orders", orderId), order);
  publicCreate.set(doc(publicDb, "orderTracking", trackingToken), {
    trackingToken,
    orderId,
    projectId,
    templateType: "supermarket",
    status: "new",
    items: order.items,
    subtotal: 20,
    deliveryFee: 10,
    total: 30,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await assertSucceeds(publicCreate.commit());

  // Prepare the order at the point where delivery assignment is allowed.
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, "orders", orderId), {
      status: "ready",
      pricingLocked: true,
      pricingLockedAt: new Date("2026-10-03T10:00:00Z"),
      pricingLockedBy: operatorUid
    });
    await updateDoc(doc(db, "orderTracking", trackingToken), {
      status: "ready",
      updatedAt: new Date("2026-10-03T10:00:00Z")
    });
  });

  const operatorDb = testEnv.authenticatedContext(operatorUid).firestore();

  await assertSucceeds(setDoc(doc(operatorDb, "workers", workerId), {
    workerId,
    ownerId,
    projectId,
    templateId: "supermarket",
    name: "Rider E2E",
    role: "rider",
    phone: "201000000001",
    whatsapp: "201000000001",
    isActive: true,
    createdBy: operatorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  await assertSucceeds(updateDoc(doc(operatorDb, "orders", orderId), {
    assignedWorkerId: workerId,
    assignedWorkerName: "Rider E2E",
    assignedWorkerRole: "rider",
    assignedWorkerWhatsapp: "201000000001",
    assignedAt: serverTimestamp(),
    assignmentUpdatedAt: serverTimestamp()
  }));

  const dispatch = writeBatch(operatorDb);
  dispatch.update(doc(operatorDb, "orders", orderId), {
    status: "assigned",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: operatorUid,
    commissionEligible: true,
    commissionLocked: true,
    commissionAmount: 5,
    commissionAgreementVersion: 1,
    commissionTrigger: "delivery_assignment",
    commissionEarnedAt: serverTimestamp()
  });
  dispatch.update(doc(operatorDb, "orderTracking", trackingToken), {
    status: "assigned",
    items: order.items,
    subtotal: 20,
    deliveryFee: 10,
    total: 30,
    updatedAt: serverTimestamp()
  });
  dispatch.set(doc(operatorDb, "commissionLedger", `project_order_${orderId}`), {
    userId: ownerId,
    projectId,
    orderId,
    sourceType: "project_order",
    sourceId: orderId,
    agreementId: projectId,
    agreementVersion: 1,
    amount: 5,
    currency: "EGP",
    status: "earned",
    trigger: "delivery_assignment",
    createdAt: serverTimestamp(),
    earnedAt: serverTimestamp(),
    paidAt: null
  });
  await assertSucceeds(dispatch.commit());

  const outForDelivery = writeBatch(operatorDb);
  outForDelivery.update(doc(operatorDb, "orders", orderId), {
    status: "out_for_delivery",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: operatorUid
  });
  outForDelivery.update(doc(operatorDb, "orderTracking", trackingToken), {
    status: "out_for_delivery",
    items: order.items,
    subtotal: 20,
    deliveryFee: 10,
    total: 30,
    updatedAt: serverTimestamp()
  });
  await assertSucceeds(outForDelivery.commit());

  const delivery = writeBatch(operatorDb);
  delivery.update(doc(operatorDb, "orders", orderId), {
    status: "delivered",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: operatorUid,
    deliveredAt: serverTimestamp()
  });
  delivery.update(doc(operatorDb, "orderTracking", trackingToken), {
    status: "delivered",
    items: order.items,
    subtotal: 20,
    deliveryFee: 10,
    total: 30,
    updatedAt: serverTimestamp(),
    deliveredAt: serverTimestamp()
  });
  await assertSucceeds(delivery.commit());

  const trackingSnap = await getDoc(doc(publicDb, "orderTracking", trackingToken));
  assert.equal(trackingSnap.data().status, "delivered");

  const ledgerSnap = await getDoc(
    doc(testEnv.authenticatedContext(ownerId).firestore(), "commissionLedger", `project_order_${orderId}`)
  );
  assert.equal(ledgerSnap.data().amount, 5);
  assert.equal(ledgerSnap.data().status, "earned");

  const settlementId = "settlement_ops_e2e";
  await assertSucceeds(setDoc(doc(operatorDb, "commissionSettlements", settlementId), {
    settlementId,
    projectId,
    ownerId,
    operatorId: projectId,
    templateId: "supermarket",
    businessName: "Launch E2E Market",
    currency: "EGP",
    amount: 5,
    status: "pending_owner_confirmation",
    paymentMethod: "instapay",
    paymentReference: "SETTLE-E2E",
    note: "",
    declaredAt: serverTimestamp(),
    declaredBy: operatorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    confirmedAt: null,
    confirmedBy: null,
    rejectedAt: null,
    rejectedBy: null
  }));

  await assertSucceeds(setDoc(doc(operatorDb, "commissionPaymentStates", projectId), {
    projectId,
    ownerId,
    operatorId: projectId,
    pendingSettlementId: settlementId,
    updatedAt: serverTimestamp()
  }));

  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  await assertSucceeds(updateDoc(doc(ownerDb, "commissionSettlements", settlementId), {
    status: "confirmed",
    confirmedAt: serverTimestamp(),
    confirmedBy: ownerId,
    updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(ownerDb, "commissionPaymentStates", projectId), {
    pendingSettlementId: "",
    updatedAt: serverTimestamp()
  }));

  const adminDb = testEnv.authenticatedContext(adminId).firestore();
  const settlementSnap = await getDoc(doc(adminDb, "commissionSettlements", settlementId));
  assert.equal(settlementSnap.data().status, "confirmed");

  await assertFails(updateDoc(doc(adminDb, "commissionSettlements", settlementId), {
    status: "rejected",
    rejectedAt: serverTimestamp(),
    rejectedBy: adminId,
    updatedAt: serverTimestamp()
  }));
});

function indexSignature(index) {
  return [
    index.collectionGroup,
    ...index.fields.map(field => `${field.fieldPath}:${field.order || field.arrayConfig}`)
  ].join("|");
}

test("launch-critical query shapes are covered by committed Firestore indexes", () => {
  const config = JSON.parse(readFileSync("firestore.indexes.json", "utf8"));
  const actual = new Set((config.indexes || []).map(indexSignature));

  const required = [
    "orders|projectId:ASCENDING|templateType:ASCENDING|createdAt:DESCENDING",
    "orders|projectId:ASCENDING|templateType:ASCENDING|status:ASCENDING|createdAt:DESCENDING",
    "orders|status:ASCENDING|createdAt:DESCENDING",
    "orders|status:ASCENDING|createdAt:ASCENDING",
    "subscriptionPayments|userId:ASCENDING|submittedAt:DESCENDING",
    "subscriptionPayments|status:ASCENDING|submittedAt:ASCENDING",
    "commissionLedger|userId:ASCENDING|createdAt:DESCENDING",
    "commissionLedger|projectId:ASCENDING|status:ASCENDING|createdAt:DESCENDING",
    "commissionSettlements|projectId:ASCENDING|createdAt:DESCENDING",
    "commissionSettlements|status:ASCENDING|createdAt:DESCENDING",
    "commissionReversals|projectId:ASCENDING|createdAt:DESCENDING",
    "commissionReversals|status:ASCENDING|createdAt:DESCENDING"
  ];

  for (const signature of required) {
    assert.equal(actual.has(signature), true, `Missing launch-critical index: ${signature}`);
  }
});
