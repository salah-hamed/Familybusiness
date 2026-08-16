import db from "../core/firebase/firebase-db.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function loadCurrentProject() {

  const projectId =
    new URLSearchParams(location.search).get("project");

  if (!projectId) return null;

  const projectRef =
    doc(db, "projects", projectId);

  const projectSnap =
    await getDoc(projectRef);

  if (!projectSnap.exists()) return null;

  return projectSnap.data();

}
