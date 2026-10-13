import db from "../core/firebase/firebase-db.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getProjectByDocId
} from "../core/projects/project-service.js";

export async function loadCurrentProject(ownerId) {

  const projectDocId =
    new URLSearchParams(location.search).get("project");

  if (!projectDocId) {
    return {
      success: false,
      reason: "not-found"
    };
  }

  const project = await getProjectByDocId(projectDocId);

  if (!project) {
    return {
      success: false,
      reason: "not-found"
    };
  }

  // A recovered shop is operationally controlled only by its current
  // verified incoming subscriber, never the historical owner.
  const assigned = project.platformManaged === true
    && project.assignmentStatus === "assigned_to_new_subscriber"
    && project.assignedSubscriberId === ownerId
    && project.cutoverAuditId === projectDocId
    && project.cutoverAt != null;
  if ((project.platformManaged === true && !assigned) ||
      (project.platformManaged !== true && project.ownerId !== ownerId)) {
    return {
      success: false,
      reason: "access-denied"
    };
  }

  const userSnap = await getDoc(doc(db, "users", ownerId));

  if (!userSnap.exists()) {
    return {
      success: false,
      reason: "subscription-inactive"
    };
  }

  const userData = userSnap.data();

  if (
    userData.isActive !== true ||
    userData.subscriptionStatus !== "active"
  ) {
    return {
      success: false,
      reason: "subscription-inactive"
    };
  }

  return {
    success: true,
    projectDocId,
    project
  };

}
