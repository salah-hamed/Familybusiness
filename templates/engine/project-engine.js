import db from "../../core/firebase/firebase-db.js";

import {
  doc,
  setDoc,
  serverTimestamp
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
