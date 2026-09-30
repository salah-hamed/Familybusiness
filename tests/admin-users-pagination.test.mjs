import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  where
} from "firebase/firestore";

const PROJECT_ID = "family-business-admin-pagination-test";
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

  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, "users", "admin_pf02"), {
      uid: "admin_pf02",
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      isActive: true,
      subscriptionStatus: "active"
    });

    for (let i = 0; i < 105; i += 1) {
      const uid = "user_" + String(i).padStart(3, "0");
      await setDoc(doc(db, "users", uid), {
        uid,
        name: "User " + i,
        email: uid + "@example.com",
        isActive: i % 2 === 0,
        subscriptionStatus: i % 2 === 0 ? "active" : "pending"
      });
    }
  });
});

after(async () => {
  await testEnv.cleanup();
});

async function usersPage(db, cursor = null, status = "all") {
  const constraints = [];

  if (status !== "all") {
    constraints.push(where("subscriptionStatus", "==", status));
  }

  constraints.push(orderBy(documentId()));

  if (cursor) {
    constraints.push(startAfter(cursor));
  }

  constraints.push(limit(50));
  return getDocs(query(collection(db, "users"), ...constraints));
}

test("admin can page through every user without duplicates or gaps", async () => {
  const db = testEnv.authenticatedContext("admin_pf02").firestore();

  const first = await usersPage(db);
  const second = await usersPage(db, first.docs[first.docs.length - 1]);
  const third = await usersPage(db, second.docs[second.docs.length - 1]);

  const ids = [...first.docs, ...second.docs, ...third.docs].map(item => item.id);

  assert.equal(first.size, 50);
  assert.equal(second.size, 50);
  assert.equal(third.size, 6);
  assert.equal(ids.length, 106);
  assert.equal(new Set(ids).size, 106);
});

test("admin status filter is server-side and count aggregation stays exact", async () => {
  const db = testEnv.authenticatedContext("admin_pf02").firestore();

  const page = await usersPage(db, null, "active");
  const countSnap = await getCountFromServer(
    query(
      collection(db, "users"),
      where("subscriptionStatus", "==", "active")
    )
  );

  assert.equal(page.size, 50);
  assert.equal(page.docs.every(item => item.data().subscriptionStatus === "active"), true);
  assert.equal(countSnap.data().count, 54);
});

test("non-admin cannot list paginated users", async () => {
  const db = testEnv.authenticatedContext("user_000").firestore();

  await assert.rejects(async () => {
    await usersPage(db);
  });
});
