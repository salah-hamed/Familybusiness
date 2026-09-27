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

test("active subscriber can create an approved active template", async () => {
  const uid = "owner_active";
  await seedUser(uid);
  const db = testEnv.authenticatedContext(uid).firestore();

  await assertSucceeds(
    setDoc(
      doc(db, "projects", `${uid}_supermarket`),
      activePartnerProject(uid, "supermarket", 1)
    )
  );
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
