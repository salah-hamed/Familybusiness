import db from "../firebase/firebase-db.js";
import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getLegacyProjectDocId,
  getNewProjectDocId
} from "./project-identity.js";

/**
 * Two arguments preserve the historical project ID exactly.
 * Pass a pre-generated unique instance token only for a new repeated project.
 * The caller must not use the new form until the matching Firestore Rules
 * contract is deployed and tested.
 */
export function getProjectDocId(ownerId, templateId, instanceId = null) {
  return instanceId == null
    ? getLegacyProjectDocId(ownerId, templateId)
    : getNewProjectDocId(ownerId, templateId, instanceId);
}

export async function getProjectByDocId(projectDocId) {
  const ref = doc(db, "projects", projectDocId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { projectDocId: snap.id, ...snap.data() };
}

export async function getProject(ownerId, templateId) {
  return getProjectByDocId(getProjectDocId(ownerId, templateId));
}

export async function updateProject(ownerId, templateId, data) {
  const ref = doc(db, "projects", getProjectDocId(ownerId, templateId));
  await updateDoc(ref, data);
}
