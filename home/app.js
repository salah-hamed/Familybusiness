import { getDiscoverableProjects } from "../templates/projects.js";
import { PLATFORM_BILLING, REFERRAL_CONFIG, formatEgp } from "../core/config/platform-config.js";

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
const referralAmount = document.getElementById("referralAmount");
const faqReferralAmount = document.getElementById("faqReferralAmount");

if (initialPrice) initialPrice.textContent = formatEgp(PLATFORM_BILLING.initialActivationFee);
if (renewalPrice) renewalPrice.textContent = formatEgp(PLATFORM_BILLING.monthlyRenewalFee);
if (referralAmount) referralAmount.textContent = `+ ${formatEgp(REFERRAL_CONFIG.qualifiedReferralReward)}`;
if (faqReferralAmount) faqReferralAmount.textContent = formatEgp(REFERRAL_CONFIG.qualifiedReferralReward);

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
