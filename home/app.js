import db from "../core/firebase/firebase-db.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const projectsContainer =
document.getElementById("projectsContainer");

loadProjects();

async function loadProjects(){

    projectsContainer.innerHTML = "جاري تحميل المشاريع...";

    const snapshot =
    await getDocs(collection(db,"templates"));

    projectsContainer.innerHTML = "";

}
