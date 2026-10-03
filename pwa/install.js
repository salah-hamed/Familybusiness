const manifestLink = document.querySelector('link[rel="manifest"]');
const surface = document.querySelector('meta[name="fb-pwa-surface"]')?.content || "platform";
const scriptUrl = new URL(import.meta.url);
const repoRoot = new URL("../", scriptUrl);
const swUrl = new URL("service-worker.js", repoRoot);

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)")?.matches
  || window.navigator.standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent || "")
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function isLikelyMobile(){
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "")
    || window.matchMedia?.("(max-width: 820px)")?.matches === true;
}

const installKey = `familybusiness:pwa:launch:${surface}`;
const dismissKey = `familybusiness:pwa:dismissed:${surface}`;
let deferredPrompt = null;

function templateSurface(){
  return ["supermarket","restaurant","bakery","laundry"].includes(surface);
}

function persistTemplateLaunch(){
  if(!templateSurface()) return;
  const project = new URLSearchParams(location.search).get("project");
  if(!project) return;

  const saved = new URL(location.href);
  saved.search = "";
  saved.searchParams.set("project", project);
  localStorage.setItem(installKey, saved.toString());
}

function restoreTemplateLaunch(){
  if(!templateSurface() || !isStandalone()) return false;
  const params = new URLSearchParams(location.search);
  if(params.get("project")) return false;

  const saved = localStorage.getItem(installKey);
  if(!saved) return false;

  try{
    const target = new URL(saved);
    if(target.origin !== location.origin) return false;
    if(target.pathname !== location.pathname) return false;
    location.replace(target.toString());
    return true;
  }catch{
    return false;
  }
}

function recentlyDismissed(){
  const raw = Number(localStorage.getItem(dismissKey) || 0);
  return raw > 0 && (Date.now() - raw) < 7 * 24 * 60 * 60 * 1000;
}

function surfaceLabel(){
  const labels = {
    platform: "Family Business",
    workspace: "مساحة عمل Family Business",
    admin: "لوحة إدارة Family Business",
    supermarket: "تطبيق السوبرماركت",
    restaurant: "تطبيق المطعم",
    bakery: "تطبيق المخبز",
    laundry: "تطبيق المغسلة"
  };
  return labels[surface] || "Family Business";
}

function injectUi(){
  if(document.getElementById("fbPwaInstall")) return;

  const wrapper = document.createElement("aside");
  wrapper.id = "fbPwaInstall";
  wrapper.className = "fbPwaInstall hidden";
  wrapper.setAttribute("role","dialog");
  wrapper.setAttribute("aria-live","polite");
  wrapper.innerHTML = `
    <div class="fbPwaInstallIcon">FB</div>
    <div class="fbPwaInstallCopy">
      <strong>ثبّت ${surfaceLabel()} على موبايلك</strong>
      <span>افتحه بعد كده كتطبيق مستقل من الشاشة الرئيسية.</span>
    </div>
    <button class="fbPwaInstallBtn" type="button">تثبيت التطبيق</button>
    <button class="fbPwaDismissBtn" type="button" aria-label="إغلاق">✕</button>
  `;

  const help = document.createElement("div");
  help.id = "fbPwaIosHelp";
  help.className = "fbPwaIosHelp hidden";
  help.setAttribute("role","dialog");
  help.setAttribute("aria-modal","true");
  help.innerHTML = `
    <div class="fbPwaIosCard">
      <button class="fbPwaIosClose" type="button" aria-label="إغلاق">✕</button>
      <div class="fbPwaInstallIcon large">FB</div>
      <h3>ثبّت ${surfaceLabel()}</h3>
      <p>على iPhone / iPad:</p>
      <ol>
        <li>اضغط زر <b>المشاركة Share</b> في Safari.</li>
        <li>اختار <b>Add to Home Screen / إضافة إلى الشاشة الرئيسية</b>.</li>
        <li>اضغط <b>Add / إضافة</b>.</li>
      </ol>
    </div>
  `;

  document.body.append(wrapper, help);

  wrapper.querySelector(".fbPwaDismissBtn").onclick = () => {
    localStorage.setItem(dismissKey, String(Date.now()));
    wrapper.classList.add("hidden");
  };

  wrapper.querySelector(".fbPwaInstallBtn").onclick = async () => {
    if(deferredPrompt){
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if(result?.outcome === "accepted") wrapper.classList.add("hidden");
      return;
    }

    if(isIos()){
      help.classList.remove("hidden");
      return;
    }

    wrapper.querySelector(".fbPwaInstallCopy span").textContent =
      "من قائمة المتصفح اختار تثبيت التطبيق أو Add to Home screen.";
  };

  help.querySelector(".fbPwaIosClose").onclick = () => help.classList.add("hidden");
  help.addEventListener("click", event => {
    if(event.target === help) help.classList.add("hidden");
  });
}

function showInstallUi(){
  if(isStandalone() || recentlyDismissed()) return;
  injectUi();
  document.getElementById("fbPwaInstall")?.classList.remove("hidden");
}

async function registerServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register(swUrl.pathname, { scope: repoRoot.pathname });
  }catch(error){
    console.warn("PWA_SERVICE_WORKER_REGISTRATION_FAILED", error);
  }
}

persistTemplateLaunch();
if(restoreTemplateLaunch()) {
  // Stop normal page boot from doing useful work before the redirect completes.
} else {
  registerServiceWorker();
  injectUi();

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallUi();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    document.getElementById("fbPwaInstall")?.classList.add("hidden");
    localStorage.removeItem(dismissKey);
  });

  if(isLikelyMobile() && !isStandalone()){
    window.setTimeout(showInstallUi, 900);
  }
}
