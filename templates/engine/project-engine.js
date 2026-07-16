import db from "../../core/firebase/firebase-db.js";

import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function createProject(ownerId, project) {

  const projectDocId = `${ownerId}_${project.id}`;

  await setDoc(doc(db, "projects", projectDocId), {

    ownerId,

    projectId: project.id,

    template: project.folder,

    businessName: project.title,

    status: "active",

    createdAt: serverTimestamp(),

    whatsappNumber: "",

    instapayLink: "",

    logo: "",

    coverImage: "",

    primaryColor: project.color,

    priceConfig: {}

  });

}
export async function loadUserProjects(ownerId) {

  const q = query(
    collection(db, "projects"),
    where("ownerId", "==", ownerId)
  );

  const snap = await getDocs(q);

  const list = [];

  snap.forEach(doc => {
    list.push(doc.data());
  });

  return list;
}
