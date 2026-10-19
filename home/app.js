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
const projects = getDiscoverableProjects().filter(project => ["supermarket", "restaurant", "bakery", "laundry"].includes(project.id));
if (container) container.innerHTML = projects.map(project => `
  <article class="projectCard project-${project.id}">
    <div class="projectIcon">${project.icon}</div><h3>${project.title}</h3>
    <p>${projectCopy[project.id] || project.description || ""}</p>
    <div class="projectIncome">كل طلب مكتمل = عمولة حسب اتفاقك</div>
  </article>`).join("");
const renewalPrice = document.getElementById("monthlyRenewalPrice");
const supportWhatsAppLink = document.getElementById("supportWhatsAppLink");
const pricingCopy = document.querySelector(".pricingCopy");
const pricingCards = document.querySelector(".pricingCards");
if (renewalPrice) renewalPrice.textContent = formatEgp(PLATFORM_BILLING.monthlyRenewalFee);
if (pricingCopy) {
  const paragraph = pricingCopy.querySelector("p");
  if (paragraph) paragraph.textContent = "ابدأ 7 أيام مجانًا لتجهيز مشروعك وتجربته، ومعاك 3 أيام إضافية لسداد أول اشتراك شهري بقيمة 59 جنيه.";
}
if (pricingCards) pricingCards.innerHTML = `
  <article class="priceCard featuredPrice launchOffer">
    <span class="offerRibbon">امتياز الانطلاقة</span>
    <div class="oldActivationPrice"><s>${formatEgp(PLATFORM_BILLING.initialActivationFee)}</s><span>رسوم إنشاء وتفعيل الحساب</span></div>
    <h3>ابدأ مجانًا الآن</h3>
    <strong class="freePrice">${TRIAL_REGISTRATION_ENABLED ? "مجانًا" : formatEgp(PLATFORM_BILLING.initialActivationFee)}</strong>
    <div class="offerDays"><span>7 أيام</span> تفعيل مجاني <i>+</i> <span>3 أيام</span> لسداد الاشتراك</div>
    <p class="offerRenewal">بعدها ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} شهريًا</p>
    <a href="../">ابدأ مجانًا الآن <span aria-hidden="true">←</span></a>
    <small class="offerFinePrint">تسري فترة التجربة وفق شروط التفعيل المعتمدة.</small>
  </article>
  <article class="priceCard standardPlan" aria-disabled="true">
    <span>الخطة العادية</span><h3>إنشاء وتفعيل الحساب</h3>
    <strong class="standardActivation">${formatEgp(PLATFORM_BILLING.initialActivationFee)}</strong>
    <p>بالإضافة إلى الاشتراك الشهري</p>
    <div class="standardMonthly">${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} <small>/ شهريًا</small></div>
    <div class="standardUnavailable">الخيار غير نشط</div>
  </article>`;
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
