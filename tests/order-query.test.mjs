import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
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
const PROJECT_DOC_ID = "owner_restaurant_restaurant";
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

async function seedOrders(count) {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (let i = 1; i <= count; i += 1) {
      await setDoc(doc(db, "orders", `order_${String(i).padStart(3, "0")}`), {
        projectId: PROJECT_DOC_ID,
        templateType: "restaurant",
        createdAt: Timestamp.fromMillis(i * 1000),
        sequence: i
      });
    }
  });
}

async function newestPage(db, cursor = null, pageSize = 50) {
  const constraints = [
    where("projectId", "==", PROJECT_DOC_ID),
    where("templateType", "==", "restaurant"),
    orderBy("createdAt", "desc")
  ];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(pageSize));

  return getDocs(query(collection(db, "orders"), ...constraints));
}

for (const count of [49, 50, 51, 100]) {
  test(`newest-order query returns the correct head with ${count} orders`, async () => {
    await seedOrders(count);

    await testEnv.withSecurityRulesDisabled(async context => {
      const snap = await newestPage(context.firestore());
      assert.equal(snap.size, Math.min(50, count));
      assert.equal(snap.docs[0].data().sequence, count);
      assert.equal(
        snap.docs[snap.docs.length - 1].data().sequence,
        count > 50 ? count - 49 : 1
      );
    });
  });
}

test("a new order remains first after the collection already has 100 orders", async () => {
  await seedOrders(100);

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, "orders", "order_101"), {
      projectId: PROJECT_DOC_ID,
      templateType: "restaurant",
      createdAt: Timestamp.fromMillis(101000),
      sequence: 101
    });

    const snap = await newestPage(db);
    assert.equal(snap.size, 50);
    assert.equal(snap.docs[0].data().sequence, 101);
    assert.equal(snap.docs[49].data().sequence, 52);
  });
});

test("cursor pagination continues without duplicates or gaps", async () => {
  await seedOrders(101);

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const first = await newestPage(db);
    const second = await newestPage(db, first.docs[first.docs.length - 1]);
    const third = await newestPage(db, second.docs[second.docs.length - 1]);

    const sequences = [
      ...first.docs.map(d => d.data().sequence),
      ...second.docs.map(d => d.data().sequence),
      ...third.docs.map(d => d.data().sequence)
    ];

    assert.equal(first.size, 50);
    assert.equal(second.size, 50);
    assert.equal(third.size, 1);
    assert.equal(sequences.length, 101);
    assert.equal(new Set(sequences).size, 101);
    assert.equal(sequences[0], 101);
    assert.equal(sequences[100], 1);
  });
});
