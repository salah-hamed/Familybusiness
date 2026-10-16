import { getDiscoverableProjects } from "../templates/projects.js";
import { PLATFORM_BILLING, formatEgp } from "../core/config/platform-config.js";
import { TRIAL_REGISTRATION_ENABLED } from "../core/subscriptions/trial-rollout.js";

const projectCopy = {
  supermarket: "اتعاون مع سوبرماركت شغال بالفعل، وساعده يستقبل طلبات أكتر مقابل عمولة على الطلب المكتمل.",
  restaurant: "اتعاون مع مطعم قائم عنده منيو وزباين، وخلي كل طلب مكتمل فرصة عمولة جديدة.",
  bakery: "اربط مخبز أو فرن شغال بزبائنه ومنتجاته، واكسب حسب اتفاق العمولة على الطلبات المكتملة.",
  laundry: "اتعاون مع مغسلة قائمة عندها تشغيلها وعملاؤها، واكسب عمولة على طلبات الخدمة المكتملة."
};

const container = document.getElementById("projectsContainer");
const projects = getDiscoverableProjects().filter(project =>
  ["supermarket", "restaurant", "bakery", "laundry"].includes(project.id)
);

if (container) {
  container.innerHTML = projects.map(project => `
    <article class="projectCard project-${project.id}">
      <div class="projectIcon">${project.icon}</div>
      <h3>${project.title}</h3>
      <p>${projectCopy[project.id] || project.description || ""}</p>
      <div class="projectIncome">كل طلب مكتمل = عمولة حسب اتفاقك</div>
    </article>
  `).join("");
}

const initialPrice = document.getElementById("initialActivationPrice");
const renewalPrice = document.getElementById("monthlyRenewalPrice");
const supportWhatsAppLink = document.getElementById("supportWhatsAppLink");

if (initialPrice) initialPrice.textContent = TRIAL_REGISTRATION_ENABLED ? "مجانًا" : formatEgp(PLATFORM_BILLING.initialActivationFee);
if (renewalPrice) renewalPrice.textContent = formatEgp(PLATFORM_BILLING.monthlyRenewalFee);

if (supportWhatsAppLink) {
  const supportNumber = String(PLATFORM_BILLING.supportWhatsapp || "").replace(/[^0-9]/g, "");
  const message = "مرحبًا، محتاج مساعدة بخصوص Family Business.";
  supportWhatsAppLink.href = supportNumber ? "https://wa.me/" + supportNumber + "?text=" + encodeURIComponent(message) : "#";
}

document.querySelectorAll(".faqItem button").forEach(button => {
  button.addEventListener("click", () => {
    const item = button.closest(".faqItem");
    const open = !item.classList.contains("open");

    document.querySelectorAll(".faqItem.open").forEach(other => {
      other.classList.remove("open");
      other.querySelector("button")?.setAttribute("aria-expanded", "false");
    });

    item.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
  });
});
