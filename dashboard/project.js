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

  if (project.ownerId !== ownerId) {
    return {
      success: false,
      reason: "access-denied"
    };
  }

  return {
    success: true,
    projectDocId,
    project
  };

}
