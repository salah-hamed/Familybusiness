import db from "../../core/firebase/firebase-db.js";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function createOrder(orderData, requestData) {
  try {
    if (!requestData?.requestKey) throw new Error("بيانات طلب الاشتراك غير مكتملة.");

    const requestRef = doc(db, "carwashSubscriptionRequests", requestData.requestKey);
    const requestSnap = await getDoc(requestRef);

    if (requestSnap.exists() && requestSnap.data().status === "pending") {
      return { success: false, error: "لديك طلب اشتراك أو تجديد قيد المراجعة بالفعل." };
    }

    const orderRef = doc(collection(db, "orders"));
    const batch = writeBatch(db);

    batch.set(orderRef, {
      ...orderData,
      createdAt: serverTimestamp()
    });

    batch.set(requestRef, {
      projectId: orderData.projectId,
      status: "pending",
      orderId: orderRef.id,
      requestType: requestData.renewal ? "renewal" : "new",
      updatedAt: serverTimestamp(),
      createdAt: requestSnap.exists()
        ? (requestSnap.data().createdAt || serverTimestamp())
        : serverTimestamp()
    }, { merge: true });

    await batch.commit();
    return { success: true, orderId: orderRef.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
