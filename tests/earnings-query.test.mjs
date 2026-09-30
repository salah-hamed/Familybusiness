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
