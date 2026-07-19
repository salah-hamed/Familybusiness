import auth from "../core/firebase/firebase-auth.js";
import db from "../core/firebase/firebase-db.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function loadCurrentProject() {

  const user = auth.currentUser;

  if (!user) return null;

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return null;

  const projectId =
    userSnap.data().projectType || "cleaning";

  const projectRef =
    doc(db, "projects", `${user.uid}_${projectId}`);

  const projectSnap =
    await getDoc(projectRef);

  if (!projectSnap.exists()) return null;

  return projectSnap.data();

}
