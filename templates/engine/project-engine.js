import db from "../../core/firebase/firebase-db.js";
import {
  getProjectDocId
} from "../../core/projects/project-service.js";
import { canCreateTemplate } from "../projects.js";
import { isSubscriptionActive } from "../../core/subscriptions/subscription-service.js";
import { buildInitialMerchantIdentity } from "../../core/merchants/merchant-identity.js";

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

  const projectRef = doc(db, "projects", projectDocId);
  const initialProject = {

    ownerId,

    ...buildInitialMerchantIdentity(ownerId),

    projectId: project.id,

    template: project.folder,

    operatingModel: project.operatingModel,

    templateVersion: project.version,

    operatorId: project.operatingModel === "partner_operated" ? "" : null,

    partnerSetupStatus: project.operatingModel === "partner_operated" ? "not_started" : null,

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

  };

  try {
    // This is accepted after the accompanying Firestore Rules are deployed.
    await setDoc(projectRef, initialProject);
  } catch (error) {
    if (error?.code !== "permission-denied") throw error;

    // Rolling deployment safety: production may still run the legacy Rules.
    // The old create schema remains usable; the legacy merchant projection
    // allows a later audited backfill without modifying the runtime ID.
    const {
      merchantId,
      originalSubscriberId,
      assignedSubscriberId,
      assignmentStatus,
      platformManaged,
      linkedAt,
      assignmentUpdatedAt,
      ...legacyProject
    } = initialProject;
    await setDoc(projectRef, legacyProject);
  }

  return projectDocId;

}
export async function loadUserProjects(ownerId) {
  // The historical ownerId is immutable, so searching by ownerId alone
  // misses legitimately reassigned shops and advertises reclaimed ones
  // to former subscribers. Keep both scopes separate.
  const col = collection(db, "projects");
  const [historic,assigned] = await Promise.all([
    getDocs(query(col,where("ownerId","==",ownerId))),
    getDocs(query(col,
      where("assignedSubscriberId","==",ownerId),
      where("assignmentStatus","==","assigned_to_new_subscriber"),
      where("platformManaged","==",true)))
  ]);
  const byId = new Map();
  for (const snap of [historic,assigned]) {
    snap.forEach(projectDoc => {
      const project = projectDoc.data();
      if (project.platformManaged === true &&
          !(project.assignmentStatus === "assigned_to_new_subscriber" &&
            project.assignedSubscriberId === ownerId)) return;
      byId.set(projectDoc.id,{projectDocId:projectDoc.id,...project});
    });
  }
  return [...byId.values()];
}
