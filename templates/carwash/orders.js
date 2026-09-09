import db from "../../core/firebase/firebase-db.js";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function createOrder(orderData, requestData) {
  try {
    if (!requestData?.requestKey) {
      throw new Error("بيانات طلب الاشتراك غير مكتملة.");
    }

    const requestRef = doc(
      db,
      "carwashSubscriptionRequests",
      requestData.requestKey
    );

    const orderRef = doc(collection(db, "orders"));

    await runTransaction(db, async (tx) => {
      const requestSnap = await tx.get(requestRef);

      if (
        requestSnap.exists() &&
        requestSnap.data().status === "pending"
      ) {
        throw new Error(
          "لديك طلب اشتراك أو تجديد قيد المراجعة بالفعل."
        );
      }

      tx.set(orderRef, {
        ...orderData,
        createdAt: serverTimestamp()
      });

      tx.set(
        requestRef,
        {
          projectId: orderData.projectId,
          status: "pending",
          orderId: orderRef.id,
          requestType: requestData.renewal ? "renewal" : "new",
          updatedAt: serverTimestamp(),
          createdAt: requestSnap.exists()
            ? requestSnap.data().createdAt || serverTimestamp()
            : serverTimestamp()
        },
        { merge: true }
      );
    });

    return { success: true, orderId: orderRef.id };
  } catch (error) {
    return {
      success: false,
      error: error.message || "تعذر إرسال طلب الاشتراك."
    };
  }
}
