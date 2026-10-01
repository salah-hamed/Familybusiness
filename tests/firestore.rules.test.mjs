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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";

const PROJECT_ID = "family-business-rules-test";
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

async function seedUser(uid, extra = {}) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", uid), {
      uid,
      name: "Test User",
      email: `${uid}@example.com`,
      isActive: true,
      subscriptionStatus: "active",
      ...extra
    });
  });
}

async function seedProject(projectId, data) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "projects", projectId), data);
  });
}

async function seedPartnerRuntime(templateId, suffix = "runtime") {
  const ownerId = `owner_${templateId}_${suffix}`;
  const projectId = `${ownerId}_${templateId}`;

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users", ownerId), {
      uid: ownerId,
      name: "Owner",
      email: `${ownerId}@example.com`,
      isActive: true,
      subscriptionStatus: "active"
    });
    await setDoc(doc(db, "projects", projectId), {
      ownerId,
      projectId: templateId,
      template: templateId,
      operatingModel: "partner_operated",
      templateVersion: templateId === "laundry" ? 3 : 1,
      operatorId: projectId,
      partnerSetupStatus: "active",
      businessName: "Test Business",
      status: "active",
      isActive: true,
      priceConfig: templateId === "laundry" ? {
        shirtWash: 10, shirtIron: 5,
        trousersWash: 12, trousersIron: 6,
        tshirtWash: 8, tshirtIron: 4,
        dressWash: 20, dressIron: 10,
        galabeyaWash: 18, galabeyaIron: 9,
        suitWash: 30, suitIron: 15,
        shoesWash: 25
      } : {}
    });
    await setDoc(doc(db, "operators", projectId), {
      authUid: `operator_${templateId}`,
      status: "active",
      agreementStatus: "accepted",
      isActive: true
    });
    await setDoc(doc(db, "commissionAgreements", projectId), {
      status: "accepted",
      currentAmount: 5,
      acceptedVersion: 1
    });

    if (templateId === "supermarket") {
      await setDoc(doc(db, "supermarkets", projectId), {
        isAcceptingOrders: true,
        deliveryFee: 10
      });
    }

    if (templateId === "restaurant" || templateId === "bakery") {
      await setDoc(doc(db, "restaurants", projectId), {
        isAcceptingOrders: true,
        deliveryFee: 10
      });
    }

    if (templateId === "laundry") {
      await setDoc(doc(db, "laundries", projectId), {
        isAcceptingOrders: true
      });
    }
  });

  return { ownerId, projectId };
}

function baseCustomerOrder(projectId, templateType, serviceType) {
  return {
    projectId,
    providerId: projectId,
    templateType,
    serviceType,
    status: "new",
    customerName: "عميل اختبار",
    customerPhone: "01000000000",
    customerAddress: "عنوان اختبار",
    location: "",
    notes: "",
    createdAt: serverTimestamp()
  };
}

function partnerDeliveryOrder(projectId, templateType) {
  return {
    ...baseCustomerOrder(
      projectId,
      templateType,
      templateType === "supermarket"
        ? "supermarket_delivery"
        : templateType === "bakery"
          ? "bakery_delivery"
          : "restaurant_delivery"
    ),
    items: [{ name: "اختبار", quantity: 1, unitPrice: 20, subtotal: 20 }],
    subtotal: 20,
    deliveryFee: 10,
    total: 30,
    price: 30,
    pricingLocked: false,
    commissionEligible: false,
    commissionLocked: false,
    commissionAmount: 0,
    trackingToken: "a".repeat(40)
  };
}

function laundryOrder(projectId) {
  const item = (key, quantity, unitPrice) => ({
    key,
    service: "wash",
    quantity,
    unitPrice,
    subtotal: quantity * unitPrice
  });

  return {
    ...baseCustomerOrder(projectId, "laundry", "laundry_per_piece"),
    items: [
      item("shirt", 1, 10),
      item("trousers", 0, 12),
      item("tshirt", 0, 8),
      item("dress", 0, 20),
      item("galabeya", 0, 18),
      item("suit", 0, 30),
      item("shoes", 0, 25)
    ],
    totalPieces: 1,
    price: 10
  };
}

function activePartnerProject(uid, templateId, version = 1) {
  return {
    ownerId: uid,
    projectId: templateId,
    template: templateId,
    operatingModel: "partner_operated",
    templateVersion: version,
    operatorId: "",
    partnerSetupStatus: "not_started",
    businessName: "Test Business",
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

for (const [templateId, version] of [
  ["supermarket", 1],
  ["restaurant", 1],
  ["bakery", 1],
  ["laundry", 3]
]) {
  test(`active subscriber can create approved template: ${templateId}`, async () => {
    const uid = `owner_create_${templateId}`;
    await seedUser(uid);
    const db = testEnv.authenticatedContext(uid).firestore();

    await assertSucceeds(
      setDoc(
        doc(db, "projects", `${uid}_${templateId}`),
        activePartnerProject(uid, templateId, version)
      )
    );
  });
}

test("subscriber cannot bypass registry to create paused Cleaning", async () => {
  const uid = "owner_cleaning";
  await seedUser(uid);
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertFails(
    setDoc(doc(db, "projects", `${uid}_cleaning`), {
      ...activePartnerProject(uid, "cleaning", 1),
      operatingModel: "owner_operated",
      operatorId: null,
      partnerSetupStatus: null
    })
  );
});

test("subscriber cannot create an arbitrary hidden or unknown template", async () => {
  const uid = "owner_unknown";
  await seedUser(uid);
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertFails(
    setDoc(
      doc(db, "projects", `${uid}_maintenance`),
      activePartnerProject(uid, "maintenance", 0)
    )
  );
});

test("project owner cannot hard-delete the project root", async () => {
  const uid = "owner_delete";
  const projectId = `${uid}_supermarket`;
  await seedUser(uid);
  await seedProject(projectId, {
    ownerId: uid,
    projectId: "supermarket",
    template: "supermarket",
    operatingModel: "partner_operated",
    isActive: true,
    status: "active"
  });

  const db = testEnv.authenticatedContext(uid).firestore();
  await assertFails(deleteDoc(doc(db, "projects", projectId)));
});

test("admin can perform controlled project deletion", async () => {
  const ownerId = "owner_admin_delete";
  const adminId = "admin_user";
  const projectId = `${ownerId}_supermarket`;

  await seedUser(ownerId);
  await seedUser(adminId, { role: "admin" });
  await seedProject(projectId, {
    ownerId,
    projectId: "supermarket",
    template: "supermarket",
    operatingModel: "partner_operated",
    isActive: true,
    status: "active"
  });

  const db = testEnv.authenticatedContext(adminId).firestore();
  await assertSucceeds(deleteDoc(doc(db, "projects", projectId)));
});

test("public order create rejects oversized customer fields", async () => {
  const ownerId = "cleaning_owner";
  const projectId = `${ownerId}_cleaning`;
  await seedUser(ownerId);
  await seedProject(projectId, {
    ownerId,
    projectId: "cleaning",
    template: "cleaning",
    operatingModel: "owner_operated",
    templateVersion: 1,
    status: "active",
    isActive: true,
    priceConfig: { base: 100, room: 20, bathroom: 20, kitchen: 30, stairs: 30 }
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(
    setDoc(doc(db, "orders", "oversized_order"), {
      projectId,
      providerId: projectId,
      templateType: "cleaning",
      status: "new",
      customerName: "x".repeat(101),
      customerPhone: "01000000000",
      customerAddress: "Test address",
      location: "",
      rooms: 0,
      bathrooms: 0,
      kitchen: "no",
      stairs: "no",
      price: 100,
      createdAt: serverTimestamp()
    })
  );
});

test("public order create still accepts bounded valid customer data", async () => {
  const ownerId = "cleaning_owner_valid";
  const projectId = `${ownerId}_cleaning`;
  await seedUser(ownerId);
  await seedProject(projectId, {
    ownerId,
    projectId: "cleaning",
    template: "cleaning",
    operatingModel: "owner_operated",
    templateVersion: 1,
    status: "active",
    isActive: true,
    priceConfig: { base: 100, room: 20, bathroom: 20, kitchen: 30, stairs: 30 }
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(
    setDoc(doc(db, "orders", "valid_order"), {
      projectId,
      providerId: projectId,
      templateType: "cleaning",
      status: "new",
      customerName: "عميل اختبار",
      customerPhone: "01000000000",
      customerAddress: "عنوان اختبار",
      location: "",
      rooms: 0,
      bathrooms: 0,
      kitchen: "no",
      stairs: "no",
      price: 100,
      createdAt: serverTimestamp()
    })
  );
});

test("user cannot expand display name beyond the validated limit", async () => {
  const uid = "bounded_name_user";
  await seedUser(uid, { name: "Safe Name" });
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertFails(
    setDoc(
      doc(db, "users", uid),
      { name: "x".repeat(101) },
      { merge: true }
    )
  );
});

test("new user profile accepts bounded registration fields", async () => {
  const uid = "new_profile_user";
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertSucceeds(
    setDoc(doc(db, "users", uid), {
      uid,
      name: "مستخدم جديد",
      email: "new@example.com",
      projectType: "",
      isActive: false,
      subscriptionStatus: "pending",
      initialActivationPaid: false,
      billingCycle: "initial",
      referredByUserId: "",
      referralQualified: false,
      createdAt: serverTimestamp()
    })
  );
});

for (const templateType of ["supermarket", "restaurant", "bakery"]) {
  test(`valid public ${templateType} order passes partner readiness and input bounds`, async () => {
    const { projectId } = await seedPartnerRuntime(templateType, "valid_order");
    const db = testEnv.unauthenticatedContext().firestore();

    await assertSucceeds(
      setDoc(
        doc(db, "orders", `valid_${templateType}_order`),
        partnerDeliveryOrder(projectId, templateType)
      )
    );
  });
}

test("valid public laundry order passes partner readiness and input bounds", async () => {
  const { projectId } = await seedPartnerRuntime("laundry", "valid_order");
  const db = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(
    setDoc(
      doc(db, "orders", "valid_laundry_order"),
      laundryOrder(projectId)
    )
  );
});


async function seedClaimedOperatorRecoveryFixture(suffix = "recovery") {
  const ownerId = `owner_operator_${suffix}`;
  const projectId = `${ownerId}_supermarket`;
  const oldAuthUid = `operator_old_${suffix}`;
  const oldEmail = `operator.old.${suffix}@familybusiness.local`;

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users", ownerId), {
      uid: ownerId,
      name: "Owner",
      email: `${ownerId}@example.com`,
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
      businessName: "Recovery Store",
      status: "active",
      isActive: true,
      priceConfig: {}
    });
    await setDoc(doc(db, "operators", projectId), {
      operatorId: projectId,
      projectId,
      ownerId,
      templateId: "supermarket",
      name: "Recovery Store",
      contactName: "Operator",
      phone: "01000000000",
      whatsapp: "01000000000",
      email: "",
      authLoginEmail: oldEmail,
      authUid: oldAuthUid,
      status: "active",
      agreementStatus: "accepted",
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  return { ownerId, projectId, oldAuthUid, oldEmail };
}

test("project owner can rotate claimed operator access without changing business state", async () => {
  const { ownerId, projectId } = await seedClaimedOperatorRecoveryFixture("owner_reset");
  const db = testEnv.authenticatedContext(ownerId).firestore();
  const newEmail = "operator.new.owner-reset@familybusiness.local";

  await assertSucceeds(
    updateDoc(doc(db, "operators", projectId), {
      authLoginEmail: newEmail,
      authUid: "",
      updatedAt: serverTimestamp()
    })
  );

  const snap = await getDoc(doc(db, "operators", projectId));
  assert.equal(snap.data().authUid, "");
  assert.equal(snap.data().authLoginEmail, newEmail);
  assert.equal(snap.data().status, "active");
  assert.equal(snap.data().agreementStatus, "accepted");
  assert.equal(snap.data().isActive, true);
});

test("non-owner cannot rotate operator access", async () => {
  const { projectId } = await seedClaimedOperatorRecoveryFixture("stranger_reset");
  const db = testEnv.authenticatedContext("stranger_user").firestore();

  await assertFails(
    updateDoc(doc(db, "operators", projectId), {
      authLoginEmail: "operator.new.stranger@familybusiness.local",
      authUid: "",
      updatedAt: serverTimestamp()
    })
  );
});

test("old operator loses access immediately after owner rotates invite", async () => {
  const { ownerId, projectId, oldAuthUid, oldEmail } = await seedClaimedOperatorRecoveryFixture("old_revoked");
  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  const newEmail = "operator.new.old-revoked@familybusiness.local";

  await assertSucceeds(
    updateDoc(doc(ownerDb, "operators", projectId), {
      authLoginEmail: newEmail,
      authUid: "",
      updatedAt: serverTimestamp()
    })
  );

  const oldDb = testEnv.authenticatedContext(oldAuthUid, {
    email: oldEmail,
    email_verified: false
  }).firestore();

  await assertFails(getDoc(doc(oldDb, "operators", projectId)));
});

test("new rotated invite can claim once and a second uid cannot take over", async () => {
  const { ownerId, projectId } = await seedClaimedOperatorRecoveryFixture("new_claim");
  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  const newEmail = "operator.new.claim@familybusiness.local";

  await assertSucceeds(
    updateDoc(doc(ownerDb, "operators", projectId), {
      authLoginEmail: newEmail,
      authUid: "",
      updatedAt: serverTimestamp()
    })
  );

  const newDb = testEnv.authenticatedContext("operator_new_claim", {
    email: newEmail,
    email_verified: false
  }).firestore();

  await assertSucceeds(
    updateDoc(doc(newDb, "operators", projectId), {
      authUid: "operator_new_claim",
      status: "active",
      updatedAt: serverTimestamp()
    })
  );

  const takeoverDb = testEnv.authenticatedContext("operator_takeover", {
    email: newEmail,
    email_verified: false
  }).firestore();

  await assertFails(
    updateDoc(doc(takeoverDb, "operators", projectId), {
      authUid: "operator_takeover",
      status: "active",
      updatedAt: serverTimestamp()
    })
  );
});


async function seedCommissionIntegrityFixture(suffix = "integrity") {
  const ownerId = "owner_commission_" + suffix;
  const operatorUid = "operator_commission_" + suffix;
  const projectId = ownerId + "_supermarket";

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, "projects", projectId), {
      ownerId,
      projectId: "supermarket",
      template: "supermarket",
      operatingModel: "partner_operated",
      templateVersion: 1,
      operatorId: projectId,
      partnerSetupStatus: "active",
      businessName: "Commission Store",
      status: "active",
      isActive: true,
      priceConfig: {}
    });

    await setDoc(doc(db, "operators", projectId), {
      operatorId: projectId,
      projectId,
      ownerId,
      templateId: "supermarket",
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
      proposedBy: ownerId,
      proposedAt: serverTimestamp(),
      acceptedAt: serverTimestamp(),
      acceptedBy: operatorUid,
      rejectedAt: null,
      lastDecision: "accepted",
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  return { ownerId, operatorUid, projectId };
}

test("pending commission proposal preserves the previously accepted amount and version", async () => {
  const { ownerId, projectId } = await seedCommissionIntegrityFixture("pending_keeps_old");
  const db = testEnv.authenticatedContext(ownerId).firestore();

  await assertSucceeds(
    updateDoc(doc(db, "commissionAgreements", projectId), {
      pendingAmount: 7,
      pendingStatus: "pending",
      status: "accepted",
      proposedAt: serverTimestamp(),
      proposedBy: ownerId,
      rejectedAt: null,
      updatedAt: serverTimestamp(),
      version: 2
    })
  );

  const snap = await getDoc(doc(db, "commissionAgreements", projectId));
  assert.equal(snap.data().currentAmount, 5);
  assert.equal(snap.data().acceptedVersion, 1);
  assert.equal(snap.data().pendingAmount, 7);
  assert.equal(snap.data().pendingStatus, "pending");
  assert.equal(snap.data().version, 2);
});

test("only operator acceptance promotes pending commission to the effective snapshot", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("accept_promotes");
  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();

  await assertSucceeds(
    updateDoc(doc(ownerDb, "commissionAgreements", projectId), {
      pendingAmount: 7,
      pendingStatus: "pending",
      status: "accepted",
      proposedAt: serverTimestamp(),
      proposedBy: ownerId,
      rejectedAt: null,
      updatedAt: serverTimestamp(),
      version: 2
    })
  );

  const operatorDb = testEnv.authenticatedContext(operatorUid).firestore();

  await assertSucceeds(
    updateDoc(doc(operatorDb, "commissionAgreements", projectId), {
      currentAmount: 7,
      acceptedVersion: 2,
      pendingAmount: null,
      status: "accepted",
      pendingStatus: "none",
      lastDecision: "accepted",
      acceptedAt: serverTimestamp(),
      acceptedBy: operatorUid,
      rejectedAt: null,
      updatedAt: serverTimestamp()
    })
  );

  const snap = await getDoc(doc(operatorDb, "commissionAgreements", projectId));
  assert.equal(snap.data().currentAmount, 7);
  assert.equal(snap.data().acceptedVersion, 2);
  assert.equal(snap.data().pendingAmount, null);
  assert.equal(snap.data().pendingStatus, "none");
});

test("rejected commission change leaves the old accepted snapshot active", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("reject_keeps_old");
  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();

  await assertSucceeds(
    updateDoc(doc(ownerDb, "commissionAgreements", projectId), {
      pendingAmount: 9,
      pendingStatus: "pending",
      status: "accepted",
      proposedAt: serverTimestamp(),
      proposedBy: ownerId,
      rejectedAt: null,
      updatedAt: serverTimestamp(),
      version: 2
    })
  );

  const operatorDb = testEnv.authenticatedContext(operatorUid).firestore();

  await assertSucceeds(
    updateDoc(doc(operatorDb, "commissionAgreements", projectId), {
      pendingAmount: null,
      status: "accepted",
      pendingStatus: "none",
      lastDecision: "rejected",
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );

  const snap = await getDoc(doc(operatorDb, "commissionAgreements", projectId));
  assert.equal(snap.data().currentAmount, 5);
  assert.equal(snap.data().acceptedVersion, 1);
  assert.equal(snap.data().pendingAmount, null);
  assert.equal(snap.data().lastDecision, "rejected");
});

test("project owner cannot directly rewrite the accepted commission amount or version", async () => {
  const { ownerId, projectId } = await seedCommissionIntegrityFixture("owner_cannot_accept");
  const db = testEnv.authenticatedContext(ownerId).firestore();

  await assertFails(
    updateDoc(doc(db, "commissionAgreements", projectId), {
      currentAmount: 99,
      acceptedVersion: 99,
      updatedAt: serverTimestamp()
    })
  );
});

test("project-order ledger can be created once by the operator and cannot be overwritten", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("ledger_once");
  const orderId = "delivered_order_once";
  const ledgerId = "project_order_" + orderId;

  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "orders", orderId), {
      projectId,
      providerId: projectId,
      templateType: "supermarket",
      status: "delivered",
      commissionEligible: true,
      commissionLocked: true,
      commissionAmount: 5,
      commissionAgreementVersion: 1
    });
  });

  const db = testEnv.authenticatedContext(operatorUid).firestore();
  const entry = {
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
    createdAt: serverTimestamp(),
    paidAt: null
  };

  await assertSucceeds(setDoc(doc(db, "commissionLedger", ledgerId), entry));
  await assertFails(setDoc(doc(db, "commissionLedger", ledgerId), entry));
});

test("project-order ledger rejects amount or accepted-version mismatches", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("ledger_mismatch");
  const db = testEnv.authenticatedContext(operatorUid).firestore();

  const cases = [
    ["wrong_amount", 6, 1],
    ["wrong_version", 5, 2]
  ];

  for (const [orderId, amount, agreementVersion] of cases) {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "orders", orderId), {
        projectId,
        providerId: projectId,
        templateType: "supermarket",
        status: "delivered",
        commissionEligible: true,
        commissionLocked: true,
        commissionAmount: 5,
        commissionAgreementVersion: 1
      });
    });

    await assertFails(
      setDoc(doc(db, "commissionLedger", "project_order_" + orderId), {
        userId: ownerId,
        projectId,
        orderId,
        sourceType: "project_order",
        sourceId: orderId,
        agreementId: projectId,
        agreementVersion,
        amount,
        currency: "EGP",
        status: "earned",
        createdAt: serverTimestamp(),
        paidAt: null
      })
    );
  }
});


test("operator fallback query must constrain both projectId and templateType", async () => {
  const { projectId } = await seedPartnerRuntime("restaurant", "fallback_query");

  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "orders", "fallback_order"), {
      projectId,
      providerId: projectId,
      templateType: "restaurant",
      status: "new",
      createdAt: serverTimestamp()
    });
  });

  const db = testEnv.authenticatedContext("operator_restaurant").firestore();

  await assertFails(
    getDocs(query(
      collection(db, "orders"),
      where("projectId", "==", projectId)
    ))
  );

  await assertSucceeds(
    getDocs(query(
      collection(db, "orders"),
      where("projectId", "==", projectId),
      where("templateType", "==", "restaurant")
    ))
  );
});


test("operator earns supermarket commission atomically when a ready order is assigned for delivery", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("dispatch_trigger");
  const orderId = "dispatch_trigger_order";
  const workerId = "dispatch_trigger_rider";

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "workers", workerId), {
      workerId,
      ownerId,
      projectId,
      templateId: "supermarket",
      name: "Rider One",
      role: "rider",
      phone: "201000000001",
      whatsapp: "201000000001",
      isActive: true,
      createdBy: operatorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await setDoc(doc(db, "orders", orderId), {
      projectId,
      providerId: projectId,
      templateType: "supermarket",
      status: "ready",
      items: [{ name: "Milk", quantity: 1 }],
      subtotal: 20,
      deliveryFee: 10,
      total: 30,
      price: 30,
      pricingLocked: true,
      assignedWorkerId: workerId,
      assignedWorkerName: "Rider One",
      assignedWorkerRole: "rider",
      assignedWorkerWhatsapp: "201000000001"
    });
  });

  const db = testEnv.authenticatedContext(operatorUid).firestore();
  const batch = writeBatch(db);
  const orderRef = doc(db, "orders", orderId);
  const ledgerRef = doc(db, "commissionLedger", "project_order_" + orderId);

  batch.update(orderRef, {
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

  batch.set(ledgerRef, {
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

  await assertSucceeds(batch.commit());

  const orderSnap = await getDoc(orderRef);
  const ledgerSnap = await getDoc(ledgerRef);
  assert.equal(orderSnap.data().status, "assigned");
  assert.equal(orderSnap.data().commissionLocked, true);
  assert.equal(orderSnap.data().commissionAmount, 5);
  assert.equal(ledgerSnap.data().status, "earned");
  assert.equal(ledgerSnap.data().amount, 5);
});

test("operator cannot move a ready supermarket order to assigned without recording commission", async () => {
  const { operatorUid, projectId } = await seedCommissionIntegrityFixture("dispatch_requires_ledger");
  const orderId = "dispatch_without_ledger";
  const workerId = "dispatch_without_ledger_rider";

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "workers", workerId), {
      workerId,
      ownerId: "owner_commission_dispatch_requires_ledger",
      projectId,
      templateId: "supermarket",
      name: "Rider Two",
      role: "rider",
      phone: "201000000002",
      whatsapp: "201000000002",
      isActive: true,
      createdBy: operatorUid
    });
    await setDoc(doc(db, "orders", orderId), {
      projectId,
      providerId: projectId,
      templateType: "supermarket",
      status: "ready",
      pricingLocked: true,
      assignedWorkerId: workerId,
      assignedWorkerName: "Rider Two",
      assignedWorkerRole: "rider",
      assignedWorkerWhatsapp: "201000000002"
    });
  });

  const db = testEnv.authenticatedContext(operatorUid).firestore();

  await assertFails(
    updateDoc(doc(db, "orders", orderId), {
      status: "assigned",
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: operatorUid
    })
  );
});

test("laundry commission is earned only when the delivery agent moves a ready order out for delivery", async () => {
  const { ownerId, projectId } = await seedPartnerRuntime("laundry", "dispatch_trigger");
  const operatorUid = "operator_laundry";
  const orderId = "laundry_dispatch_order";
  const workerId = "laundry_delivery_agent";

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "workers", workerId), {
      workerId,
      ownerId,
      projectId,
      templateId: "laundry",
      name: "Delivery Agent",
      role: "delivery_agent",
      phone: "201000000003",
      whatsapp: "201000000003",
      isActive: true,
      createdBy: operatorUid
    });
    await setDoc(doc(db, "orders", orderId), {
      projectId,
      providerId: projectId,
      templateType: "laundry",
      status: "accepted",
      laundryStage: "ready_delivery",
      assignedWorkerId: workerId,
      assignedWorkerName: "Delivery Agent",
      assignedWorkerRole: "delivery_agent",
      assignedWorkerWhatsapp: "201000000003"
    });
  });

  const db = testEnv.authenticatedContext(operatorUid).firestore();
  const batch = writeBatch(db);

  batch.update(doc(db, "orders", orderId), {
    status: "accepted",
    laundryStage: "out_for_delivery",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: operatorUid,
    commissionEligible: true,
    commissionLocked: true,
    commissionAmount: 5,
    commissionAgreementVersion: 1,
    commissionTrigger: "delivery_assignment",
    commissionEarnedAt: serverTimestamp()
  });

  batch.set(doc(db, "commissionLedger", "project_order_" + orderId), {
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

  await assertSucceeds(batch.commit());
});
