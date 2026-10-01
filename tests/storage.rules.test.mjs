import test, { after, before, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const PROJECT_ID = "family-business-rules-test";
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8")
    },
    storage: {
      rules: readFileSync("storage.rules", "utf8")
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

after(async () => {
  await testEnv.cleanup();
});

test("subscriber can upload only an image proof into their own subscription path", async () => {
  const uid = "storage_owner";
  const storage = testEnv.authenticatedContext(uid).storage();
  const bytes = new Uint8Array([1,2,3,4]);

  await assertSucceeds(
    uploadBytes(
      ref(storage, `subscription-proofs/${uid}/payment_1`),
      bytes,
      {
        contentType: "image/jpeg",
        customMetadata: { ownerUid: uid, paymentId: "payment_1" }
      }
    )
  );

  await assertFails(
    uploadBytes(
      ref(storage, "subscription-proofs/someone_else/payment_2"),
      bytes,
      {
        contentType: "image/jpeg",
        customMetadata: { ownerUid: "someone_else", paymentId: "payment_2" }
      }
    )
  );

  await assertFails(
    uploadBytes(
      ref(storage, `subscription-proofs/${uid}/payment_3`),
      bytes,
      {
        contentType: "text/plain",
        customMetadata: { ownerUid: uid, paymentId: "payment_3" }
      }
    )
  );
});

test("admin can read another subscriber proof while unrelated subscriber cannot", async () => {
  const ownerUid = "storage_read_owner";
  const adminUid = "storage_admin";
  const bytes = new Uint8Array([5,6,7]);

  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users", adminUid), {
      uid: adminUid,
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      isActive: true,
      subscriptionStatus: "active"
    });
  });

  const ownerStorage = testEnv.authenticatedContext(ownerUid).storage();
  const proofRef = ref(ownerStorage, `subscription-proofs/${ownerUid}/payment_read`);

  await assertSucceeds(
    uploadBytes(proofRef, bytes, {
      contentType: "image/png",
      customMetadata: { ownerUid, paymentId: "payment_read" }
    })
  );

  const adminStorage = testEnv.authenticatedContext(adminUid).storage();
  await assertSucceeds(
    getBytes(ref(adminStorage, `subscription-proofs/${ownerUid}/payment_read`))
  );

  const strangerStorage = testEnv.authenticatedContext("storage_stranger").storage();
  await assertFails(
    getBytes(ref(strangerStorage, `subscription-proofs/${ownerUid}/payment_read`))
  );
});
