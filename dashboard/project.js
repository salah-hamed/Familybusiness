import auth from "../core/firebase/firebase-auth.js";
import { getProject } from "../core/projects/project-service.js";

export async function loadCurrentProject() {

  const projectId =
    new URLSearchParams(location.search).get("project");

  const user = auth.currentUser;

  if (!user || !projectId) return null;

  return await getProject(user.uid, projectId);

}
