import db from "../../core/firebase/firebase-db.js";
import {
  getProjectDocId
} from "../../core/projects/project-service.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function createProject(ownerId, project) {

  const userSnap = await getDoc(doc(db, "users", ownerId));

  if (!userSnap.exists()) {
    throw new Error("USER_NOT_FOUND");
  }

  const userData = userSnap.data();

  if (
    userData.isActive !== true ||
    userData.subscriptionStatus !== "active"
  ) {
    throw new Error("SUBSCRIPTION_NOT_ACTIVE");
  }

  const projectDocId = getProjectDocId(ownerId, project.id);

  await setDoc(doc(db, "projects", projectDocId), {

    ownerId,

    projectId: project.id,

    template: project.folder,

    businessName: project.title,

    status: "active",
isActive: true,

    createdAt: serverTimestamp(),

    whatsappNumber: "",

    instapayLink: "",

    logo: "",

    coverImage: "",

    primaryColor: project.color,

    priceConfig: {}

  });

  return projectDocId;

}
export async function loadUserProjects(ownerId) {

  const q = query(
    collection(db, "projects"),
    where("ownerId", "==", ownerId)
  );

  const snap = await getDocs(q);

  const list = [];

  snap.forEach(projectDoc => {
    list.push({
      projectDocId: projectDoc.id,
      ...projectDoc.data()
    });
  });

  return list;
}
