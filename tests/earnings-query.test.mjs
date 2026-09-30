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
  getDocs,
  getAggregateFromServer,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  Timestamp,
  where,
  sum,
  count
} from "firebase/firestore";

const PROJECT_ID = "family-business-rules-test";
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync("firestore.rules", "utf8") }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

async function seedLedger(userId, count = 101) {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users", userId), {
      uid: userId,
      name: "Ledger User",
      email: userId + "@example.com",
      isActive: true,
      subscriptionStatus: "active"
    });

    for (let i = 1; i <= count; i += 1) {
      await setDoc(doc(db, "commissionLedger", "entry_" + String(i).padStart(3, "0")), {
        userId,
        sourceType: i % 2 ? "project_order" : "referral",
        sourceId: "source_" + i,
        amount: i,
        currency: "EGP",
        status: "earned",
        createdAt: Timestamp.fromMillis(i * 1000),
        paidAt: null
      });
    }
  });
}

test("ledger owner can page through 101 entries without gaps or duplicates", async () => {
  const userId = "ledger_owner";
  await seedLedger(userId, 101);
  const db = testEnv.authenticatedContext(userId).firestore();

  const first = await assertSucceeds(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(50)
  )));
  assert.equal(first.size, 50);

  const second = await assertSucceeds(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    startAfter(first.docs[first.docs.length - 1]),
    limit(50)
  )));
  assert.equal(second.size, 50);

  const third = await assertSucceeds(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    startAfter(second.docs[second.docs.length - 1]),
    limit(50)
  )));
  assert.equal(third.size, 1);

  const ids = [...first.docs, ...second.docs, ...third.docs].map(d => d.id);
  assert.equal(first.docs[0].id, "entry_101");
  assert.equal(third.docs[0].id, "entry_001");
  assert.equal(ids.length, 101);
  assert.equal(new Set(ids).size, 101);
});

test("ledger aggregates return exact all/project/referral totals without loading history pages", async () => {
  const userId = "ledger_totals";
  await seedLedger(userId, 4);
  const db = testEnv.authenticatedContext(userId).firestore();
  const base = collection(db, "commissionLedger");

  const [all, projectOrders, referrals] = await Promise.all([
    assertSucceeds(getAggregateFromServer(
      query(base, where("userId", "==", userId)),
      { totalAmount: sum("amount"), entryCount: count() }
    )),
    assertSucceeds(getAggregateFromServer(
      query(base, where("userId", "==", userId), where("sourceType", "==", "project_order")),
      { totalAmount: sum("amount"), entryCount: count() }
    )),
    assertSucceeds(getAggregateFromServer(
      query(base, where("userId", "==", userId), where("sourceType", "==", "referral")),
      { totalAmount: sum("amount"), entryCount: count() }
    ))
  ]);

  assert.equal(all.data().totalAmount, 10);
  assert.equal(all.data().entryCount, 4);
  assert.equal(projectOrders.data().totalAmount, 4);
  assert.equal(projectOrders.data().entryCount, 2);
  assert.equal(referrals.data().totalAmount, 6);
  assert.equal(referrals.data().entryCount, 2);
});

test("another user cannot list someone else's commission ledger", async () => {
  const ownerId = "ledger_private_owner";
  await seedLedger(ownerId, 3);
  const db = testEnv.authenticatedContext("ledger_stranger").firestore();

  await assertFails(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", ownerId),
    orderBy("createdAt", "desc"),
    limit(50)
  )));
});

test("project earnings aggregates stay project-scoped and preserve paid status/paidAt semantics", async () => {
  const userId = "project_earnings_owner";
  const projectId = "project_earnings_owner_supermarket";
  const otherProjectId = "project_earnings_owner_restaurant";

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "users", userId), {
      uid: userId,
      name: "Project Earnings Owner",
      email: userId + "@example.com",
      isActive: true,
      subscriptionStatus: "active"
    });

    const entries = [
      ["p1_earned", projectId, "project_order", 10, "earned", null],
      ["p1_paid_status", projectId, "project_order", 20, "paid", null],
      ["p1_paid_timestamp", projectId, "project_order", 30, "earned", Timestamp.fromMillis(5000)],
      ["p1_paid_both", projectId, "project_order", 40, "paid", Timestamp.fromMillis(6000)],
      ["p2_paid", otherProjectId, "project_order", 100, "paid", Timestamp.fromMillis(7000)],
      ["referral", null, "referral", 50, "earned", null]
    ];

    for (const [id, pid, sourceType, amount, status, paidAt] of entries) {
      await setDoc(doc(db, "commissionLedger", id), {
        userId,
        sourceType,
        sourceId: id,
        ...(pid ? { projectId: pid } : {}),
        amount,
        currency: "EGP",
        status,
        createdAt: Timestamp.fromMillis(1000 + amount),
        paidAt
      });
    }
  });

  const db = testEnv.authenticatedContext(userId).firestore();
  const base = collection(db, "commissionLedger");
  const scope = [
    where("userId", "==", userId),
    where("sourceType", "==", "project_order"),
    where("projectId", "==", projectId)
  ];
  const aggregate = async constraints => {
    const snap = await assertSucceeds(getAggregateFromServer(
      query(base, ...constraints),
      { totalAmount: sum("amount"), entryCount: count() }
    ));
    return snap.data();
  };

  const [all, paidByStatus, paidByTimestamp, paidOverlap] = await Promise.all([
    aggregate(scope),
    aggregate([...scope, where("status", "==", "paid")]),
    aggregate([...scope, where("paidAt", "!=", null)]),
    aggregate([...scope, where("status", "==", "paid"), where("paidAt", "!=", null)])
  ]);

  const paidAmount =
    paidByStatus.totalAmount + paidByTimestamp.totalAmount - paidOverlap.totalAmount;

  assert.equal(all.entryCount, 4);
  assert.equal(all.totalAmount, 100);
  assert.equal(paidAmount, 90);
  assert.equal(all.totalAmount - paidAmount, 10);
});

test("another user cannot aggregate someone else's project commission ledger", async () => {
  const ownerId = "project_aggregate_owner";
  await seedLedger(ownerId, 3);
  const db = testEnv.authenticatedContext("project_aggregate_stranger").firestore();

  await assertFails(getAggregateFromServer(
    query(collection(db, "commissionLedger"), where("userId", "==", ownerId)),
    { totalAmount: sum("amount"), entryCount: count() }
  ));
});
