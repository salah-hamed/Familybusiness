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

test("nearby listings are public only when opted in and contain only the projection fields", async () => {
  const ownerId = "nearby_owner";
  const projectId = "nearby_owner_supermarket";
  await seedUser(ownerId);
  await seedProject(projectId, {
    ownerId,
    template: "supermarket",
    operatingModel: "partner_operated"
  });

  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  const listing = {
    projectId,
    template: "supermarket",
    name: "Test Market",
    area: "Nasr City",
    areaKey: "nasr city",
    deliveryAvailable: true,
    isListed: true,
    updatedAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(ownerDb, "nearbyShops", projectId), listing));

  const publicDb = testEnv.unauthenticatedContext().firestore();
  const results = await assertSucceeds(getDocs(query(
    collection(publicDb, "nearbyShops"),
    where("isListed", "==", true)
  )));
  assert.equal(results.size, 1);
  assert.deepEqual(Object.keys(results.docs[0].data()).sort(), Object.keys(listing).sort());
  await assertFails(getDocs(collection(publicDb, "nearbyShops")));
  await assertFails(setDoc(doc(ownerDb, "nearbyShops", projectId), {
    ...listing,
    phone: "01000000000"
  }));
});

test("a merchant must explicitly opt in before their nearby listing becomes public", async () => {
  const ownerId = "nearby_private_owner";
  const projectId = "nearby_private_owner_laundry";
  await seedUser(ownerId);
  await seedProject(projectId, {
    ownerId,
    template: "laundry",
    operatingModel: "partner_operated"
  });

  const ownerDb = testEnv.authenticatedContext(ownerId).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "nearbyShops", projectId), {
    projectId,
    template: "laundry",
    name: "Test Laundry",
    area: "",
    areaKey: "",
    deliveryAvailable: false,
    isListed: false,
    updatedAt: serverTimestamp()
  }));

  const publicDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(publicDb, "nearbyShops", projectId)));
  const listed = await assertSucceeds(getDocs(query(
    collection(publicDb, "nearbyShops"),
    where("isListed", "==", true)
  )));
  assert.equal(listed.size, 0);
});

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

test("retired cleaning and carwash projects cannot accept public orders", async () => {
  for (const templateType of ["cleaning", "carwash"]) {
    const ownerId = `retired_owner_${templateType}`;
    const projectId = `${ownerId}_${templateType}`;
    await seedUser(ownerId);
    await seedProject(projectId, {
      ownerId,
      projectId: templateType,
      template: templateType,
      operatingModel: "owner_operated",
      templateVersion: 1,
      status: "active",
      isActive: true,
      priceConfig: { base: 100, room: 20, bathroom: 20, kitchen: 30, stairs: 30, monthly: 100, monthlyWashes: 4 }
    });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, "orders", `retired_${templateType}_order`), {
      projectId,
      providerId: projectId,
      templateType,
      status: "new",
      customerName: "عميل اختبار",
      customerPhone: "01000000000",
      customerAddress: "عنوان اختبار",
      locat۟;��$z{-���jם     commissionEarnedAt:serverTimestamp()
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

test("C4B12 repeat-cycle collections stay denied while rollout is off",async()=>{
 const db=testEnv.authenticatedContext("cycle_disabled_user").firestore();
 for (const name of [
  "merchantRecoveryCycles",
  "merchantHistoricalAccess",
  "merchantTransferCycles",
  "merchantTransferCycleFinanceReviews",
  "merchantAssignmentCycles",
  "merchantCyclePaymentStates"
 ]) {
  await assertFails(getDoc(doc(db,name,"project_2")));
  await assertFails(setDoc(doc(db,name,"project_2"),{projectDocId:"project"}));
 }
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
    await setDoc(doc(db,"subscriptionBillingGuards",ctx.ownerId),{
      userId:ctx.ownerId,pendingPaymentId:"",lastReviewedPaymentId:"",
      revision:1,recoverySafe:true,updatedAt:Timestamp.now(),
      reconciledAt:Timestamp.now(),reconciledBy:"admin_recover"
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
    await setDoc(doc(db,"subscriptionBillingGuards",ownerUid),{
      userId:ownerUid,pendingPaymentId:"",lastReviewedPaymentId:"",
      revision:1,recoverySafe:true,updatedAt:Timestamp.now(),
      reconciledAt:Timestamp.now(),reconciledBy:"admin_recover"
    });
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
