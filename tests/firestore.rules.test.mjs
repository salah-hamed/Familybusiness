import test, { after, before, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc
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
