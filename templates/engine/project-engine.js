import db from "../../core/firebase/firebase-db.js";
import {
  getProjectDocId
} from "../../core/projects/project-service.js";
import { canCreateTemplate } from "../projects.js";
import { isSubscriptionActive } from "../../core/subscriptions/subscription-service.js";

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

  if (!canCreateTemplate(project)) {
    throw new Error("TEMPLATE_NOT_AVAILABLE");
  }

  const userSnap = await getDoc(doc(db, "users", ownerId));

  if (!userSnap.exists()) {
    throw new Error("USER_NOT_FOUND");
  }

  const userData = userSnap.data();

  if (!isSubscriptionActive(userData)) {
    throw new Error("SUBSCRIPTION_NOT_ACTIVE");
  }

  const projectDocId = getProjectDocId(ownerId, project.id);

  await setDoc(doc(db, "projects", projectDocId), {

    ownerId,

    projectId: project.id,

    template: project.folder,

    operatingModel: project.operatingModel,

    templateVersion: project.version,

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
