function syncLaundryTheme() {
  const projectLink = document.getElementById("projectLink")?.value || "";
  const projectType = document.getElementById("projectType")?.textContent || "";
  const isLaundry = projectLink.includes("/templates/laundry/") || projectType.includes("غسيل ومكواة الملابس");
  document.body.classList.toggle("laundryDashboard", isLaundry);

  if (isLaundry) {
    const headline = document.getElementById("creativeHeadline");
    if (headline && headline.value === "تنظيف بيتك أسهل من أي وقت") {
      headline.value = "غسيل أو مكواة أو الاتنين — لحد باب البيت";
    }
  }
}

syncLaundryTheme();
const observer = new MutationObserver(syncLaundryTheme);
const projectType = document.getElementById("projectType");
if (projectType) observer.observe(projectType, { childList: true, subtree: true, characterData: true });
const projectLink = document.getElementById("projectLink");
if (projectLink) {
  projectLink.addEventListener("change", syncLaundryTheme);
  const valueObserver = new MutationObserver(syncLaundryTheme);
  valueObserver.observe(projectLink, { attributes: true, attributeFilter: ["value"] });
}
setTimeout(syncLaundryTheme, 250);
setTimeout(syncLaundryTheme, 1000);
