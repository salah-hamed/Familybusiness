import { getDiscoverableProjects } from "../templates/projects.js";
import { PLATFORM_BILLING, formatEgp } from "../core/config/platform-config.js";

const projectsContainer =
document.getElementById("projectsContainer");

loadProjects();
loadPricing();

function loadProjects(){

    const projects = getDiscoverableProjects();

    projectsContainer.innerHTML = "";

    projects.forEach((project)=>{

        const readyToStart = project.creationEnabled === true;

        projectsContainer.innerHTML += `

        <div class="project-card">

            <div class="project-icon">

                ${project.icon}

            </div>

            <h3>

                ${project.title}

            </h3>

            <p>

                ${project.description || ""}

            </p>

            <span class="project-status">

                ${readyToStart ? "✅ جاهز للبدء" : "🚧 قريبًا للتشغيل"}

            </span>

            <a
                href="${readyToStart ? "../workspace/" : "#"}"
                class="project-btn ${readyToStart ? "" : "disabled-btn"}"
                aria-disabled="${readyToStart ? "false" : "true"}"
            >

                ${readyToStart ? "ابدأ المشروع" : "قريبًا للتشغيل"}

            </a>

        </div>

        `;

    });

}


function loadPricing(){
    const initialPrice = document.getElementById("initialActivationPrice");
    const renewalPrice = document.getElementById("monthlyRenewalPrice");

    if (initialPrice) {
        initialPrice.innerText = formatEgp(PLATFORM_BILLING.initialActivationFee);
    }

    if (renewalPrice) {
        renewalPrice.innerText = formatEgp(PLATFORM_BILLING.monthlyRenewalFee);
    }
}
