import db from "../firebase/firebase-db.js";

import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function getProjectDocId(ownerId, templateId) {
  return `${ownerId}_${templateId}`;
}

export async function getProjectByDocId(projectDocId) {

  const ref = doc(db, "projects", projectDocId);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  return {
    projectDocId: snap.id,
    ...snap.data()
  };
}

export async function getProject(ownerId, templateId) {

  return getProjectByDocId(
    getProjectDocId(ownerId, templateId)
  );
}

export async function updateProject(ownerId, templateId, data) {

  const ref = doc(
    db,
    "projects",
    getProjectDocId(ownerId, templateId)
  );

  await updateDoc(ref, data);

}
