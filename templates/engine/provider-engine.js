import db from "../../core/firebase/firebase-db.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function loadProvider(providerId) {

  if (!providerId) {

    return {
      success: false,
      error: "Provider ID not found"
    };

  }

  const snap =
    await getDoc(doc(db, "users", providerId));

  if (!snap.exists()) {

    return {
      success: false,
      error: "Provider not found"
    };

  }

  const provider =
    snap.data();

  if (!provider.isActive) {

    return {
      success: false,
      error: "Project not active"
    };

  }

  return {

    success: true,

    provider

  };

}
