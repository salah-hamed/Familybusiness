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
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  Timestamp,
  where
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

async function seedLedger(userId, count = 55) {
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

test("ledger owner can page through 55 entries without gaps or duplicates", async () => {
  const userId = "ledger_owner";
  await seedLedger(userId, 55);
  const db = testEnv.authenticatedContext(userId).firestore();

  const first = await assertSucceeds(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(25)
  )));
  assert.equal(first.size, 25);

  const second = await assertSucceeds(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    startAfter(first.docs[first.docs.length - 1]),
    limit(25)
  )));
  assert.equal(second.size, 25);

  const third = await assertSucceeds(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    startAfter(second.docs[second.docs.length - 1]),
    limit(25)
  )));
  assert.equal(third.size, 5);

  const ids = [...first.docs, ...second.docs, ...third.docs].map(d => d.id);
  assert.equal(ids.length, 55);
  assert.equal(new Set(ids).size, 55);
});

test("another user cannot list someone else's commission ledger", async () => {
  const ownerId = "ledger_private_owner";
  await seedLedger(ownerId, 3);
  const db = testEnv.authenticatedContext("ledger_stranger").firestore();

  await assertFails(getDocs(query(
    collection(db, "commissionLedger"),
    where("userId", "==", ownerId),
    orderBy("createdAt", "desc"),
    limit(25)
  )));
});
