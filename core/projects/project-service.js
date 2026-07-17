import db from "../firebase/firebase-db.js";

import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function getProjectDocId(ownerId, projectId) {
  return `${ownerId}_${projectId}`;
}

export async function getProject(ownerId, projectId) {

  const ref = doc(
    db,
    "projects",
    getProjectDocId(ownerId, projectId)
  );

  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return snap.data();
}

export async function updateProject(ownerId, projectId, data) {

  const ref = doc(
    db,
    "projects",
    getProjectDocId(ownerId, projectId)
  );

  await updateDoc(ref, data);

}
