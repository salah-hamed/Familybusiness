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
  Timestamp,
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
    price: 10,
    trackingToken: "l".repeat(48)
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

// Phase A: new identity is additive, authenticated and immutable to subscribers.
function merchantFields(uid) {
  return {
    merchantId: "m_" + "a".repeat(32),
    originalSubscriberId: uid,
    assignedSubscriberId: uid,
    assignmentStatus: "assigned_to_subscriber",
    platformManaged: false,
    linkedAt: null,
    assignmentUpdatedAt: null
  };
}

test("new project accepts central merchant metadata while keeping legacy project ID", async () => {
  const uid = "central_owner";
  await seedUser(uid);
  const db = testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(setDoc(doc(db, "projects", `${uid}_supermarket`), {
    ...activePartnerProject(uid, "supermarket"),
    ...merchantFields(uid)
  }));
  const snapshot = await getDoc(doc(db, "projects", `${uid}_supermarket`));
  assert.equal(snapshot.data().ownerId, uid);
  assert.equal(snapshot.data().merchantId, merchantFields(uid).merchantId);
});

test("subscriber cannot forge central merchant identity during create", async () => {
  const uid = "central_forgery";
  await seedUser(uid);
  const db = testEnv.authenticatedContext(uid).firestore();
  const base = { ...activePartnerProject(uid, "supermarket"), ...merchantFields(uid) };
  const ref = doc(db, "projects", `${uid}_supermarket`);
  for (const changes of [
    { merchantId: "attacker-selected" },
    { originalSubscriberId: "another_user" },
    { assignedSubscriberId: "another_user" },
    { assignmentStatus: "platform_managed" },
    { platformManaged: true },
    { linkedAt: Timestamp.now() },
    { assignmentUpdatedAt: Timestamp.now() }
  ]) {
    await assertFails(setDoc(ref, { ...base, ...changes }));
  }
  const { merchantId, ...withoutId } = base;
  await assertFails(setDoc(ref, withoutId));
});

test("subscriber cannot edit merchant assignment or backfill identity on old project", async () => {
  const uid = "central_change";
  await seedUser(uid);
  await seedProject(`${uid}_supermarket`, {
    ...activePartnerProject(uid, "supermarket"),
    ...merchantFields(uid)
  });
  const db = testEnv.authenticatedContext(uid).firestore();
  const ref = doc(db, "projects", `${uid}_supermarket`);
  for (const change of [
    { assignedSubscriberId: "other" },
    { originalSubscriberId: "other" },
    { merchantId: "m_" + "b".repeat(32) },
    { platformManaged: true },
    { assignmentStatus: "platform_managed" },
    { linkedAt: Timestamp.now() }
  ]) {
    await assertFails(updateDoc(ref, change));
  }
});

test("legacy project data remains readable and safe to update normally", async () => {
  const uid = "central_legacy";
  await seedUser(uid);
  await seedProject(`${uid}_restaurant`, activePartnerProject(uid, "restaurant"));
  const db = testEnv.authenticatedContext(uid).firestore();
  const ref = doc(db, "projects", `${uid}_restaurant`);
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, { businessName: "Renamed local restaurant" }));
});

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


for (const templateType of ["supermarket", "restaurant", "bakery"]) {
  test(`public customer can use ${templateType} runtime without reading private project root`, async () => {
    const { projectId } = await seedPartnerRuntime(templateType, "public_projection");
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(db, "projects", projectId)));

    const runtimeRef = templateType === "supermarket"
      ? doc(db, "supermarkets", projectId)
      : doc(db, "restaurants", projectId);

    await assertSucceeds(getDoc(runtimeRef));
  });
}

test("paused supermarket hides its public runtime and products", async () => {
  const { projectId } = await seedPartnerRuntime("supermarket", "paused_public");
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, "supermarkets", projectId), { isAcceptingOrders: false });
    await setDoc(doc(db, "supermarkets", projectId, "products", "milk"), {
      productId: "milk",
      projectId,
      name: "Milk",
      category: "Dairy",
      size: "1L",
      barcode: "",
      image: "",
      price: 40,
      inStock: true,
      isActive: true,
      source: "test",
      masterId: "milk",
      createdBy: "seed",
      createdAt: Timestamp.now(),
      updatedBy: "seed",
      updatedAt: Timestamp.now()
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "supermarkets", projectId)));
  await assertFails(getDoc(doc(db, "supermarkets", projectId, "products", "milk")));
});

test("paused restaurant hides its public runtime and menu", async () => {
  const { projectId } = await seedPartnerRuntime("restaurant", "paused_public");
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, "restaurants", projectId), { isAcceptingOrders: false });
    await setDoc(doc(db, "restaurants", projectId, "menu", "meal"), {
      itemId: "meal",
      projectId,
      name: "Meal",
      category: "Main",
      description: "",
      unit: "قطعة",
      price: 80,
      image: "",
      isAvailable: true,
      isActive: true,
      createdBy: "seed",
      createdAt: Timestamp.now(),
      updatedBy: "seed",
      updatedAt: Timestamp.now()
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "restaurants", projectId)));
  await assertFails(getDoc(doc(db, "restaurants", projectId, "menu", "meal")));
});

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
  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  const ledgerSnap = await getDoc(doc(ownerDb, "commissionLedger", "project_order_" + orderId));
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

test("laundry commission and customer tracking stay atomic through dispatch and delivery", async () => {
  const { ownerId, projectId } = await seedPartnerRuntime("laundry", "dispatch_trigger");
  const operatorUid = "operator_laundry";
  const orderId = "laundry_dispatch_order";
  const workerId = "laundry_delivery_agent";
  const token = "f".repeat(48);
  const baseOrder = laundryOrder(projectId);
  baseOrder.trackingToken = token;

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
      ...baseOrder,
      status: "accepted",
      laundryStage: "ready_delivery",
      assignedWorkerId: workerId,
      assignedWorkerName: "Delivery Agent",
      assignedWorkerRole: "delivery_agent",
      assignedWorkerWhatsapp: "201000000003"
    });
    await setDoc(doc(db, "orderTracking", token), {
      trackingToken: token,
      orderId,
      projectId,
      templateType: "laundry",
      status: "ready_delivery",
      items: baseOrder.items,
      subtotal: baseOrder.price,
      deliveryFee: 0,
      total: baseOrder.price,
      createdAt: new Date("2026-10-01T10:00:00Z"),
      updatedAt: new Date("2026-10-01T10:00:00Z")
    });
  });

  const db = testEnv.authenticatedContext(operatorUid).firestore();
  const dispatch = writeBatch(db);

  dispatch.update(doc(db, "orders", orderId), {
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

  dispatch.update(doc(db, "orderTracking", token), {
    status: "out_for_delivery",
    items: baseOrder.items,
    subtotal: baseOrder.price,
    deliveryFee: 0,
    total: baseOrder.price,
    updatedAt: serverTimestamp()
  });

  dispatch.set(doc(db, "commissionLedger", "project_order_" + orderId), {
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

  const delivery = writeBatch(db);
  delivery.update(doc(db, "orders", orderId), {
    status: "done",
    laundryStage: "delivered",
    deliveredAt: serverTimestamp(),
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: operatorUid
  });
  delivery.update(doc(db, "orderTracking", token), {
    status: "delivered",
    items: baseOrder.items,
    subtotal: baseOrder.price,
    deliveryFee: 0,
    total: baseOrder.price,
    updatedAt: serverTimestamp(),
    deliveredAt: serverTimestamp()
  });

  await assertSucceeds(delivery.commit());

  const publicDb = testEnv.unauthenticatedContext().firestore();
  const trackingSnap = await getDoc(doc(publicDb, "orderTracking", token));
  assert.equal(trackingSnap.data().status, "delivered");
});

test("operator declares payment, owner confirms it, and admin stays read-only", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("peer_settlement");
  const adminId = "admin_peer_settlement";
  const settlementId = "peer_settlement_1";

  await seedUser(adminId, { role: "admin" });

  const operatorDb = testEnv.authenticatedContext(operatorUid).firestore();
  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  const adminDb = testEnv.authenticatedContext(adminId).firestore();

  await assertSucceeds(
    setDoc(doc(operatorDb, "commissionSettlements", settlementId), {
      settlementId,
      projectId,
      ownerId,
      operatorId: projectId,
      templateId: "supermarket",
      businessName: "Commission Store",
      currency: "EGP",
      amount: 25,
      status: "pending_owner_confirmation",
      paymentMethod: "instapay",
      paymentReference: "TX-123",
      note: "",
      declaredAt: serverTimestamp(),
      declaredBy: operatorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      confirmedAt: null,
      confirmedBy: null,
      rejectedAt: null,
      rejectedBy: null
    })
  );

  await assertSucceeds(
    setDoc(doc(operatorDb, "commissionPaymentStates", projectId), {
      projectId,
      ownerId,
      operatorId: projectId,
      pendingSettlementId: settlementId,
      updatedAt: serverTimestamp()
    })
  );

  await assertFails(
    setDoc(doc(adminDb, "commissionSettlements", "admin_cannot_create"), {
      settlementId: "admin_cannot_create",
      projectId,
      ownerId,
      operatorId: projectId,
      templateId: "supermarket",
      businessName: "Commission Store",
      currency: "EGP",
      amount: 25,
      status: "pending_owner_confirmation",
      paymentMethod: "instapay",
      paymentReference: "",
      note: "",
      declaredAt: serverTimestamp(),
      declaredBy: adminId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      confirmedAt: null,
      confirmedBy: null,
      rejectedAt: null,
      rejectedBy: null
    })
  );

  await assertFails(
    updateDoc(doc(operatorDb, "commissionSettlements", settlementId), {
      status: "confirmed",
      confirmedAt: serverTimestamp(),
      confirmedBy: operatorUid,
      updatedAt: serverTimestamp()
    })
  );

  await assertSucceeds(
    updateDoc(doc(ownerDb, "commissionSettlements", settlementId), {
      status: "confirmed",
      confirmedAt: serverTimestamp(),
      confirmedBy: ownerId,
      updatedAt: serverTimestamp()
    })
  );

  await assertSucceeds(
    updateDoc(doc(ownerDb, "commissionPaymentStates", projectId), {
      pendingSettlementId: "",
      updatedAt: serverTimestamp()
    })
  );

  await assertSucceeds(getDoc(doc(adminDb, "commissionSettlements", settlementId)));
  await assertSucceeds(getDoc(doc(ownerDb, "commissionSettlements", settlementId)));
  await assertSucceeds(getDoc(doc(operatorDb, "commissionSettlements", settlementId)));

  await assertFails(
    updateDoc(doc(adminDb, "commissionSettlements", settlementId), {
      status: "rejected",
      rejectedAt: serverTimestamp(),
      rejectedBy: adminId,
      updatedAt: serverTimestamp()
    })
  );
});

test("project operator can read only its project commission ledger entries", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("operator_ledger_read");
  const entryId = "project_order_operator_ledger_read";

  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "commissionLedger", entryId), {
      userId: ownerId,
      projectId,
      orderId: "operator_ledger_read",
      sourceType: "project_order",
      sourceId: "operator_ledger_read",
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
  });

  const operatorDb = testEnv.authenticatedContext(operatorUid).firestore();
  await assertSucceeds(getDoc(doc(operatorDb, "commissionLedger", entryId)));

  const otherDb = testEnv.authenticatedContext("other_operator_uid").firestore();
  await assertFails(getDoc(doc(otherDb, "commissionLedger", entryId)));
});


test("commission reversal requires operator request and owner confirmation", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("reversal_handshake");
  const orderId = "reversal_handshake_order";
  const ledgerId = "project_order_" + orderId;
  const reversalId = "project_order_" + orderId;

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, "orders", orderId), {
      projectId,
      providerId: projectId,
      templateType: "supermarket",
      status: "canceled",
      pricingLocked: true,
      assignedWorkerId: "rider_1",
      assignedWorkerRole: "rider",
      commissionEligible: true,
      commissionLocked: true,
      commissionAmount: 5,
      commissionAgreementVersion: 1
    });

    await setDoc(doc(db, "commissionLedger", ledgerId), {
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
  });

  const operatorDb = testEnv.authenticatedContext(operatorUid).firestore();
  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  const strangerDb = testEnv.authenticatedContext("reversal_stranger").firestore();

  await assertSucceeds(
    setDoc(doc(operatorDb, "commissionReversals", reversalId), {
      reversalId,
      projectId,
      orderId,
      ledgerEntryId: ledgerId,
      ownerId,
      operatorId: projectId,
      amount: 5,
      currency: "EGP",
      reasonCode: "delivery_failed",
      note: "تعذر التسليم",
      status: "pending_owner_confirmation",
      requestedAt: serverTimestamp(),
      requestedBy: operatorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      confirmedAt: null,
      confirmedBy: null,
      rejectedAt: null,
      rejectedBy: null
    })
  );

  await assertFails(
    updateDoc(doc(operatorDb, "commissionReversals", reversalId), {
      status: "confirmed",
      confirmedAt: serverTimestamp(),
      confirmedBy: operatorUid,
      updatedAt: serverTimestamp()
    })
  );

  await assertFails(getDoc(doc(strangerDb, "commissionReversals", reversalId)));
  await assertSucceeds(getDoc(doc(ownerDb, "commissionReversals", reversalId)));

  const batch = writeBatch(ownerDb);
  batch.update(doc(ownerDb, "commissionReversals", reversalId), {
    status: "confirmed",
    confirmedAt: serverTimestamp(),
    confirmedBy: ownerId,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(ownerDb, "commissionLedger", ledgerId), {
    status: "reversed",
    reversedAt: serverTimestamp(),
    reversalId,
    reversalReason: "delivery_failed",
    reversalConfirmedBy: ownerId
  });

  await assertSucceeds(batch.commit());

  const ledgerSnap = await getDoc(doc(ownerDb, "commissionLedger", ledgerId));
  assert.equal(ledgerSnap.data().status, "reversed");
});

test("commission reversal cannot be requested before the order is canceled", async () => {
  const { ownerId, operatorUid, projectId } = await seedCommissionIntegrityFixture("reversal_requires_cancel");
  const orderId = "reversal_requires_cancel_order";
  const ledgerId = "project_order_" + orderId;

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, "orders", orderId), {
      projectId,
      providerId: projectId,
      templateType: "supermarket",
      status: "out_for_delivery",
      pricingLocked: true,
      assignedWorkerId: "rider_1",
      assignedWorkerRole: "rider",
      commissionEligible: true,
      commissionLocked: true,
      commissionAmount: 5,
      commissionAgreementVersion: 1
    });

    await setDoc(doc(db, "commissionLedger", ledgerId), {
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
  });

  const operatorDb = testEnv.authenticatedContext(operatorUid).firestore();

  await assertFails(
    setDoc(doc(operatorDb, "commissionReversals", ledgerId), {
      reversalId: ledgerId,
      projectId,
      orderId,
      ledgerEntryId: ledgerId,
      ownerId,
      operatorId: projectId,
      amount: 5,
      currency: "EGP",
      reasonCode: "delivery_failed",
      note: "",
      status: "pending_owner_confirmation",
      requestedAt: serverTimestamp(),
      requestedBy: operatorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      confirmedAt: null,
      confirmedBy: null,
      rejectedAt: null,
      rejectedBy: null
    })
  );
});


function subscriptionPaymentRecord(uid, paymentId, extra = {}) {
  return {
    paymentId,
    userId: uid,
    userEmail: `${uid}@example.com`,
    paymentType: "initial",
    amount: 350,
    currency: "EGP",
    paymentMethod: "instapay",
    paymentReference: "REF-12345",
    paymentCode: "FB-TEST-12345",
    proofChannel: "whatsapp",
    status: "pending_review",
    submittedAt: serverTimestamp(),
    whatsappPreparedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: "",
    rejectionReason: "",
    ...extra
  };
}

function atomicSubscriptionProof(db,uid,paymentId,extra={}){
 const batch=writeBatch(db);
 batch.set(doc(db,"subscriptionBillingGuards",uid),{
  userId:uid,pendingPaymentId:paymentId,lastReviewedPaymentId:"",
  revision:1,recoverySafe:false,updatedAt:serverTimestamp()
 });
 batch.set(doc(db,"subscriptionPayments",paymentId),subscriptionPaymentRecord(uid,paymentId,extra));
 return batch.commit();
}
function resolveBillingProofInBatch(batch,db,uid,paymentId){
 batch.update(doc(db,"subscriptionBillingGuards",uid),{
  pendingPaymentId:"",lastReviewedPaymentId:paymentId,revision:2,updatedAt:serverTimestamp()
 });
}
test("subscriber can create a valid initial subscription payment proof record", async () => {
  const uid = "payment_owner";
  const paymentId = `${uid}_1`;
  await seedUser(uid, {
    isActive: false,
    subscriptionStatus: "pending",
    initialActivationPaid: false
  });
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertSucceeds(atomicSubscriptionProof(db,uid,paymentId));
});

test("subscriber cannot forge subscription payment amount or owner", async () => {
  const uid = "payment_guard_owner";
  await seedUser(uid, {
    isActive: false,
    subscriptionStatus: "pending",
    initialActivationPaid: false
  });
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertFails(
    setDoc(
      doc(db, "subscriptionPayments", `${uid}_wrong_amount`),
      subscriptionPaymentRecord(uid, `${uid}_wrong_amount`, { amount: 1 })
    )
  );

  await assertFails(
    setDoc(
      doc(db, "subscriptionPayments", `${uid}_wrong_owner`),
      subscriptionPaymentRecord("someone_else", `${uid}_wrong_owner`)
    )
  );
});

test("subscriber can query only their own subscription payment records", async () => {
  const uid = "payment_query_owner";
  const otherUid = "payment_query_other";
  await seedUser(uid);
  await seedUser(otherUid);

  await testEnv.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    await setDoc(
      doc(adminDb, "subscriptionPayments", `${uid}_a`),
      subscriptionPaymentRecord(uid, `${uid}_a`, { submittedAt: new Date("2026-10-01T10:00:00Z") })
    );
    await setDoc(
      doc(adminDb, "subscriptionPayments", `${otherUid}_a`),
      subscriptionPaymentRecord(otherUid, `${otherUid}_a`, { submittedAt: new Date("2026-10-01T11:00:00Z") })
    );
  });

  const db = testEnv.authenticatedContext(uid).firestore();

  await assertSucceeds(
    getDocs(query(collection(db, "subscriptionPayments"), where("userId", "==", uid)))
  );
  await assertFails(getDocs(collection(db, "subscriptionPayments")));
});


async function seedPendingSubscriptionReviewFixture(suffix = "review") {
  const uid = `subscriber_${suffix}`;
  const adminId = `admin_${suffix}`;
  const paymentId = `${uid}_payment`;

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users", uid), {
      uid,
      name: "Subscriber",
      email: `${uid}@example.com`,
      isActive: false,
      subscriptionStatus: "pending",
      initialActivationPaid: false,
      billingCycle: "initial",
      referredByUserId: "",
      referralQualified: false
    });
    await setDoc(doc(db, "users", adminId), {
      uid: adminId,
      name: "Admin",
      email: `${adminId}@example.com`,
      role: "admin",
      isActive: true,
      subscriptionStatus: "active"
    });
    await setDoc(
      doc(db, "subscriptionPayments", paymentId),
      subscriptionPaymentRecord(uid, paymentId, {
        submittedAt: new Date("2026-10-01T10:00:00Z")
      })
    );
    await setDoc(doc(db,"subscriptionBillingGuards",uid),{
      userId:uid,pendingPaymentId:paymentId,lastReviewedPaymentId:"",
      revision:1,recoverySafe:false,updatedAt:new Date("2026-10-01T10:00:00Z")
    });
  });

  return { uid, adminId, paymentId };
}

function initialActivationUpdate(paymentId, amount = 350) {
  return {
    isActive: true,
    subscriptionStatus: "active",
    initialActivationPaid: true,
    billingCycle: "monthly",
    subscriptionStartedAt: serverTimestamp(),
    subscriptionExpiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    lastPaymentAmount: amount,
    lastPaymentType: "initial",
    lastPaymentAt: serverTimestamp(),
    lastSubscriptionPaymentId: paymentId,
    lastRenewalAt: null,
    activatedAt: serverTimestamp()
  };
}

test("admin cannot activate a subscriber without atomically approving a matching payment", async () => {
  const { uid, adminId, paymentId } = await seedPendingSubscriptionReviewFixture("activation_gate");
  const adminDb = testEnv.authenticatedContext(adminId).firestore();

  await assertFails(
    updateDoc(doc(adminDb, "users", uid), initialActivationUpdate(paymentId))
  );
});

test("admin cannot approve payment without activating its subscriber in the same atomic write", async () => {
  const { adminId, paymentId } = await seedPendingSubscriptionReviewFixture("approval_gate");
  const adminDb = testEnv.authenticatedContext(adminId).firestore();

  await assertFails(
    updateDoc(doc(adminDb, "subscriptionPayments", paymentId), {
      status: "approved",
      reviewedAt: serverTimestamp(),
      reviewedBy: adminId,
      rejectionReason: ""
    })
  );
});

test("admin can atomically approve payment and activate subscriber with matching snapshot", async () => {
  const { uid, adminId, paymentId } = await seedPendingSubscriptionReviewFixture("atomic_approval");
  const adminDb = testEnv.authenticatedContext(adminId).firestore();
  const batch = writeBatch(adminDb);

  batch.update(doc(adminDb, "subscriptionPayments", paymentId), {
    status: "approved",
    reviewedAt: serverTimestamp(),
    reviewedBy: adminId,
    rejectionReason: ""
  });
  batch.update(doc(adminDb, "users", uid), initialActivationUpdate(paymentId));
  resolveBillingProofInBatch(batch,adminDb,uid,paymentId);

  await assertSucceeds(batch.commit());

  const [paymentSnap, userSnap] = await Promise.all([
    getDoc(doc(adminDb, "subscriptionPayments", paymentId)),
    getDoc(doc(adminDb, "users", uid))
  ]);

  assert.equal(paymentSnap.data().status, "approved");
  assert.equal(userSnap.data().subscriptionStatus, "active");
  assert.equal(userSnap.data().lastSubscriptionPaymentId, paymentId);
});

test("payment approval and activation fail when amount snapshot does not match", async () => {
  const { uid, adminId, paymentId } = await seedPendingSubscriptionReviewFixture("amount_mismatch");
  const adminDb = testEnv.authenticatedContext(adminId).firestore();
  const batch = writeBatch(adminDb);

  batch.update(doc(adminDb, "subscriptionPayments", paymentId), {
    status: "approved",
    reviewedAt: serverTimestamp(),
    reviewedBy: adminId,
    rejectionReason: ""
  });
  batch.update(doc(adminDb, "users", uid), initialActivationUpdate(paymentId, 59));

  await assertFails(batch.commit());
});

test("admin can reject pending proof without activating subscriber and subscriber cannot review it", async () => {
  const { uid, adminId, paymentId } = await seedPendingSubscriptionReviewFixture("rejection");
  const adminDb = testEnv.authenticatedContext(adminId).firestore();
  const subscriberDb = testEnv.authenticatedContext(uid).firestore();

  await assertFails(
    updateDoc(doc(subscriberDb, "subscriptionPayments", paymentId), {
      status: "rejected",
      reviewedAt: serverTimestamp(),
      reviewedBy: uid,
      rejectionReason: "غير واضح"
    })
  );

  const rejectBatch=writeBatch(adminDb);
  rejectBatch.update(doc(adminDb,"subscriptionPayments",paymentId),{
    status:"rejected",reviewedAt:serverTimestamp(),reviewedBy:adminId,
    rejectionReason:"صورة التحويل غير واضحة"
  });
  resolveBillingProofInBatch(rejectBatch,adminDb,uid,paymentId);
  await assertSucceeds(rejectBatch.commit());

  const userSnap = await getDoc(doc(adminDb, "users", uid));
  assert.equal(userSnap.data().subscriptionStatus, "pending");
  assert.equal(userSnap.data().isActive, false);
});


test("public laundry order and tracking record can be created atomically", async () => {
  const { projectId } = await seedPartnerRuntime("laundry", "customer_tracking_create");
  const db = testEnv.unauthenticatedContext().firestore();
  const orderId = "laundry_tracking_create_order";
  const token = "c".repeat(48);
  const order = laundryOrder(projectId);
  order.trackingToken = token;

  const batch = writeBatch(db);
  batch.set(doc(db, "orders", orderId), order);
  batch.set(doc(db, "orderTracking", token), {
    trackingToken: token,
    orderId,
    projectId,
    templateType: "laundry",
    status: "new",
    items: order.items,
    subtotal: order.price,
    deliveryFee: 0,
    total: order.price,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await assertSucceeds(batch.commit());

  await assertSucceeds(getDoc(doc(db, "orderTracking", token)));
  await assertFails(getDocs(collection(db, "orderTracking")));
});

test("laundry operator can update order stage and public tracking atomically", async () => {
  const { projectId } = await seedPartnerRuntime("laundry", "customer_tracking_stage");
  const operatorUid = "operator_laundry";
  const orderId = "laundry_tracking_stage_order";
  const token = "d".repeat(48);
  const order = laundryOrder(projectId);
  order.trackingToken = token;

  await testEnv.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, "orders", orderId), order);
    await setDoc(doc(adminDb, "orderTracking", token), {
      trackingToken: token,
      orderId,
      projectId,
      templateType: "laundry",
      status: "new",
      items: order.items,
      subtotal: order.price,
      deliveryFee: 0,
      total: order.price,
      createdAt: new Date("2026-10-01T10:00:00Z"),
      updatedAt: new Date("2026-10-01T10:00:00Z")
    });
  });

  const db = testEnv.authenticatedContext(operatorUid).firestore();
  const batch = writeBatch(db);

  batch.update(doc(db, "orders", orderId), {
    status: "accepted",
    laundryStage: "accepted",
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: operatorUid
  });
  batch.update(doc(db, "orderTracking", token), {
    status: "accepted",
    items: order.items,
    subtotal: order.price,
    deliveryFee: 0,
    total: order.price,
    updatedAt: serverTimestamp()
  });

  await assertSucceeds(batch.commit());

  const publicDb = testEnv.unauthenticatedContext().firestore();
  const trackingSnap = await getDoc(doc(publicDb, "orderTracking", token));
  assert.equal(trackingSnap.data().status, "accepted");
});

test("laundry tracking update cannot claim a stage different from the order", async () => {
  const { projectId } = await seedPartnerRuntime("laundry", "customer_tracking_mismatch");
  const operatorUid = "operator_laundry";
  const orderId = "laundry_tracking_mismatch_order";
  const token = "e".repeat(48);
  const order = laundryOrder(projectId);
  order.trackingToken = token;

  await testEnv.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, "orders", orderId), {
      ...order,
      status: "accepted",
      laundryStage: "accepted"
    });
    await setDoc(doc(adminDb, "orderTracking", token), {
      trackingToken: token,
      orderId,
      projectId,
      templateType: "laundry",
      status: "accepted",
      items: order.items,
      subtotal: order.price,
      deliveryFee: 0,
      total: order.price,
      createdAt: new Date("2026-10-01T10:00:00Z"),
      updatedAt: new Date("2026-10-01T10:00:00Z")
    });
  });

  const db = testEnv.authenticatedContext(operatorUid).firestore();

  await assertFails(
    updateDoc(doc(db, "orderTracking", token), {
      status: "delivered",
      items: order.items,
      subtotal: order.price,
      deliveryFee: 0,
      total: order.price,
      updatedAt: serverTimestamp()
    })
  );
});


async function seedPromoFixture(suffix = "promo", counterCount = null) {
  const uid = `promo_user_${suffix}`;
  const adminId = `promo_admin_${suffix}`;

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users", uid), {
      uid,
      name: "Promo User",
      email: `${uid}@example.com`,
      isActive: false,
      subscriptionStatus: "pending",
      initialActivationPaid: false,
      billingCycle: "initial",
      referredByUserId: "",
      referralQualified: false
    });
    await setDoc(doc(db, "users", adminId), {
      uid: adminId,
      name: "Promo Admin",
      email: `${adminId}@example.com`,
      role: "admin",
      isActive: true,
      subscriptionStatus: "active"
    });
    if (counterCount !== null) {
      await setDoc(doc(db, "platformCounters", "launch50"), {
        campaignId: "launch50",
        count: counterCount,
        limit: 50,
        lastGrantedUserId: "seed_user",
        updatedAt: new Date("2026-10-01T10:00:00Z")
      });
    }
  });

  return { uid, adminId };
}

function promoGrantRecord(uid, adminId) {
  return {
    grantId: `launch50_${uid}`,
    userId: uid,
    campaignId: "launch50",
    status: "granted",
    paymentRequired: false,
    value: 350,
    currency: "EGP",
    subscriptionDays: 30,
    grantedAt: serverTimestamp(),
    grantedBy: adminId
  };
}

function promoUserActivation(uid) {
  return {
    isActive: true,
    subscriptionStatus: "active",
    initialActivationPaid: false,
    billingCycle: "monthly",
    subscriptionStartedAt: serverTimestamp(),
    subscriptionExpiresAt: Timestamp.fromDate(new Date("2099-01-01T00:00:00Z")),
    activatedAt: serverTimestamp(),
    lastActivationSource: "launch_promo",
    lastSubscriptionGrantId: `launch50_${uid}`,
    launchPromoCampaignId: "launch50"
  };
}

test("admin can atomically grant one Launch 50 subscription without payment proof", async () => {
  const { uid, adminId } = await seedPromoFixture("success", null);
  const db = testEnv.authenticatedContext(adminId).firestore();
  const batch = writeBatch(db);

  batch.set(doc(db, "subscriptionGrants", `launch50_${uid}`), promoGrantRecord(uid, adminId));
  batch.set(doc(db, "platformCounters", "launch50"), {
    campaignId: "launch50",
    count: 1,
    limit: 50,
    lastGrantedUserId: uid,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, "users", uid), promoUserActivation(uid));

  await assertSucceeds(batch.commit());

  const userSnap = await getDoc(doc(db, "users", uid));
  assert.equal(userSnap.data().subscriptionStatus, "active");
  assert.equal(userSnap.data().initialActivationPaid, false);
  assert.equal(userSnap.data().lastActivationSource, "launch_promo");
});

test("Launch 50 activation fails if grant/counter are not written atomically", async () => {
  const { uid, adminId } = await seedPromoFixture("missing_grant", null);
  const db = testEnv.authenticatedContext(adminId).firestore();

  await assertFails(
    updateDoc(doc(db, "users", uid), promoUserActivation(uid))
  );
});

test("Launch 50 cannot exceed the first 50 users", async () => {
  const { uid, adminId } = await seedPromoFixture("full", 50);
  const db = testEnv.authenticatedContext(adminId).firestore();
  const batch = writeBatch(db);

  batch.set(doc(db, "subscriptionGrants", `launch50_${uid}`), promoGrantRecord(uid, adminId));
  batch.update(doc(db, "platformCounters", "launch50"), {
    campaignId: "launch50",
    count: 51,
    limit: 50,
    lastGrantedUserId: uid,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, "users", uid), promoUserActivation(uid));

  await assertFails(batch.commit());
});

test("subscriber cannot grant themselves Launch 50", async () => {
  const { uid, adminId } = await seedPromoFixture("self", null);
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertFails(
    setDoc(doc(db, "subscriptionGrants", `launch50_${uid}`), promoGrantRecord(uid, adminId))
  );
});


function trialAccount(uid, extra={}) {
  return {
    uid, name:"New Trial", email:`${uid}@example.com`, projectType:"",
    isActive:true, subscriptionStatus:"trial", initialActivationPaid:false,
    billingCycle:"initial", referredByUserId:"", referralQualified:false,
    accessModel:"merchant_trial_v1", firstMerchantLinkedAt:null,
    createdAt:serverTimestamp(), ...extra
  };
}

function trialProject(uid, type="supermarket") {
  return {
    ownerId:uid, projectId:type, template:type, operatingModel:"partner_operated",
    templateVersion:type==="laundry"?3:1,
    operatorId:"", partnerSetupStatus:"not_started", businessName:"Trial Shop",
    status:"active", isActive:true, createdAt:serverTimestamp(),
    whatsappNumber:"", instapayLink:"", logo:"", coverImage:"",
    primaryColor:"#168a63", priceConfig:{}
  };
}

test("Phase B2 permits trusted server-anchored signup while preserving legacy registration", async () => {
  const uid="trial_reg1", db=testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(setDoc(doc(db,"users",uid),trialAccount(uid)));
  const legacyUid="legacy_reg1", legacy=testEnv.authenticatedContext(legacyUid).firestore();
  const legacyData=trialAccount(legacyUid,{isActive:false,subscriptionStatus:"pending"});
  delete legacyData.accessModel;
  delete legacyData.firstMerchantLinkedAt;
  await assertSucceeds(setDoc(doc(legacy,"users",legacyUid),legacyData));
});

test("Phase B2 forbids forged signup merchant timestamps, subscriptions and authorization", async () => {
  const uid="trial_bad", db=testEnv.authenticatedContext(uid).firestore();
  await assertFails(setDoc(doc(db,"users",uid),trialAccount(uid,{firstMerchantLinkedAt:new Date()})));
  await assertFails(setDoc(doc(db,"users",uid),trialAccount(uid,{role:"admin"})));
  await assertFails(setDoc(doc(db,"users",uid),trialAccount(uid,{createdAt:new Date("2000-01-01T00:00:00Z")})));
  await assertFails(setDoc(doc(db,"users",uid),trialAccount(uid,{subscriptionStatus:"active"})));
});

test("Phase B2 trial can create project during setup week but not after signup window expires", async () => {
  const fresh="trial_project_fresh";
  const db=testEnv.authenticatedContext(fresh).firestore();
  await assertSucceeds(setDoc(doc(db,"users",fresh),trialAccount(fresh)));
  await assertSucceeds(setDoc(doc(db,"projects",fresh+"_supermarket"),trialProject(fresh)));

  const expired="trial_project_expired";
  await seedUser(expired,{
    accessModel:"merchant_trial_v1", firstMerchantLinkedAt:null,
    isActive:true, subscriptionStatus:"trial", initialActivationPaid:false,
    createdAt:new Date(Date.now()-8*86400000)
  });
  const oldDb=testEnv.authenticatedContext(expired).firestore();
  await assertFails(setDoc(doc(oldDb,"projects",expired+"_restaurant"),trialProject(expired,"restaurant")));
});

test("Phase B2 validates linked merchant grace using immutable server timestamp", async () => {
  const uid="trial_project_grace";
  await seedUser(uid,{
    accessModel:"merchant_trial_v1",
    isActive:true, subscriptionStatus:"trial", initialActivationPaid:false,
    createdAt:new Date(Date.now()-8*86400000),
    firstMerchantLinkedAt:new Date(Date.now()-1*86400000),
    firstMerchantProjectId:"accepted_merchant"
  });
  const db=testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(setDoc(doc(db,"projects",uid+"_restaurant"),trialProject(uid,"restaurant")));

  const expired="trial_grace_expired";
  await seedUser(expired,{
    accessModel:"merchant_trial_v1", isActive:true,subscriptionStatus:"trial",
    initialActivationPaid:false,
    createdAt:new Date(Date.now()-8*86400000),
    firstMerchantLinkedAt:new Date(Date.now()-4*86400000),
    firstMerchantProjectId:"accepted_merchant"
  });
  await assertFails(setDoc(doc(testEnv.authenticatedContext(expired).firestore(),"projects",expired+"_restaurant"),trialProject(expired,"restaurant")));
});

test("Phase B2 first payment is 59 for opted-in trial and old 350 for legacy users", async () => {
  const uid="trial_payment_59", db=testEnv.authenticatedContext(uid).firestore();
  await assertSucceeds(setDoc(doc(db,"users",uid),trialAccount(uid)));
  await assertSucceeds(atomicSubscriptionProof(db,uid,uid+"_59",{amount:59}));
  await assertFails(setDoc(doc(db,"subscriptionPayments",uid+"_350"),subscriptionPaymentRecord(uid,uid+"_350",{amount:350})));
  const oldUid="old_payment_350";
  await seedUser(oldUid,{isActive:false,subscriptionStatus:"pending"});
  const oldDb=testEnv.authenticatedContext(oldUid).firestore();
  await assertSucceeds(atomicSubscriptionProof(oldDb,oldUid,oldUid+"_350"));
  await assertFails(setDoc(doc(oldDb,"subscriptionPayments",oldUid+"_59"),subscriptionPaymentRecord(oldUid,oldUid+"_59",{amount:59})));
});

test("Phase B2 blocks subscribers and strangers from forging first-merchant acceptance timestamps", async () => {
  const uid="trial_forged_link";
  await seedUser(uid,{
    accessModel:"merchant_trial_v1",firstMerchantLinkedAt:null,
    isActive:true,subscriptionStatus:"trial",initialActivationPaid:false,
    createdAt:new Date(Date.now()-86400000)
  });
  const subscriber=testEnv.authenticatedContext(uid).firestore();
  await assertFails(updateDoc(doc(subscriber,"users",uid),{
    firstMerchantLinkedAt:serverTimestamp(),
    firstMerchantProjectId:uid+"_supermarket"
  }));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext("attacker").firestore(),"users",uid),{
    firstMerchantLinkedAt:serverTimestamp(),
    firstMerchantProjectId:uid+"_supermarket"
  }));
});

test("Phase B2 locks the first merchant anchor against edits even by the subscriber", async () => {
  const uid="trial_immutable_link";
  await seedUser(uid,{
    accessModel:"merchant_trial_v1",
    firstMerchantLinkedAt:new Date(Date.now()-86400000),
    firstMerchantProjectId:uid+"_restaurant",
    createdAt:new Date(Date.now()-2*86400000),
    subscriptionStatus:"trial",isActive:true,initialActivationPaid:false
  });
  const db=testEnv.authenticatedContext(uid).firestore();
  await assertFails(updateDoc(doc(db,"users",uid),{firstMerchantLinkedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(db,"users",uid),{firstMerchantProjectId:"other"}));
});

async function seedTrialFirstAgreement(suffix) {
  const ownerUid="trial_first_"+suffix;
  const operatorUid="trial_operator_"+suffix;
  const projectId=ownerUid+"_supermarket";
  await testEnv.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,"users",ownerUid),{
      uid:ownerUid,name:"Trial owner",email:ownerUid+"@example.com",
      accessModel:"merchant_trial_v1",
      firstMerchantLinkedAt:null,createdAt:new Date(Date.now()-86400000),
      subscriptionStatus:"trial",isActive:true,initialActivationPaid:false,
      billingCycle:"initial"
    });
    await setDoc(doc(db,"projects",projectId),{
      ...trialProject(ownerUid),operatorId:projectId,partnerSetupStatus:"partner_linked",
      createdAt:new Date(Date.now()-86400000)
    });
    await setDoc(doc(db,"operators",projectId),{
      operatorId:projectId,projectId,ownerId:ownerUid,templateId:"supermarket",
      authUid:operatorUid,status:"pending_agreement",
      agreementStatus:"pending",isActive:false
    });
    await setDoc(doc(db,"commissionAgreements",projectId),{
      agreementId:projectId,projectId,ownerId:ownerUid,operatorId:projectId,
      templateId:"supermarket",currency:"EGP",unit:"per_completed_order",
      currentAmount:null,acceptedVersion:0,pendingAmount:5,status:"pending",
      pendingStatus:"pending",version:1,acceptedAt:null,acceptedBy:""
    });
  });
  return {ownerUid,operatorUid,projectId};
}

function firstCommissionAcceptance(batch, db, operatorUid, projectId) {
  batch.update(doc(db,"commissionAgreements",projectId),{
    currentAmount:5,acceptedVersion:1,pendingAmount:null,
    status:"accepted",pendingStatus:"none",lastDecision:"accepted",
    acceptedAt:serverTimestamp(),acceptedBy:operatorUid,
    rejectedAt:null,updatedAt:serverTimestamp()
  });
  batch.update(doc(db,"operators",projectId),{
    agreementStatus:"accepted",status:"active",isActive:true,
    updatedAt:serverTimestamp()
  });
}

test("Phase B2 first accepted commission and first link timestamp must commit atomically", async () => {
  const {ownerUid,operatorUid,projectId}=await seedTrialFirstAgreement("atomic");
  const db=testEnv.authenticatedContext(operatorUid).firestore();
  const batch=writeBatch(db);
  firstCommissionAcceptance(batch,db,operatorUid,projectId);
  batch.update(doc(db,"users",ownerUid),{
    firstMerchantLinkedAt:serverTimestamp(),firstMerchantProjectId:projectId
  });
  await assertSucceeds(batch.commit());
  const user=await getDoc(doc(testEnv.authenticatedContext(ownerUid).firestore(),"users",ownerUid));
  assert.equal(user.data().firstMerchantProjectId,projectId);
  assert.ok(user.data().firstMerchantLinkedAt.toMillis()>0);
});

test("Phase B2 cannot accept first agreement without starting three-day clock", async () => {
  const {operatorUid,projectId}=await seedTrialFirstAgreement("without_anchor");
  const db=testEnv.authenticatedContext(operatorUid).firestore();
  const batch=writeBatch(db);
  firstCommissionAcceptance(batch,db,operatorUid,projectId);
  await assertFails(batch.commit());
});

async function seedTransferCaseScenario(suffix="audit") {
  const admin="admin_transfer_"+suffix;
  const owner="owner_transfer_"+suffix;
  const target="target_transfer_"+suffix;
  const operatorUid="operator_transfer_"+suffix;
  const projectId=owner+"_supermarket";
  const merchantId="m_"+"a".repeat(32);
  const recoveredAt=Timestamp.fromDate(new Date("2026-10-10T10:00:00Z"));
  await seedUser(admin,{role:"admin"});
  await seedUser(owner);
  await seedUser(target);
  await seedProject(projectId,{
    ownerId:owner,projectId:"supermarket",template:"supermarket",
    operatingModel:"partner_operated",templateVersion:1,
    operatorId:projectId,partnerSetupStatus:"active",
    merchantId,originalSubscriberId:owner,assignedSubscriberId:"",
    assignmentStatus:"platform_managed",platformManaged:true,
    recoveryAuditId:projectId,recoveryAt:recoveredAt,recoveryAdminUid:admin,
    linkedAt:null,assignmentUpdatedAt:null,
    businessName:"Test Merchant",status:"active",isActive:true
  });
  await testEnv.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,"operators",projectId),{
      operatorId:projectId,projectId,ownerId:owner,templateId:"supermarket",
      authUid:operatorUid,status:"active",isActive:true,agreementStatus:"accepted"
    });
    await setDoc(doc(db,"commissionAgreements",projectId),{
      agreementId:projectId,projectId,ownerId:owner,operatorId:projectId,
      templateId:"supermarket",status:"accepted",acceptedVersion:1,currentAmount:6,currency:"EGP"
    });
    await setDoc(doc(db,"merchantRecoveries",projectId),{
      recoveryId:projectId,projectDocId:projectId,merchantId,
      originalSubscriberId:owner,previousSubscriberId:owner,
      status:"completed",adminUid:admin,recoveredAt
    });
  });
  return {admin,owner,target,operatorUid,projectId,merchantId};
}

function sampleTransferCase(ids, overrides={}){
  return {
    projectDocId:ids.projectId,
    merchantId:ids.merchantId,
    originalSubscriberId:ids.owner,
    previousSubscriberId:"",
    proposedSubscriberId:ids.target,
    status:"awaiting_consents",
    operatorConsent:"pending",
    recipientConsent:"pending",
    operatorConsentedAt:null,
    recipientConsentedAt:null,
    financeClearance:"pending",
    cutoverAt:null,
    commissionAmount:6,commissionVersion:1,commissionCurrency:"EGP",
    reason:"المحل يحتاج إعادة تخصيص موثقة بعد انتهاء التعاون السابق",
    createdBy:ids.admin,createdAt:serverTimestamp(),
    ...overrides
  };
}

test("Phase C4 only admin opens consent case; existing project identities remain untouched",async()=>{
  const ids=await seedTransferCaseScenario("happy");
  const ref=db=>doc(db,"merchantTransferCases",ids.projectId);
  const outsider=testEnv.authenticatedContext("attacker_transfer").firestore();
  await assertFails(setDoc(ref(outsider),sampleTransferCase(ids)));
  const adminDb=testEnv.authenticatedContext(ids.admin).firestore();
  await assertSucceeds(setDoc(ref(adminDb),sampleTransferCase(ids)));
  const ownerDb=testEnv.authenticatedContext(ids.owner).firestore();
  const projectSnap=await getDoc(doc(ownerDb,"projects",ids.projectId));
  assert.equal(projectSnap.data().ownerId,ids.owner);
  assert.equal(projectSnap.data().assignedSubscriberId,"");
  assert.equal(projectSnap.data().platformManaged,true);
  await assertSucceeds(getDoc(ref(testEnv.authenticatedContext(ids.operatorUid).firestore())));
  await assertSucceeds(getDoc(ref(testEnv.authenticatedContext(ids.target).firestore())));
  // The departing subscriber retains historical finances but has no right
  // to inspect, accept or veto the new subscriber's consent case.
  await assertFails(getDoc(ref(ownerDb)));
  await assertFails(getDoc(ref(outsider)));
  await assertFails(updateDoc(ref(adminDb),{merchantId:"m_"+"b".repeat(32)}));
  await assertFails(deleteDoc(ref(adminDb)));
});

test("Phase C4 refuses new assignment while old subscriber still controls the shop",async()=>{
  const ids=await seedTransferCaseScenario("not_recovered");
  await testEnv.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),"projects",ids.projectId),{
      platformManaged:false,
      assignmentStatus:"assigned_to_subscriber",
      assignedSubscriberId:ids.owner
    });
  });
  const admin=testEnv.authenticatedContext(ids.admin).firestore();
  await assertFails(setDoc(doc(admin,"merchantTransferCases",ids.projectId),
    sampleTransferCase(ids,{previousSubscriberId:ids.owner})));
});

test("Phase C4 consent can only be recorded by physical operator and intended recipient",async()=>{
  const ids=await seedTransferCaseScenario("consent");
  const adminDb=testEnv.authenticatedContext(ids.admin).firestore();
  const ref=db=>doc(db,"merchantTransferCases",ids.projectId);
  await assertSucceeds(setDoc(ref(adminDb),sampleTransferCase(ids)));
  const operatorDb=testEnv.authenticatedContext(ids.operatorUid).firestore();
  const targetDb=testEnv.authenticatedContext(ids.target).firestore();
  const strangerDb=testEnv.authenticatedContext("stranger_transfer").firestore();
  await assertFails(updateDoc(ref(targetDb),{operatorConsent:"accepted",operatorConsentedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref(operatorDb),{recipientConsent:"accepted",recipientConsentedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref(strangerDb),{recipientConsent:"accepted",recipientConsentedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(operatorDb),{operatorConsent:"accepted",operatorConsentedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref(operatorDb),{operatorConsent:"declined",operatorConsentedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(targetDb),{recipientConsent:"accepted",recipientConsentedAt:serverTimestamp()}));
  const caseSnap=await getDoc(ref(adminDb));
  assert.equal(caseSnap.data().operatorConsent,"accepted");
  assert.equal(caseSnap.data().recipientConsent,"accepted");
  assert.equal(caseSnap.data().status,"awaiting_consents");
  assert.equal(caseSnap.data().financeClearance,"pending");
  assert.equal(caseSnap.data().cutoverAt,null);
});

test("Phase C4 disallows account-owner substitution, pre-consent and backdated cases",async()=>{
  const ids=await seedTransferCaseScenario("forgery");
  const db=testEnv.authenticatedContext(ids.admin).firestore();
  for(const extra of [
    {proposedSubscriberId:ids.owner},
    {operatorConsent:"accepted"},
    {recipientConsent:"accepted"},
    {financeClearance:"approved"},
    {cutoverAt:serverTimestamp()},
    {commissionAmount:60},
    {commissionVersion:10},
    {commissionCurrency:"USD"},
    {merchantId:"m_"+"b".repeat(32)},
    {createdAt:new Date("2020-01-01T00:00:00Z")},
    {reason:"too short"}
  ]) {
    await assertFails(setDoc(doc(db,"merchantTransferCases",ids.projectId),sampleTransferCase(ids,extra)));
  }
});

test("admin finance review is atomic and sensitive balances are hidden from incoming subscriber",async()=>{
  const ids=await seedTransferCaseScenario("finance_review");
  const adminDb=testEnv.authenticatedContext(ids.admin).firestore();
  const operatorDb=testEnv.authenticatedContext(ids.operatorUid).firestore();
  const recipientDb=testEnv.authenticatedContext(ids.target).firestore();
  const caseRef=db=>doc(db,"merchantTransferCases",ids.projectId);
  const reviewRef=db=>doc(db,"merchantTransferFinanceReviews",ids.projectId);
  await assertSucceeds(setDoc(caseRef(adminDb),sampleTransferCase(ids)));
  const patch=()=>({
    financeClearance:"reviewed",financeReviewedBy:ids.admin,
    financeReviewedAt:serverTimestamp()
  });
  const finance=()=>({
    projectDocId:ids.projectId,adminUid:ids.admin,reviewedAt:serverTimestamp(),
    currency:"EGP",formerSubscriberId:ids.owner,
    platformOutstandingAmount:100,formerSubscriberOutstandingAmount:50,
    platformEarnedAmount:125,formerSubscriberEarnedAmount:250
  });
  const submitReview=()=>{
    const batch=writeBatch(adminDb);
    batch.update(caseRef(adminDb),patch());
    batch.set(reviewRef(adminDb),finance());
    return batch.commit();
  };
  await assertFails(submitReview()); // missing both consents
  await assertSucceeds(updateDoc(caseRef(operatorDb),{
    operatorConsent:"accepted",operatorConsentedAt:serverTimestamp()
  }));
  await assertSucceeds(updateDoc(caseRef(recipientDb),{
    recipientConsent:"accepted",recipientConsentedAt:serverTimestamp()
  }));
  await assertFails(updateDoc(caseRef(recipientDb),patch()));
  await assertFails(updateDoc(caseRef(operatorDb),patch()));
  await assertFails(updateDoc(caseRef(adminDb),patch())); // missing private atomic audit
  await assertSucceeds(submitReview());
  const publicCase=await getDoc(caseRef(recipientDb));
  assert.equal(publicCase.data().financeClearance,"reviewed");
  assert.equal(publicCase.data().financeSnapshot,undefined);
  assert.equal(publicCase.data().cutoverAt,null);
  await assertFails(getDoc(reviewRef(recipientDb)));
  await assertFails(getDoc(reviewRef(operatorDb)));
  const privateReview=await getDoc(reviewRef(adminDb));
  assert.equal(privateReview.data().formerSubscriberOutstandingAmount,50);
  await assertFails(updateDoc(caseRef(adminDb),{financeClearance:"paid"}));
  await assertFails(updateDoc(reviewRef(adminDb),{platformOutstandingAmount:0}));
});

async function seedReviewedCutoverScenario(suffix = "ready") {
  const ids=await seedTransferCaseScenario("cutover_"+suffix);
  const adminDb=testEnv.authenticatedContext(ids.admin).firestore();
  const operatorDb=testEnv.authenticatedContext(ids.operatorUid).firestore();
  const recipientDb=testEnv.authenticatedContext(ids.target).firestore();
  const casePath=doc(adminDb,"merchantTransferCases",ids.projectId);
  await assertSucceeds(setDoc(casePath,sampleTransferCase(ids)));
  await assertSucceeds(updateDoc(doc(operatorDb,"merchantTransferCases",ids.projectId),{
    operatorConsent:"accepted",operatorConsentedAt:serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(recipientDb,"merchantTransferCases",ids.projectId),{
    recipientConsent:"accepted",recipientConsentedAt:serverTimestamp()
  }));
  const finance=writeBatch(adminDb);
  finance.update(casePath,{
    financeClearance:"reviewed",financeReviewedBy:ids.admin,financeReviewedAt:serverTimestamp()
  });
  finance.set(doc(adminDb,"merchantTransferFinanceReviews",ids.projectId),{
    projectDocId:ids.projectId,adminUid:ids.admin,reviewedAt:serverTimestamp(),
    currency:"EGP",formerSubscriberId:ids.owner,
    platformOutstandingAmount:100,platformEarnedAmount:125,
    formerSubscriberOutstandingAmount:50,formerSubscriberEarnedAmount:250
  });
  await assertSucceeds(finance.commit());
  const caseDoc=(await getDoc(casePath)).data();
  return {ids,adminDb,operatorDb,recipientDb,caseDoc};
}

function cutoverBatch(db,ids,options={}) {
  const batch=writeBatch(db);
  const timestamp=()=>serverTimestamp();
  batch.update(doc(db,"projects",ids.projectId),{
    assignmentStatus:"assigned_to_new_subscriber",
    assignedSubscriberId:ids.target,
    assignmentUpdatedAt:timestamp(),
    cutoverAuditId:ids.projectId,cutoverAt:timestamp(),
    cutoverAdminUid:ids.admin
  });
  batch.update(doc(db,"merchantTransferCases",ids.projectId),{
    status:"cutover_completed",cutoverAt:timestamp(),
    cutoverBy:ids.admin,cutoverAuditId:ids.projectId
  });
  if(!options.omitAudit){
    batch.set(doc(db,"merchantAssignmentCutovers",ids.projectId),{
      projectDocId:ids.projectId,merchantId:ids.merchantId,
      originalSubscriberId:ids.owner,previousSubscriberId:"",
      assignedSubscriberId:ids.target,
      recoveryAuditId:ids.projectId,financeReviewId:ids.projectId,
      commissionAmount:6,commissionVersion:1,commissionCurrency:"EGP",
      status:"completed",completedBy:ids.admin,completedAt:timestamp(),
      ...(options.forgedAudit || {})
    });
  }
  return batch.commit();
}

test("C4B11 rejects partial cutover and forged immutable audit while preserving merchant operation",async()=>{
  const {ids,adminDb,recipientDb,operatorDb}=await seedReviewedCutoverScenario("invalid");
  await assertFails(cutoverBatch(adminDb,ids,{omitAudit:true}));
  await assertFails(cutoverBatch(adminDb,ids,{forgedAudit:{assignedSubscriberId:"attacker"}}));
  await assertFails(cutoverBatch(recipientDb,ids));
  await assertFails(cutoverBatch(operatorDb,ids));
  // Terms may have changed AFTER consent and finance review. A forged
  // client must not bypass the pure JS preflight by skipping its checks.
  await testEnv.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),"commissionAgreements",ids.projectId),{
      currentAmount:18,acceptedVersion:2
    });
  });
  await assertFails(cutoverBatch(adminDb,ids));
  const project=await getDoc(doc(adminDb,"projects",ids.projectId));
  assert.equal(project.data().assignmentStatus,"platform_managed");
  assert.equal(project.data().assignedSubscriberId,"");
  const merchant=await getDoc(doc(operatorDb,"projects",ids.projectId));
  assert.equal(merchant.data().status,"active");
  await assertFails(getDoc(doc(recipientDb,"merchantTransferFinanceReviews",ids.projectId)));
});

test("C4B11 verified batch cuts over once, protects old rights, and grants recipient operational access",async()=>{
  const {ids,adminDb,recipientDb,operatorDb}=await seedReviewedCutoverScenario("valid");
  const formerDb=testEnv.authenticatedContext(ids.owner).firestore();
  await assertSucceeds(cutoverBatch(adminDb,ids));
  const project=(await getDoc(doc(adminDb,"projects",ids.projectId))).data();
  assert.equal(project.ownerId,ids.owner);
  assert.equal(project.merchantId,ids.merchantId);
  assert.equal(project.assignedSubscriberId,ids.target);
  assert.equal(project.platformManaged,true);
  assert.equal(project.assignmentStatus,"assigned_to_new_subscriber");
  await assertSucceeds(getDoc(doc(recipientDb,"projects",ids.projectId)));
  await assertFails(updateDoc(doc(formerDb,"operators",ids.projectId),{phone:"01000000000"}));
  await assertFails(updateDoc(doc(formerDb,"commissionAgreements",ids.projectId),{pendingAmount:20}));
  await assertFails(getDoc(doc(recipientDb,"merchantAssignmentCutovers",ids.projectId)));
  await assertFails(getDoc(doc(operatorDb,"merchantAssignmentCutovers",ids.projectId)));
  const audit=await getDoc(doc(adminDb,"merchantAssignmentCutovers",ids.projectId));
  assert.equal(audit.data().assignedSubscriberId,ids.target);
  await assertFails(updateDoc(doc(adminDb,"merchantAssignmentCutovers",ids.projectId),{commissionAmount:99}));
  await assertFails(cutoverBatch(adminDb,ids));
  const oldProject=await getDoc(doc(formerDb,"projects",ids.projectId));
  assert.equal(oldProject.data().ownerId,ids.owner);
});


test("C4B11 incoming workspace query is Rules-compatible; broad assignee queries are rejected",async()=>{
  const {ids,adminDb,recipientDb}=await seedReviewedCutoverScenario("workspace_query");
  await assertSucceeds(cutoverBatch(adminDb,ids));
  const projects=collection(recipientDb,"projects");
  const result=await assertSucceeds(getDocs(query(projects,
    where("assignedSubscriberId","==",ids.target),
    where("assignmentStatus","==","assigned_to_new_subscriber"),
    where("platformManaged","==",true)
  )));
  assert.equal(result.docs.some(d=>d.id===ids.projectId),true);
  await assertFails(getDocs(query(projects,where("assignedSubscriberId","==",ids.target))));
});

test("C4B11 open orders earn at rider assignment: old epochs are immutable and future credit goes to recipient",async()=>{
  const {ids,adminDb,operatorDb,recipientDb}=await seedReviewedCutoverScenario("inflight");
  const oldOrder="order_before_cutover_platform";
  const pendingOrder="order_before_cutover_after";
  const workerId="rider_after_cutover";
  await testEnv.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,"workers",workerId),{projectId:ids.projectId,role:"rider"});
    for(const orderId of [oldOrder,pendingOrder]){
      await setDoc(doc(db,"orders",orderId),{
        projectId:ids.projectId,providerId:ids.projectId,templateType:"supermarket",
        status:"ready",pricingLocked:true,assignedWorkerId:workerId,assignedWorkerRole:"rider",
        items:[{name:"Bread",quantity:1}],subtotal:20,deliveryFee:10,total:30,price:30,
        createdAt:Timestamp.fromDate(new Date("2026-10-12T00:00:00Z"))
      });
    }
  });
  const dispatch=(orderId,beneficiary)=>{
    const b=writeBatch(operatorDb);
    b.update(doc(operatorDb,"orders",orderId),{
      status:"assigned",statusUpdatedAt:serverTimestamp(),statusUpdatedBy:ids.operatorUid,
      commissionEligible:true,commissionLocked:true,commissionAmount:6,
      commissionAgreementVersion:1,commissionTrigger:"delivery_assignment",
      commissionEarnedAt:serverTimestamp()
    });
    b.set(doc(operatorDb,"commissionLedger","project_order_"+orderId),{
      userId:beneficiary,projectId:ids.projectId,orderId,
      sourceType:"project_order",sourceId:orderId,agreementId:ids.projectId,
      agreementVersion:1,amount:6,currency:"EGP",status:"earned",
      trigger:"delivery_assignment",createdAt:serverTimestamp(),
      earnedAt:serverTimestamp(),paidAt:null
    });
    return b.commit();
  };
  await assertSucceeds(dispatch(oldOrder,"__fb_platform_commissions__"));
  await assertSucceeds(cutoverBatch(adminDb,ids));
  await assertFails(dispatch(pendingOrder,ids.owner));
  await assertFails(dispatch(pendingOrder,"__fb_platform_commissions__"));
  await assertSucceeds(dispatch(pendingOrder,ids.target));
  await assertFails(dispatch(pendingOrder,ids.target));
  const oldLedger=(await getDoc(doc(adminDb,"commissionLedger","project_order_"+oldOrder))).data();
  const newLedger=(await getDoc(doc(adminDb,"commissionLedger","project_order_"+pendingOrder))).data();
  assert.equal(oldLedger.userId,"__fb_platform_commissions__");
  assert.equal(newLedger.userId,ids.target);
  assert.equal(oldLedger.amount,6);
  assert.equal(newLedger.amount,6);
  await assertFails(getDoc(doc(recipientDb,"merchantTransferFinanceReviews",ids.projectId)));
});

test("C4B11 expired incoming subscription blocks management but not physical merchant operation",async()=>{
  const {ids,adminDb,operatorDb,recipientDb}=await seedReviewedCutoverScenario("expired_continuity");
  await assertSucceeds(cutoverBatch(adminDb,ids));
  await testEnv.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await updateDoc(doc(db,"users",ids.target),{
      isActive:false,subscriptionStatus:"inactive",
      subscriptionExpiresAt:Timestamp.fromDate(new Date("2026-10-01T00:00:00Z"))
    });
    await setDoc(doc(db,"supermarkets",ids.projectId),{
      isAcceptingOrders:true,deliveryFee:10
    });
  });
  await assertSucceeds(getDoc(doc(operatorDb,"projects",ids.projectId)));
  const publicDb=testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(publicDb,"supermarkets",ids.projectId)));
  await assertFails(getDocs(query(collection(recipientDb,"orders"),where("projectId","==",ids.projectId))));
  await assertFails(updateDoc(doc(recipientDb,"projects",ids.projectId),{businessName:"Unauthorised"}));
});

test("C4B11 former and expired incoming subscriber retain only their own financial statements",async()=>{
  const {ids,adminDb,recipientDb}=await seedReviewedCutoverScenario("statements");
  const formerDb=testEnv.authenticatedContext(ids.owner).firestore();
  await assertSucceeds(cutoverBatch(adminDb,ids));
  await testEnv.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await updateDoc(doc(db,"users",ids.owner),{isActive:false,subscriptionStatus:"inactive"});
    await updateDoc(doc(db,"users",ids.target),{isActive:false,subscriptionStatus:"inactive"});
    for (const [name,uid] of [["former",ids.owner],["incoming",ids.target]]) {
      await setDoc(doc(db,"commissionSettlements","historic_receipt_"+name),{
        projectId:ids.projectId,ownerId:uid,operatorId:ids.projectId,
        status:"confirmed",amount:15,createdAt:Timestamp.now(),currency:"EGP"
      });
    }
  });
  await assertSucceeds(getDoc(doc(formerDb,"projects",ids.projectId)));
  await assertSucceeds(getDoc(doc(recipientDb,"projects",ids.projectId)));
  await assertSucceeds(getDoc(doc(formerDb,"commissionSettlements","historic_receipt_former")));
  await assertSucceeds(getDoc(doc(recipientDb,"commissionSettlements","historic_receipt_incoming")));
  await assertFails(getDoc(doc(formerDb,"commissionSettlements","historic_receipt_incoming")));
  await assertFails(getDoc(doc(recipientDb,"commissionSettlements","historic_receipt_former")));
  const formerRead=await assertSucceeds(getDocs(query(
    collection(formerDb,"commissionSettlements"),
    where("projectId","==",ids.projectId),where("ownerId","==",ids.owner))));
  assert.equal(formerRead.size,1);
  const incomingRead=await assertSucceeds(getDocs(query(
    collection(recipientDb,"commissionSettlements"),
    where("projectId","==",ids.projectId),where("ownerId","==",ids.target))));
  assert.equal(incomingRead.size,1);
  await assertFails(updateDoc(doc(formerDb,"projects",ids.projectId),{businessName:"hijack"}));
  await assertFails(updateDoc(doc(recipientDb,"projects",ids.projectId),{businessName:"expired"}));
});

test("C4B12 second recovery retains historical access and credits platform only in earning cycle 2",async()=>{
 const {ids,adminDb,recipientDb,operatorDb}=await seedReviewedCutoverScenario("repeat_cycle2");
 await assertSucceeds(cutoverBatch(adminDb,ids));
 const cycleId=ids.projectId+"_2";
 const at=Timestamp.now();
 const previouslyOpen="order_open_before_repeat_recovery";
 const afterRepeat="order_after_second_allocation";
 const rider="cycle_two_rider";
 await testEnv.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await updateDoc(doc(db,"projects",ids.projectId),{
   platformManaged:true,assignmentStatus:"platform_managed",
   assignedSubscriberId:"",assignmentCycle:2,
   recoveryAuditId:cycleId,recoveryAt:at,recoveryAdminUid:ids.admin,
   assignmentUpdatedAt:at,recoveryReason:"overdue_renewal"
  });
  await setDoc(doc(db,"merchantRecoveryCycles",cycleId),{
   cycle:2,cycleId,projectDocId:ids.projectId,merchantId:ids.merchantId,
   originalSubscriberId:ids.owner,previousSubscriberId:ids.target,
   status:"completed",adminUid:ids.admin,recoveredAt:at
  });
  await setDoc(doc(db,"merchantHistoricalAccess",ids.projectId+"_"+ids.target),{
   projectDocId:ids.projectId,subscriberUid:ids.target,
   merchantId:ids.merchantId,originalSubscriberId:ids.owner,
   firstRecoveredCycle:2,status:"historic_only",grantedAt:at
  });
  await setDoc(doc(db,"workers",rider),{projectId:ids.projectId,role:"rider"});
  for(const orderId of [previouslyOpen,afterRepeat]){
   await setDoc(doc(db,"orders",orderId),{
    projectId:ids.projectId,providerId:ids.projectId,
    templateType:"supermarket",status:"ready",pricingLocked:true,
    assignedWorkerId:rider,assignedWorkerRole:"rider",
    items:[{name:"Bread",quantity:1}],subtotal:20,deliveryFee:10,total:30,price:30,
    createdAt:Timestamp.fromDate(new Date("2026-10-12T00:00:00Z"))
   });
  }
 });
 const platformSnapshot=(await getDoc(doc(adminDb,"projects",ids.projectId))).data();
 assert.equal(platformSnapshot.ownerId,ids.owner);
 assert.equal(platformSnapshot.merchantId,ids.merchantId);
 assert.equal(platformSnapshot.operatorId,ids.projectId);
 await assertSucceeds(getDoc(doc(recipientDb,"projects",ids.projectId)));
 await assertSucceeds(getDoc(doc(recipientDb,"merchantHistoricalAccess",ids.projectId+"_"+ids.target)));
 await assertFails(updateDoc(doc(recipientDb,"projects",ids.projectId),{businessName:"hijacked"}));
 await assertFails(updateDoc(doc(adminDb,"projects",ids.projectId),{assignedSubscriberId:ids.target}));
 const outsider=testEnv.authenticatedContext(ids.operatorUid).firestore();
 await assertFails(getDoc(doc(outsider,"merchantHistoricalAccess",ids.projectId+"_"+ids.target)));
 const dispatch=(orderId,beneficiary,cycle)=>{
  const batch=writeBatch(operatorDb);
  batch.update(doc(operatorDb,"orders",orderId),{
   status:"assigned",statusUpdatedAt:serverTimestamp(),statusUpdatedBy:ids.operatorUid,
   commissionEligible:true,commissionLocked:true,commissionAmount:6,
   commissionAgreementVersion:1,commissionAssignmentCycle:cycle,
   commissionTrigger:"delivery_assignment",commissionEarnedAt:serverTimestamp()
  });
  batch.set(doc(operatorDb,"commissionLedger","project_order_"+orderId),{
   userId:beneficiary,projectId:ids.projectId,orderId,
   sourceType:"project_order",sourceId:orderId,agreementId:ids.projectId,
   agreementVersion:1,assignmentCycle:cycle,
   amount:6,currency:"EGP",status:"earned",trigger:"delivery_assignment",
   createdAt:serverTimestamp(),earnedAt:serverTimestamp(),paidAt:null
  });
  return batch.commit();
 };
 await assertFails(dispatch(previouslyOpen,ids.target,2));
 await assertFails(dispatch(previouslyOpen,"__fb_platform_commissions__",3));
 await assertSucceeds(dispatch(previouslyOpen,"__fb_platform_commissions__",2));
 const oldWitness=await getDoc(doc(adminDb,"merchantAssignmentCutovers",ids.projectId));
 assert.equal(oldWitness.data().assignedSubscriberId,ids.target);
 const nextRecipient="second_cycle_new_recipient";
 await seedUser(nextRecipient,{role:"subscriber",isActive:true,subscriptionStatus:"active"});
 const cutoverAt=Timestamp.now();
 await testEnv.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await updateDoc(doc(db,"projects",ids.projectId),{
   assignmentStatus:"assigned_to_new_subscriber",assignedSubscriberId:nextRecipient,
   cutoverAuditId:cycleId,cutoverAt,cutoverAdminUid:ids.admin,
   assignmentUpdatedAt:cutoverAt
  });
  await setDoc(doc(db,"merchantTransferCycles",cycleId),{
   cycle:2,cycleId,projectDocId:ids.projectId,merchantId:ids.merchantId,
   originalSubscriberId:ids.owner,previousSubscriberId:"",
   proposedSubscriberId:nextRecipient,
   status:"cutover_completed",operatorConsent:"accepted",recipientConsent:"accepted",
   financeClearance:"reviewed",cutoverAt,cutoverBy:ids.admin
  });
  await setDoc(doc(db,"merchantAssignmentCycles",cycleId),{
   cycle:2,cycleId,projectDocId:ids.projectId,merchantId:ids.merchantId,
   originalSubscriberId:ids.owner,assignedSubscriberId:nextRecipient,
   recoveryAuditId:cycleId,status:"completed",completedBy:ids.admin,
   completedAt:cutoverAt
  });
 });
 const nextDb=testEnv.authenticatedContext(nextRecipient).firestore();
 await assertSucceeds(getDoc(doc(nextDb,"projects",ids.projectId)));
 await assertSucceeds(getDoc(doc(recipientDb,"projects",ids.projectId)));
 await assertFails(getDoc(doc(nextDb,"merchantHistoricalAccess",ids.projectId+"_"+ids.target)));
 await assertFails(updateDoc(doc(recipientDb,"operators",ids.projectId),{phone:"unauthorized"}));
 await assertFails(dispatch(afterRepeat,ids.target,2));
 await assertFails(dispatch(afterRepeat,"__fb_platform_commissions__",2));
 await assertSucceeds(dispatch(afterRepeat,nextRecipient,2));
 const oldLedger=(await getDoc(doc(adminDb,"commissionLedger","project_order_"+previouslyOpen))).data();
 const newLedger=(await getDoc(doc(adminDb,"commissionLedger","project_order_"+afterRepeat))).data();
 assert.equal(oldLedger.userId,"__fb_platform_commissions__");
 assert.equal(newLedger.userId,nextRecipient);
 assert.equal(oldLedger.assignmentCycle,2);
 assert.equal(newLedger.assignmentCycle,2);
 await assertFails(updateDoc(doc(adminDb,"merchantAssignmentCutovers",ids.projectId),{status:"forged"}));
 await assertFails(updateDoc(doc(adminDb,"merchantAssignmentCycles",cycleId),{status:"forged"}));
});

async function seedRecoverableLaundry(name = "basic") {
  const ctx=await seedPartnerRuntime("laundry","recovery_"+name);
  const merchantId="m_"+"b".repeat(32);
  await testEnv.withSecurityRulesDisabled(async context => {
    const db=context.firestore();
    await updateDoc(doc(db,"users",ctx.ownerId),{
      subscriptionStatus:"inactive",isActive:false,
      initialActivationPaid:true,
      subscriptionExpiresAt:new Date(Date.now()-86400000)
    });
    await updateDoc(doc(db,"projects",ctx.projectId),{
      merchantId, originalSubscriberId:ctx.ownerId,
      assignedSubscriberId:ctx.ownerId,assignmentStatus:"assigned_to_subscriber",
      platformManaged:false,linkedAt:null,assignmentUpdatedAt:null
    });
  });
  await seedUser("admin_recover",{role:"admin"});
  return {...ctx,merchantId};
}

function recoveryBatch(db,{projectId,ownerId,merchantId},reason="overdue_renewal"){
  const batch=writeBatch(db);
  const stamp=serverTimestamp();
  batch.update(doc(db,"projects",projectId),{
    platformManaged:true,
    assignmentStatus:"platform_managed",
    assignedSubscriberId:"",
    assignmentUpdatedAt:stamp,
    recoveryAuditId:projectId,
    recoveryAt:stamp,
    recoveryAdminUid:"admin_recover",
    recoveryReason:reason
  });
  batch.set(doc(db,"merchantRecoveries",projectId),{
    recoveryId:projectId,projectDocId:projectId,
    merchantId,originalSubscriberId:ownerId,previousSubscriberId:ownerId,
    reason,evidenceReference:"billing-expiry-verified-"+projectId,
    status:"completed",adminUid:"admin_recover",recoveredAt:stamp
  });
  return batch;
}

test("C4 recovery cannot flip shop management without matching immutable audit",async()=>{
  const {projectId}=await seedRecoverableLaundry("noaudit");
  const db=testEnv.authenticatedContext("admin_recover").firestore();
  await assertFails(updateDoc(doc(db,"projects",projectId),{
    platformManaged:true,assignmentStatus:"platform_managed",assignedSubscriberId:"",
    recoveryAuditId:projectId,recoveryAt:serverTimestamp()
  }));
  await assertFails(setDoc(doc(db,"merchantRecoveries",projectId),{
    recoveryId:projectId,projectDocId:projectId,merchantId:"m_"+"b".repeat(32),
    originalSubscriberId:"x",previousSubscriberId:"x",
    reason:"overdue_renewal",evidenceReference:"fake-billing-case",
    status:"completed",adminUid:"admin_recover",recoveredAt:serverTimestamp()
  }));
});

test("C4 atomic admin takeover preserves old project ID and physical shop availability",async()=>{
  const data=await seedRecoverableLaundry("atomic");
  const admin=testEnv.authenticatedContext("admin_recover").firestore();
  await assertSucceeds(recoveryBatch(admin,data).commit());
  const project=await getDoc(doc(admin,"projects",data.projectId));
  const recovery=await getDoc(doc(admin,"merchantRecoveries",data.projectId));
  assert.equal(project.data().ownerId,data.ownerId);
  assert.equal(project.data().isActive,true);
  assert.equal(project.data().assignmentStatus,"platform_managed");
  assert.equal(recovery.data().previousSubscriberId,data.ownerId);
  // Customer can still load the laundry project even though the former
  // subscriber is inactive and its subscription has expired.
  const customer=testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(customer,"projects",data.projectId)));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(data.ownerId).firestore(),"projects",data.projectId),{
    businessName:"Old subscriber cannot edit"
  }));
  await assertFails(updateDoc(doc(admin,"merchantRecoveries",data.projectId),{reason:"fake"}));
});

test("C4 shop operator retains read access while departing subscriber loses management",async()=>{
  const data=await seedRecoverableLaundry("operator");
  const admin=testEnv.authenticatedContext("admin_recover").firestore();
  await assertSucceeds(recoveryBatch(admin,data).commit());
  const operator=testEnv.authenticatedContext("operator_laundry").firestore();
  await assertSucceeds(getDoc(doc(operator,"projects",data.projectId)));
  const unauth=testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(unauth,"merchantRecoveries",data.projectId)));
});

test("C4 dispatch credits ONLY the platform after recovery, not the old subscriber",async()=>{
  const ownerUid="owner_supermarket_c4ledger";
  const projectId=ownerUid+"_supermarket";
  const operatorUid="operator_supermarket_c4ledger";
  const workerId="rider_c4ledger";
  const orderId="order_c4ledger";
  const merchantId="m_"+"c".repeat(32);
  await seedUser("admin_recover",{role:"admin"});
  await seedUser(ownerUid,{
    subscriptionStatus:"inactive",isActive:false,initialActivationPaid:true,
    subscriptionExpiresAt:new Date(Date.now()-86400000)
  });
  await testEnv.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,"projects",projectId),{
      ownerId:ownerUid,originalSubscriberId:ownerUid,assignedSubscriberId:ownerUid,
      assignmentStatus:"assigned_to_subscriber",platformManaged:false,
      merchantId,linkedAt:null,assignmentUpdatedAt:null,
      projectId:"supermarket",template:"supermarket",operatingModel:"partner_operated",
      templateVersion:1,operatorId:projectId,partnerSetupStatus:"active",
      businessName:"Shop",status:"active",isActive:true,priceConfig:{}
    });
    await setDoc(doc(db,"operators",projectId),{
      authUid:operatorUid,ownerId:ownerUid,projectId,status:"active",
      agreementStatus:"accepted",isActive:true
    });
    await setDoc(doc(db,"commissionAgreements",projectId),{
      agreementId:projectId,ownerId:ownerUid,projectId,
      status:"accepted",currentAmount:5,acceptedVersion:1
    });
    await setDoc(doc(db,"workers",workerId),{projectId,role:"rider"});
    await setDoc(doc(db,"orders",orderId),{
      projectId,providerId:projectId,templateType:"supermarket",status:"ready",
      pricingLocked:true,assignedWorkerId:workerId,assignedWorkerRole:"rider",
      items:[{name:"Bread",quantity:1}],subtotal:20,deliveryFee:10,
      total:30,price:30
    });
  });
  const admin=testEnv.authenticatedContext("admin_recover").firestore();
  const audit=writeBatch(admin);
  audit.update(doc(admin,"projects",projectId),{
    platformManaged:true,assignmentStatus:"platform_managed",assignedSubscriberId:"",
    assignmentUpdatedAt:serverTimestamp(),recoveryAuditId:projectId,
    recoveryAt:serverTimestamp(),recoveryAdminUid:"admin_recover",
    recoveryReason:"overdue_renewal"
  });
  audit.set(doc(admin,"merchantRecoveries",projectId),{
    recoveryId:projectId,projectDocId:projectId,merchantId,
    originalSubscriberId:ownerUid,previousSubscriberId:ownerUid,
    reason:"overdue_renewal",evidenceReference:"billing-expiry-c4ledger",
    status:"completed",adminUid:"admin_recover",recoveredAt:serverTimestamp()
  });
  await assertSucceeds(audit.commit());

  const operator=testEnv.authenticatedContext(operatorUid).firestore();
  function dispatchTo(beneficiary){
    const batch=writeBatch(operator);
    batch.update(doc(operator,"orders",orderId),{
      status:"assigned",statusUpdatedAt:serverTimestamp(),statusUpdatedBy:operatorUid,
      commissionEligible:true,commissionLocked:true,commissionAmount:5,
      commissionAgreementVersion:1,commissionTrigger:"delivery_assignment",
      commissionEarnedAt:serverTimestamp()
    });
    batch.set(doc(operator,"commissionLedger","project_order_"+orderId),{
      userId:beneficiary,projectId,orderId,sourceType:"project_order",sourceId:orderId,
      agreementId:projectId,agreementVersion:1,amount:5,currency:"EGP",
      status:"earned",trigger:"delivery_assignment",
      createdAt:serverTimestamp(),earnedAt:serverTimestamp(),paidAt:null
    });
    return batch.commit();
  }
  await assertFails(dispatchTo(ownerUid));
  await assertSucceeds(dispatchTo("__fb_platform_commissions__"));
  const saved=await getDoc(doc(admin,"commissionLedger","project_order_"+orderId));
  assert.equal(saved.data().userId,"__fb_platform_commissions__");
});

test("C4 verified violation requires an immutable admin evidence record",async()=>{
  const data=await seedRecoverableLaundry("violation");
  const admin=testEnv.authenticatedContext("admin_recover").firestore();
  const owner=testEnv.authenticatedContext(data.ownerId).firestore();
  await assertFails(setDoc(doc(owner,"merchantViolations",data.projectId),{
    projectDocId:data.projectId,status:"confirmed",reasonCode:"fraud",
    evidenceReference:"case-owner-fake",confirmedByAdminUid:data.ownerId,
    confirmedAt:serverTimestamp()
  }));
  await assertFails(recoveryBatch(admin,data,"confirmed_violation").commit());
  await assertSucceeds(setDoc(doc(admin,"merchantViolations",data.projectId),{
    projectDocId:data.projectId,status:"confirmed",reasonCode:"fraud",
    evidenceReference:"billing-expiry-verified-"+data.projectId,
    confirmedByAdminUid:"admin_recover",confirmedAt:serverTimestamp()
  }));
  await assertSucceeds(recoveryBatch(admin,data,"confirmed_violation").commit());
  await assertFails(updateDoc(doc(admin,"merchantViolations",data.projectId),{status:"removed"}));
});

test("C4 paid subscription not overdue cannot trigger recovery even if admin attempts it",async()=>{
  const data=await seedRecoverableLaundry("not_expired");
  await testEnv.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),"users",data.ownerId),{
      isActive:true,subscriptionStatus:"active",subscriptionExpiresAt:new Date(Date.now()+86400000)
    });
  });
  const admin=testEnv.authenticatedContext("admin_recover").firestore();
  await assertFails(recoveryBatch(admin,data,"overdue_renewal").commit());
});

test("C4 former subscriber can still read only their own past financial settlements",async()=>{
  const data=await seedRecoverableLaundry("historic_finance");
  await testEnv.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,"commissionSettlements","past_owner_settlement"),{
      settlementId:"past_owner_settlement",projectId:data.projectId,
      ownerId:data.ownerId,status:"confirmed",amount:5
    });
    await setDoc(doc(db,"commissionSettlements","new_platform_settlement"),{
      settlementId:"new_platform_settlement",projectId:data.projectId,
      ownerId:"__fb_platform_commissions__",status:"confirmed",amount:5
    });
  });
  const admin=testEnv.authenticatedContext("admin_recover").firestore();
  await assertSucceeds(recoveryBatch(admin,data).commit());
  const owner=testEnv.authenticatedContext(data.ownerId).firestore();
  await assertSucceeds(getDoc(doc(owner,"commissionSettlements","past_owner_settlement")));
  await assertFails(getDoc(doc(owner,"commissionSettlements","new_platform_settlement")));
  const ownHistory=query(collection(owner,"commissionSettlements"),
    where("projectId","==",data.projectId),where("ownerId","==",data.ownerId));
  await assertSucceeds(getDocs(ownHistory));
});
