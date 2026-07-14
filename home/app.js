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

    snapshot.forEach((doc)=>{

        const project = doc.data();

        if(!project.active) return;

        projectsContainer.innerHTML += `

        <div class="project-card">

            <div class="project-icon">

                ${project.icon}

            </div>

            <h3>

                ${project.title}

            </h3>

            <p>

                ${project.description}

            </p>

            <span class="project-status">

                ✓ جاهز للعمل

            </span>

            <a href="#" class="project-btn">

                استكشف المشروع

            </a>

        </div>

        `;

    });

}
