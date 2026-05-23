import db from "../../core/firebase/firebase-db.js";

import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function createOrder(orderData) {

  try {

    await addDoc(collection(db, "orders"), {
      ...orderData,
      createdAt: serverTimestamp()
    });

    return { success: true };

  } catch (error) {

    return {
      success: false,
      error: error.message
    };

  }
}
